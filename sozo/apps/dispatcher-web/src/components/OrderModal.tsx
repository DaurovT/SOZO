import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, orderActUrl, photoUrl } from '../api';
import {
  ACT_STATUSES,
  ACTION_FLAGS,
  ACTION_LABELS,
  APPROVED_VIA_LABELS,
  FLAG_LABELS,
  LOG_ACTION_LABELS,
  MATERIAL_KIND_LABELS,
  MATERIAL_SOURCE_LABELS,
  NUMERIC_FLAGS,
  PHOTO_STAGE_LABELS,
  PRICE_TIER_LABELS,
  QUOTE_KIND_LABELS,
  REASSIGNABLE_STATUSES,
  statusLabel,
} from '../dicts';
import { formatDateTime, formatSoums, soumsToTiyin } from '../format';
import type { AssignmentCandidates, CancelPreview, DispatchMaster, OrderDetail, OrderPhoto, Quote } from '../types';
import { GraphTypeBadge, StatusBadge } from './Badges';
import { Modal } from './Modal';
import { SlotTab } from './SlotTab';
import { ErrorBanner, Loading } from './States';
import { useToast } from './Toast';

interface OrderModalProps {
  orderId: string;
  onClose: () => void;
  /** Вызывается после каждого успешного изменения — родитель перезагружает kanban. */
  onChanged: () => void;
}

type TabId = 'summary' | 'status' | 'quotes' | 'photos' | 'materials' | 'slot' | 'actions';

/** Запчасть дороже 200 000 сум требует вилку эконом/стандарт/премиум (ТЗ 8.4.3). */
const PRICE_TIER_THRESHOLD_SOUMS = 200_000;

/** Файл → dataURL (`data:image/png;base64,…`) — формат, который принимает API фото. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/** Тип сметы: вынужденная — error-бейдж, апсейл — muted (разные механизмы, ТЗ 4.6). */
function QuoteKindCell({ kind }: { kind: Quote['kind'] }) {
  const label = QUOTE_KIND_LABELS[kind] ?? kind;
  if (kind === 'additional_forced') return <span className="badge badge--error">{label}</span>;
  if (kind === 'additional_upsell') return <span className="badge badge--muted">{label}</span>;
  return <>{label}</>;
}

export function OrderModal({ orderId, onClose, onChanged }: OrderModalProps) {
  const toast = useToast();
  const [tab, setTab] = useState<TabId>('summary');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [masters, setMasters] = useState<DispatchMaster[]>([]);

  // Вкладка «Сводка»: переходы конвейера (dev-флаги как раньше)
  const [masterId, setMasterId] = useState('');
  /** Авто-подбор мастера (ТЗ 7.3): кандидаты с обоснованием и причинами отсева */
  const [candidates, setCandidates] = useState<AssignmentCandidates | null>(null);
  const [candBusy, setCandBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Вкладка «Материалы»: форма добавления (ТЗ 8.4)
  const [mKind, setMKind] = useState<'spare_part' | 'consumable'>('spare_part');
  const [mName, setMName] = useState('');
  const [mSoums, setMSoums] = useState('');
  const [mSource, setMSource] = useState('partner_store');
  const [mReceipt, setMReceipt] = useState(false);
  const [mTier, setMTier] = useState('');
  const [mError, setMError] = useState<string | null>(null);
  const [mBusy, setMBusy] = useState(false);

  // Вкладка «Фото»: загрузка присланного мастером файла (PRD-05 §9)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pFile, setPFile] = useState<File | null>(null);
  const [pStage, setPStage] = useState<OrderPhoto['stage']>('before');
  const [pNote, setPNote] = useState('');
  const [pError, setPError] = useState<string | null>(null);
  const [pBusy, setPBusy] = useState(false);

  // Вкладка «Действия»: переназначение (ТЗ 4.5) и отмена с предпросмотром (ТЗ 4.4)
  const [reMasterId, setReMasterId] = useState('');
  const [reReason, setReReason] = useState('');
  const [reError, setReError] = useState<string | null>(null);
  const [reBusy, setReBusy] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<OrderDetail>(`/dispatch/orders/${orderId}`)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    api
      .get<DispatchMaster[]>('/dispatch/masters')
      .then((m) => {
        if (!cancelled) setMasters(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const allowed = order?.allowedActions ?? [];
  // Отмена живёт на вкладке «Действия» с предпросмотром денег — из «Сводки» убрана.
  const buttons = allowed.filter((a) => a in ACTION_LABELS && a !== 'cancel');

  /** Чекбоксы dev-симуляции, релевантные текущим allowedActions. */
  const relevantFlags = useMemo(() => {
    const list: string[] = [];
    for (const a of allowed) {
      for (const f of ACTION_FLAGS[a] ?? []) {
        if (!list.includes(f)) list.push(f);
      }
    }
    return list;
  }, [allowed]);

  const loadCandidates = async () => {
    if (order == null) return;
    setCandBusy(true);
    setActionError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await api.get<AssignmentCandidates>(
        `/dispatch/assignment/candidates?orderId=${order.id}&date=${today}`,
      );
      setCandidates(res);
      if (res.candidates.length > 0 && masterId === '') setMasterId(res.candidates[0].masterId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setCandBusy(false);
    }
  };

  const run = async (action: string, reasonOverride?: string) => {
    if (!order) return;
    setBusy(true);
    setActionError(null);
    setCancelError(null);
    try {
      const payload: Record<string, number | boolean> = {};
      for (const [flag, on] of Object.entries(flags)) {
        if (on) payload[flag] = NUMERIC_FLAGS.has(flag) ? 1 : true;
      }
      const body: Record<string, unknown> = { action, version: order.version };
      if (action === 'assign') body.masterId = masterId;
      const r = (reasonOverride ?? reason).trim();
      if (r !== '') body.reason = r;
      if (Object.keys(payload).length > 0) body.payload = payload;
      const updated = await api.post<OrderDetail>(
        `/dispatch/orders/${order.id}/transitions`,
        body,
      );
      setOrder(updated);
      setReason('');
      if (action === 'cancel') {
        setPreview(null);
        setCancelReason('');
      }
      toast(`${ACTION_LABELS[action] ?? action}: заявка → «${statusLabel(updated.status)}»`);
      onChanged();
    } catch (e) {
      // 409 (STATE_MACHINE_VIOLATION | GUARD_FAILED | VERSION_CONFLICT) — красная плашка:
      // диспетчер видит, какое условие конвейера не выполнено.
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      if (action === 'cancel') setCancelError(msg);
      else setActionError(msg);
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        // Карточку кто-то изменил — перечитываем.
        api
          .get<OrderDetail>(`/dispatch/orders/${orderId}`)
          .then(setOrder)
          .catch(() => undefined);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const mSoumsNum = Number(mSoums.replace(/\s/g, '').replace(',', '.'));
  const tierNeeded = mKind === 'spare_part' && mSoumsNum > PRICE_TIER_THRESHOLD_SOUMS;

  const addMaterial = async () => {
    if (!order) return;
    setMBusy(true);
    setMError(null);
    try {
      const body: Record<string, unknown> = {
        kind: mKind,
        name: mName.trim(),
        amountTiyin: soumsToTiyin(mSoumsNum),
        sourceChannel: mSource,
        hasReceipt: mReceipt,
      };
      if (tierNeeded && mTier !== '') body.priceTier = mTier;
      // Эндпоинт возвращает запись заявки без allowedActions — сливаем только материалы.
      const updated = await api.post<OrderDetail>(`/dispatch/orders/${order.id}/materials`, body);
      setOrder((prev) =>
        prev
          ? { ...prev, materials: updated.materials, totalMaterialTiyin: updated.totalMaterialTiyin }
          : prev,
      );
      setMName('');
      setMSoums('');
      setMReceipt(false);
      setMTier('');
      toast('Материал добавлен');
    } catch (e) {
      // RECEIPT_REQUIRED | PRICE_TIER_REQUIRED | MATERIALS_STAGE_INVALID — показываем message.
      setMError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setMBusy(false);
    }
  };

  const uploadPhoto = async () => {
    if (!order || !pFile) return;
    setPBusy(true);
    setPError(null);
    try {
      const dataUrl = await readDataUrl(pFile);
      const body: Record<string, unknown> = { stage: pStage, dataUrl };
      if (pNote.trim() !== '') body.note = pNote.trim();
      await api.post(`/dispatch/orders/${order.id}/photos`, body);
      // Ответ — только загруженное фото; карточку перечитываем целиком.
      setOrder(await api.get<OrderDetail>(`/dispatch/orders/${order.id}`));
      setPFile(null);
      setPNote('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast('Фото загружено');
    } catch (e) {
      // IMAGE_REQUIRED | MIME_UNSUPPORTED | FILE_TOO_LARGE — показываем message.
      setPError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setPBusy(false);
    }
  };

  const reassignAllowed = order != null && REASSIGNABLE_STATUSES.has(order.status);

  const reassign = async () => {
    if (!order) return;
    setReBusy(true);
    setReError(null);
    try {
      const updated = await api.post<OrderDetail>(`/dispatch/orders/${order.id}/reassign`, {
        masterId: reMasterId,
        reason: reReason.trim(),
      });
      setOrder(updated);
      setReMasterId('');
      setReReason('');
      toast(`Мастер переназначен: ${updated.masterName ?? '—'}`);
      onChanged();
    } catch (e) {
      // REASSIGN_STAGE_INVALID | REASON_REQUIRED | MASTER_REQUIRED — показываем message.
      setReError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setReBusy(false);
    }
  };

  const loadCancelPreview = async () => {
    if (!order) return;
    setPreviewBusy(true);
    setCancelError(null);
    try {
      setPreview(await api.get<CancelPreview>(`/dispatch/orders/${order.id}/cancel-preview`));
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  };

  const title = order ? `Заявка ${order.number}` : 'Заявка';

  const quotes = order?.quotes ?? [];
  const photos = order?.photos ?? [];
  const materials = order?.materials ?? [];

  const tabs: { id: TabId; label: string }[] = [
    { id: 'summary', label: 'Сводка' },
    { id: 'status', label: 'Статус и журнал' },
    { id: 'quotes', label: `Смета (${quotes.length})` },
    { id: 'photos', label: `Фото (${photos.length})` },
    { id: 'materials', label: `Материалы (${materials.length})` },
    { id: 'slot', label: 'Слот' },
    { id: 'actions', label: 'Действия' },
  ];

  return (
    <Modal title={title} onClose={onClose} wide>
      {loadError !== null && <ErrorBanner message={loadError} />}
      {!order && loadError === null && <Loading />}
      {order && (
        <>
          <div className="order-head">
            <StatusBadge status={order.status} />
            <GraphTypeBadge graphType={order.graphType} />
            {order.urgency === 'urgent' && <span className="badge badge--warning">Срочно +30%</span>}
            {order.urgency === 'emergency' && (
              <span className="badge badge--error">АВАРИЙНАЯ</span>
            )}
            <div className="order-head__sum">
              {formatSoums(order.totalFromTiyin)} — {formatSoums(order.totalToTiyin)}
            </div>
            <button
              type="button"
              className="btn"
              disabled={!ACT_STATUSES.has(order.status)}
              title={
                ACT_STATUSES.has(order.status)
                  ? 'Открыть печатный акт в новой вкладке'
                  : 'акт формируется после выполнения работ'
              }
              onClick={() => window.open(orderActUrl(order.id), '_blank', 'noopener')}
            >
              Акт (PDF)
            </button>
          </div>

          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'tab tab--active' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ---------- Вкладка «Сводка» ---------- */}
          {tab === 'summary' && (
            <>
              <dl className="kv">
                <dt>Клиент</dt>
                <dd>
                  {order.clientName || '—'} · {order.clientPhone}
                </dd>
                <dt>Адрес</dt>
                <dd>{order.address}</dd>
                <dt>Описание</dt>
                <dd>{order.description || '—'}</dd>
                <dt>Мастер</dt>
                <dd>{order.masterName ?? 'не назначен'}</dd>
                <dt>Создана</dt>
                <dd>{formatDateTime(order.createdAt)}</dd>
              </dl>

              <div className="section-title">Состав работ</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Работа</th>
                      <th>Ед.</th>
                      <th className="num">Кол-во</th>
                      <th className="num">От</th>
                      <th className="num">До</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          Работы не выбраны
                        </td>
                      </tr>
                    )}
                    {order.lines.map((line, i) => (
                      <tr key={i}>
                        <td>{line.name}</td>
                        <td>{line.unit}</td>
                        <td className="num">{line.qty}</td>
                        <td className="num">{formatSoums(line.priceFromTiyin * line.qty)}</td>
                        <td className="num">{formatSoums(line.priceToTiyin * line.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {order.promoCode && (
                <dl className="kv" style={{ marginTop: 'var(--s12)' }}>
                  <dt>База</dt>
                  <dd>
                    {formatSoums(order.baseFromTiyin)} — {formatSoums(order.baseToTiyin)}
                  </dd>
                  <dt>
                    Промокод {order.promoCode} −{order.promoDiscountPercent ?? 0}%
                  </dt>
                  <dd>
                    итог {formatSoums(order.totalFromTiyin)} — {formatSoums(order.totalToTiyin)}
                  </dd>
                </dl>
              )}

              <div className="section-title">Действия конвейера</div>
              {actionError !== null && <ErrorBanner message={actionError} />}
              {buttons.length === 0 && (
                <div className="muted">
                  Нет доступных переходов — заявка в терминальном статусе
                </div>
              )}
              {allowed.includes('assign') && (
                <div className="field" style={{ marginBottom: 'var(--s12)' }}>
                  <label htmlFor="master">Мастер (обязателен для назначения)</label>
                  <select id="master" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
                    <option value="">— выберите мастера —</option>
                    {masters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName} · {m.grade === 'gold' ? 'золото' : m.grade === 'silver' ? 'серебро' : 'бронза'} · рейтинг {m.rating} · {m.skillTags.join(', ')}
                      </option>
                    ))}
                  </select>
                  <div className="actions-row" style={{ marginTop: 'var(--s8)' }}>
                    <button type="button" className="btn" disabled={candBusy} onClick={() => void loadCandidates()}>
                      {candBusy ? 'Подбираем…' : 'Подобрать мастера'}
                    </button>
                  </div>
                  {candidates !== null && (
                    <div className="card" style={{ marginTop: 'var(--s8)' }}>
                      <div className="section-title" style={{ marginTop: 0 }}>
                        Кандидаты по правилам ТЗ 7.3
                      </div>
                      <div className="muted" style={{ marginBottom: 'var(--s8)' }}>
                        Фильтры: skill-теги, зона, загрузка ленты, оборудование, чёрный список точки. Ранжирование:
                        закреплённый мастер → грейд и рейтинг → свободная лента (ТЗ 7.3). Ручное назначение приоритетнее.
                      </div>
                      {candidates.candidates.length === 0 && <div className="muted">Подходящих мастеров нет</div>}
                      {candidates.candidates.map((c, i) => (
                        <div
                          key={c.masterId}
                          className="table-wrap"
                          style={{ padding: 'var(--s8)', marginBottom: 'var(--s4)', cursor: 'pointer' }}
                          onClick={() => setMasterId(c.masterId)}
                        >
                          <div>
                            <span className="semibold">{i === 0 ? '★ ' : ''}{c.masterName}</span>{' '}
                            <span className="badge badge--accent">{c.score} баллов</span>{' '}
                            {masterId === c.masterId && <span className="badge badge--success">выбран</span>}
                          </div>
                          <div className="muted">загрузка ленты {c.loadPercent}%</div>
                          {!c.hasShift && (
                            <div className="cand-warning">
                              нет смены на сегодня — создайте в «Лентах»
                            </div>
                          )}
                          <div className="muted">{c.reasons.join(' · ')}</div>
                        </div>
                      ))}
                      {candidates.rejected.length > 0 && (
                        <details style={{ marginTop: 'var(--s8)' }}>
                          <summary className="muted">Отсеяны: {candidates.rejected.length}</summary>
                          {candidates.rejected.map((c) => (
                            <div key={c.masterId} className="muted" style={{ marginTop: 'var(--s4)' }}>
                              {c.masterName} · загрузка {c.loadPercent}%: {c.blockers.join('; ')}
                            </div>
                          ))}
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}
              {(allowed.includes('open_dispute') ||
                allowed.includes('resolve_dispute') ||
                allowed.includes('return_to_work')) && (
                <div className="field" style={{ marginBottom: 'var(--s12)' }}>
                  <label htmlFor="reason">Причина (для спора / возврата в работу)</label>
                  <textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Например: клиент оспорил качество работ"
                  />
                </div>
              )}
              <div className="actions-row">
                {buttons.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={a === 'open_dispute' ? 'btn' : 'btn btn--primary'}
                    disabled={busy || (a === 'assign' && masterId === '')}
                    onClick={() => run(a)}
                  >
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>

              {relevantFlags.length > 0 && (
                <div className="conditions">
                  <div className="conditions__title">
                    Условия (dev-симуляция мобильного приложения)
                  </div>
                  <div className="conditions__grid">
                    {relevantFlags.map((f) => (
                      <label key={f} className="field--checkbox">
                        <input
                          type="checkbox"
                          checked={flags[f] === true}
                          onChange={(e) => setFlags((prev) => ({ ...prev, [f]: e.target.checked }))}
                        />
                        {FLAG_LABELS[f] ?? f}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------- Вкладка «Статус и журнал» ---------- */}
          {tab === 'status' && (
            <>
              <dl className="kv">
                <dt>Текущий статус</dt>
                <dd>
                  <StatusBadge status={order.status} />
                </dd>
              </dl>
              <div className="section-title">Журнал переходов</div>
              {(order.statusLog ?? []).length === 0 ? (
                <div className="muted">Журнал пуст</div>
              ) : (
                <ul className="statuslog">
                  {(order.statusLog ?? [])
                    .slice()
                    .reverse()
                    .map((entry, i) => (
                      <li key={i}>
                        <span className="statuslog__time">{formatDateTime(entry.at)}</span>
                        <span>
                          {LOG_ACTION_LABELS[entry.action] ?? entry.action}
                          {' · '}
                          {entry.from ? `${statusLabel(entry.from)} → ` : ''}
                          {statusLabel(entry.to)}
                        </span>
                        <span className="muted">{entry.actorPhone}</span>
                        {entry.reason && <span className="statuslog__reason">{entry.reason}</span>}
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}

          {/* ---------- Вкладка «Смета» ---------- */}
          {tab === 'quotes' && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th className="num">Сумма</th>
                      <th>Канал санкции</th>
                      <th>Примечание</th>
                      <th>Время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          Смет пока нет — первичная вилка появится при создании с работами
                        </td>
                      </tr>
                    )}
                    {quotes.map((q, i) => (
                      <tr key={i}>
                        <td>
                          <QuoteKindCell kind={q.kind} />
                        </td>
                        <td className="num">{formatSoums(q.amountTiyin)}</td>
                        <td>{q.approvedVia ? APPROVED_VIA_LABELS[q.approvedVia] ?? q.approvedVia : '—'}</td>
                        <td>{q.note ?? '—'}</td>
                        <td className="num">{formatDateTime(q.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tab-note">
                Вынужденная и апсейл — разные механизмы, не смешиваются (ТЗ 4.6).
              </div>
            </>
          )}

          {/* ---------- Вкладка «Фото» ---------- */}
          {tab === 'photos' && (
            <>
              <div className="banner">
                Камера-only, сжатие ~1600px/500 КБ, EXIF-очистка и вечное хранение — приложение
                мастера (PRD-05 §9). Здесь диспетчер прикладывает фото, присланные мастером вне
                приложения.
              </div>

              <div className="section-title" style={{ marginTop: 0 }}>
                Загрузить фото
              </div>
              {pError !== null && <ErrorBanner message={pError} />}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="p-file">Файл (JPEG, PNG, WebP — до 6 МБ)</label>
                  <input
                    id="p-file"
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      setPFile(e.target.files?.[0] ?? null);
                      setPError(null);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="p-stage">Стадия</label>
                  <select
                    id="p-stage"
                    value={pStage}
                    onChange={(e) => setPStage(e.target.value as OrderPhoto['stage'])}
                  >
                    <option value="before">До</option>
                    <option value="during">В процессе</option>
                    <option value="after">После</option>
                    <option value="receipt">Чек</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="p-note">Примечание</label>
                  <input
                    id="p-note"
                    value={pNote}
                    onChange={(e) => setPNote(e.target.value)}
                    placeholder="Например: прислал мастер в Telegram"
                  />
                </div>
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={pBusy || pFile === null}
                    onClick={uploadPhoto}
                  >
                    Загрузить
                  </button>
                </div>
              </div>

              <div className="section-title">Галерея</div>
              {photos.length === 0 ? (
                <div className="muted">
                  Фото пока нет — приложите присланное мастером или дождитесь загрузки из
                  приложения (M-13/M-27)
                </div>
              ) : (
                <div className="photo-grid">
                  {photos.map((p, i) => (
                    <div className="photo-card" key={p.id ?? i}>
                      {p.file ? (
                        <a href={photoUrl(p.file)} target="_blank" rel="noreferrer noopener">
                          <img
                            src={photoUrl(p.file)}
                            alt={`Фото «${PHOTO_STAGE_LABELS[p.stage] ?? p.stage}»`}
                          />
                        </a>
                      ) : (
                        <div className="photo-card__empty">отметка конвейера, файл не приложен</div>
                      )}
                      <div className="photo-card__cap">
                        <span className="photo-card__stage">
                          {PHOTO_STAGE_LABELS[p.stage] ?? p.stage}
                        </span>
                        <span>{formatDateTime(p.at)}</span>
                        {p.geoMissing === true && (
                          <span className="badge badge--warning">без гео</span>
                        )}
                      </div>
                      <div className="photo-card__source">{p.source}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="tab-note">
                Гео и серверный таймштамп — доказательная база при спорах (ТЗ 7.2).
              </div>
            </>
          )}

          {/* ---------- Вкладка «Материалы» ---------- */}
          {tab === 'materials' && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th>Название</th>
                      <th className="num">Сумма</th>
                      <th>Источник</th>
                      <th>Чек</th>
                      <th>Вилка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          Материалы пока не внесены
                        </td>
                      </tr>
                    )}
                    {materials.map((m, i) => (
                      <tr key={i}>
                        <td>{MATERIAL_KIND_LABELS[m.kind] ?? m.kind}</td>
                        <td>{m.name}</td>
                        <td className="num">{formatSoums(m.amountTiyin)}</td>
                        <td>{MATERIAL_SOURCE_LABELS[m.sourceChannel] ?? m.sourceChannel}</td>
                        <td>{m.hasReceipt ? 'Да' : '—'}</td>
                        <td>{m.priceTier ? PRICE_TIER_LABELS[m.priceTier] ?? m.priceTier : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="kv" style={{ marginTop: 'var(--s12)' }}>
                <dt>Итого материалы</dt>
                <dd>{formatSoums(order.totalMaterialTiyin ?? 0)}</dd>
              </dl>

              <div className="section-title">Добавить материал</div>
              {mError !== null && <ErrorBanner message={mError} />}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="m-kind">Тип</label>
                  <select
                    id="m-kind"
                    value={mKind}
                    onChange={(e) => setMKind(e.target.value as 'spare_part' | 'consumable')}
                  >
                    <option value="spare_part">Запчасть</option>
                    <option value="consumable">Расходник «сумки»</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="m-name">Название</label>
                  <input
                    id="m-name"
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    placeholder="Например: смеситель Vidima"
                  />
                </div>
                <div className="field">
                  <label htmlFor="m-soums">Сумма, сум</label>
                  <input
                    id="m-soums"
                    inputMode="numeric"
                    value={mSoums}
                    onChange={(e) => setMSoums(e.target.value)}
                    placeholder="250 000"
                  />
                </div>
                <div className="field">
                  <label htmlFor="m-source">Источник</label>
                  <select id="m-source" value={mSource} onChange={(e) => setMSource(e.target.value)}>
                    <option value="partner_store">Партнёрский магазин</option>
                    <option value="master_own">Мастер за свои</option>
                    <option value="client_self">Клиент сам</option>
                    <option value="company_stock">Склад компании</option>
                  </select>
                </div>
                <label className="field--checkbox">
                  <input
                    type="checkbox"
                    checked={mReceipt}
                    onChange={(e) => setMReceipt(e.target.checked)}
                  />
                  Чек есть
                </label>
                {tierNeeded && (
                  <div className="field">
                    <label htmlFor="m-tier">Вилка (запчасть дороже 200 000 сум)</label>
                    <select id="m-tier" value={mTier} onChange={(e) => setMTier(e.target.value)}>
                      <option value="">— выберите вилку —</option>
                      <option value="economy">Эконом</option>
                      <option value="standard">Стандарт</option>
                      <option value="premium">Премиум</option>
                    </select>
                  </div>
                )}
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={mBusy || mName.trim() === '' || !(mSoumsNum > 0)}
                    onClick={addMaterial}
                  >
                    Добавить
                  </button>
                </div>
              </div>
              <div className="tab-note">
                Запчасть — всегда с чеком; расходники — по фикс-прайсу без чека (ТЗ 8.4).
              </div>
            </>
          )}

          {/* ---------- Вкладка «Слот» (планировщик D-05) ---------- */}
          {tab === 'slot' && <SlotTab orderId={order.id} onChanged={onChanged} />}

          {/* ---------- Вкладка «Действия» ---------- */}
          {tab === 'actions' && (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>
                Переназначить мастера
              </div>
              {reError !== null && <ErrorBanner message={reError} />}
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="re-master">Новый мастер</label>
                  <select
                    id="re-master"
                    value={reMasterId}
                    disabled={!reassignAllowed}
                    onChange={(e) => setReMasterId(e.target.value)}
                  >
                    <option value="">— выберите мастера —</option>
                    {masters
                      .filter((m) => m.id !== order.masterId)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} · {m.grade === 'gold' ? 'золото' : m.grade === 'silver' ? 'серебро' : 'бронза'} · рейтинг {m.rating} · {m.skillTags.join(', ')}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="re-reason">Причина переназначения (обязательна, D-15)</label>
                  <textarea
                    id="re-reason"
                    value={reReason}
                    disabled={!reassignAllowed}
                    onChange={(e) => setReReason(e.target.value)}
                    placeholder="Например: мастер заболел"
                  />
                </div>
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!reassignAllowed || reBusy || reMasterId === '' || reReason.trim() === ''}
                    title={
                      reassignAllowed
                        ? undefined
                        : 'Переназначение доступно на статусах «Назначена»…«Доп-согласование» (ТЗ 4.5)'
                    }
                    onClick={reassign}
                  >
                    Переназначить
                  </button>
                  {!reassignAllowed && (
                    <span className="muted">
                      Доступно на статусах «Назначена»…«Доп-согласование» (ТЗ 4.5)
                    </span>
                  )}
                </div>
              </div>

              <div className="section-title">Отмена заявки</div>
              {cancelError !== null && <ErrorBanner message={cancelError} />}
              {!allowed.includes('cancel') && (
                <div className="muted">Отмена недоступна на текущем статусе</div>
              )}
              {allowed.includes('cancel') && preview === null && (
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={previewBusy}
                    onClick={loadCancelPreview}
                  >
                    Отменить заявку
                  </button>
                  <span className="muted">Сначала — предпросмотр денежных последствий (ТЗ 4.4)</span>
                </div>
              )}
              {allowed.includes('cancel') && preview !== null && (
                <>
                  <div className="cancel-preview">
                    <div className="cancel-preview__row">
                      <span>Клиент платит</span>
                      <strong>{formatSoums(preview.clientPaysTiyin)}</strong>
                    </div>
                    <div className="cancel-preview__row">
                      <span>Компенсация мастеру</span>
                      <strong>
                        {preview.masterCompTiyin == null
                          ? 'считает биллинг'
                          : formatSoums(preview.masterCompTiyin)}
                      </strong>
                    </div>
                    {preview.conditional && (
                      <>
                        <div className="cancel-preview__row">
                          <span>Более чем за 2 ч до окна</span>
                          <strong>бесплатно</strong>
                        </div>
                        <div className="cancel-preview__row">
                          <span>Менее 2 ч (ложный вызов): клиент / мастеру</span>
                          <strong>
                            {formatSoums(preview.conditional.lateCancelClientTiyin)} /{' '}
                            {formatSoums(preview.conditional.lateCancelMasterTiyin)}
                          </strong>
                        </div>
                      </>
                    )}
                    <div className="cancel-preview__note">{preview.note}</div>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="cancel-reason">Причина отмены (обязательна)</label>
                      <textarea
                        id="cancel-reason"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Например: клиент отказался от заявки"
                      />
                    </div>
                    <div className="actions-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || cancelReason.trim() === ''}
                        onClick={() => run('cancel', cancelReason)}
                      >
                        Подтвердить отмену
                      </button>
                      <button type="button" className="btn btn--link" onClick={() => setPreview(null)}>
                        Передумал
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
