import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, soumsToTiyin } from '../format';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { PriceDiff, PriceItem, PriceReleaseDetail } from '../types';

type PatchField = 'priceFromTiyin' | 'priceToTiyin' | 'normHours';

interface EditableCellProps {
  item: PriceItem;
  field: PatchField;
  editable: boolean;
  onSave: (itemId: string, patch: Partial<Pick<PriceItem, PatchField>>) => Promise<void>;
}

/** Инлайн-редактор ячейки: input по клику, PATCH по blur. Цены вводятся в сумах. */
function EditableCell({ item, field, editable, onSave }: EditableCellProps) {
  const isMoney = field !== 'normHours';
  const raw = item[field];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const display = isMoney
    ? formatSoums(raw as number)
    : raw === null
      ? '—'
      : String(raw);

  const missingNorm = field === 'normHours' && raw === null;
  const classes = [
    'num',
    missingNorm ? 'cell--missing' : '',
    editable ? 'cell--editable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = missingNorm
    ? 'Заполнить — без нормо-часов не работает планировщик'
    : undefined;

  const startEdit = () => {
    if (!editable) return;
    setText(
      isMoney ? String(Math.round((raw as number) / 100)) : raw === null ? '' : String(raw),
    );
    setEditing(true);
  };

  const commit = async () => {
    setEditing(false);
    const trimmed = text.trim().replace(',', '.');
    if (isMoney) {
      const n = Number(trimmed);
      if (trimmed === '' || Number.isNaN(n) || n < 0) return;
      const tiyin = soumsToTiyin(n);
      if (tiyin === raw) return;
      await onSave(item.id, { [field]: tiyin });
    } else {
      const next = trimmed === '' ? null : Number(trimmed);
      if (next !== null && (Number.isNaN(next) || next < 0)) return;
      if (next === raw) return;
      await onSave(item.id, { normHours: next });
    }
  };

  if (editing) {
    return (
      <td className="num">
        <input
          className="cell-input"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </td>
    );
  }

  return (
    <td className={classes} title={title} onClick={startEdit}>
      {display}
    </td>
  );
}

/**
 * Название позиции на узбекском: редактируется всегда, включая боевой прайс.
 *
 * Пустая ячейка помечена, а не оставлена пустой: незаполненный перевод — это
 * позиция, которую узбекский мастер увидит по-русски, и владелец должен видеть
 * их одним взглядом, а не искать по списку из ста тридцати шести строк.
 */
function NameUzCell({
  item,
  onSave,
}: {
  item: PriceItem;
  onSave: (itemId: string, nameUz: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const commit = async () => {
    setEditing(false);
    const next = text.trim();
    if (next === (item.nameUz ?? '')) return;
    await onSave(item.id, next === '' ? null : next);
  };

  if (editing) {
    return (
      <td>
        <input
          className="cell-input"
          autoFocus
          value={text}
          placeholder="Nomi o‘zbekcha"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </td>
    );
  }

  return (
    <td
      className={item.nameUz ? 'cell--editable' : 'cell--editable cell--missing'}
      title={item.nameUz ? 'Изменить перевод' : 'Без перевода — мастер увидит русское название'}
      onClick={() => {
        setText(item.nameUz ?? '');
        setEditing(true);
      }}
    >
      {item.nameUz ?? 'не переведено'}
    </td>
  );
}

/** Чипы атрибутов позиции: skill-фильтр, оборудование, парная, этапная (ТЗ 3.7/4.1/4.5) */
function AttrChips({ item }: { item: PriceItem }) {
  const chips = [
    ...item.requiredSkills.map((s) => `skill: ${s}`),
    ...(item.requiresEquipment ? ['оборудование'] : []),
    ...(item.isPaired ? ['парная'] : []),
    ...(item.isStaged ? ['этапная'] : []),
  ];
  if (chips.length === 0) return <span className="muted">—</span>;
  return (
    <>
      {chips.map((c) => (
        <span className="chip" key={c}>
          {c}
        </span>
      ))}
    </>
  );
}

/** Мини-модал правки атрибутов позиции (только draft-релиз) */
function AttrsModal({
  item,
  onClose,
  onSave,
}: {
  item: PriceItem;
  onClose: () => void;
  onSave: (
    itemId: string,
    patch: Pick<PriceItem, 'requiredSkills' | 'requiresEquipment' | 'isPaired' | 'isStaged'>,
  ) => Promise<void>;
}) {
  const [skillsText, setSkillsText] = useState(item.requiredSkills.join(', '));
  const [requiresEquipment, setRequiresEquipment] = useState(item.requiresEquipment);
  const [isPaired, setIsPaired] = useState(item.isPaired);
  const [isStaged, setIsStaged] = useState(item.isStaged);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(item.id, {
        requiredSkills: skillsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        requiresEquipment,
        isPaired,
        isStaged,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Атрибуты: ${item.name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="attr-skills">Skill-теги (через запятую)</label>
          <input
            id="attr-skills"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="сантехника, электрика"
            autoFocus
          />
        </div>
        <div className="field field--checkbox">
          <input
            id="attr-equipment"
            type="checkbox"
            checked={requiresEquipment}
            onChange={(e) => setRequiresEquipment(e.target.checked)}
          />
          <label htmlFor="attr-equipment" style={{ margin: 0 }}>
            Требует оборудование
          </label>
        </div>
        <div className="field field--checkbox">
          <input
            id="attr-paired"
            type="checkbox"
            checked={isPaired}
            onChange={(e) => setIsPaired(e.target.checked)}
          />
          <label htmlFor="attr-paired" style={{ margin: 0 }}>
            Парная (цена включает второго исполнителя, ТЗ 4.5)
          </label>
        </div>
        <div className="field field--checkbox">
          <input
            id="attr-staged"
            type="checkbox"
            checked={isStaged}
            onChange={(e) => setIsStaged(e.target.checked)}
          />
          <label htmlFor="attr-staged" style={{ margin: 0 }}>
            Этапная (план этапов с паузами, ТЗ 4.1)
          </label>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PriceReleaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload, setData } = useFetch<PriceReleaseDetail>(
    () => api.get<PriceReleaseDetail>(`/admin/price-releases/${id}`),
    [id],
  );
  const [diff, setDiff] = useState<PriceDiff | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [attrsFor, setAttrsFor] = useState<PriceItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const isDraft = data.status === 'draft';

  const saveItem = async (
    itemId: string,
    patch: Partial<
      Pick<PriceItem, PatchField | 'requiredSkills' | 'requiresEquipment' | 'isPaired' | 'isStaged'>
    >,
  ) => {
    setActionError(null);
    try {
      const updated = await api.patch<PriceItem>(
        `/admin/price-releases/${data.id}/items/${itemId}`,
        patch,
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((it) => (it.id === itemId ? { ...it, ...updated } : it)),
            }
          : prev,
      );
      toast('Сохранено');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Узбекское название правится и в активном релизе — своей ручкой.
   *
   * Оно не меняет ни цену, ни состав работ, поэтому не подпадает под запрет
   * правок в боевом прайсе. Держать перевод до ближайшей смены цен значило бы,
   * что узбекский мастер до тех пор читает каталог по-русски.
   */
  const saveNameUz = async (itemId: string, nameUz: string | null) => {
    setActionError(null);
    try {
      const updated = await api.patch<PriceItem>(
        `/admin/price-releases/${data.id}/items/${itemId}/name-uz`,
        { nameUz },
      );
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((it) => (it.id === itemId ? { ...it, ...updated } : it)) } : prev,
      );
      toast(nameUz ? 'Перевод сохранён' : 'Перевод убран');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const openDiff = async () => {
    setActionError(null);
    try {
      const d = await api.get<PriceDiff>(`/admin/price-releases/${data.id}/diff`);
      setDiff(d);
      setDiffOpen(true);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const activate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/price-releases/${data.id}/activate`, {});
      toast('Релиз активирован');
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SECOND_ADMIN_REQUIRED') {
        const ok = window.confirm(
          'Крупный релиз (>20% позиций или рост цены >30%) требует подтверждения второго администратора (ТЗ 3.7). Подтвердить активацию?',
        );
        if (ok) {
          try {
            await api.post(`/admin/price-releases/${data.id}/activate`, {
              secondAdminConfirmed: true,
            });
            toast('Релиз активирован');
            reload();
          } catch (e2) {
            setActionError(e2 instanceof Error ? e2.message : String(e2));
          }
        }
      } else {
        setActionError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  // Группировка по категориям с сохранением порядка позиций
  const groups: { category: string; items: PriceItem[] }[] = [];
  for (const item of data.items) {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }

  return (
    <>
      <div className="page-header">
        <h1>
          Релиз прайса №{data.number} <StatusBadge status={data.status} />
        </h1>
        <div style={{ display: 'flex', gap: 'var(--s8)' }}>
          <button type="button" className="btn" onClick={() => navigate('/price-releases')}>
            К списку
          </button>
          <button type="button" className="btn" onClick={() => void openDiff()}>
            Diff
          </button>
          {isDraft && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void activate()}
            >
              Активировать
            </button>
          )}
        </div>
      </div>

      {data.status === 'active' && (
        <div className="banner banner--warning">
          Боевой прайс нередактируем — правки только в черновике релиза (ТЗ 3.7)
        </div>
      )}
      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Услуга</th>
              <th>Название на узбекском</th>
              <th>Ед.</th>
              <th className="num">B2C от</th>
              <th className="num">B2C до</th>
              <th className="num">Нормо-часы</th>
              <th>Атрибуты</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Пока пусто
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <FragmentGroup
                key={group.category}
                group={group}
                editable={isDraft}
                onSave={saveItem}
                onSaveNameUz={saveNameUz}
                onEditAttrs={setAttrsFor}
              />
            ))}
          </tbody>
        </table>
      </div>

      {attrsFor && (
        <AttrsModal
          item={attrsFor}
          onClose={() => setAttrsFor(null)}
          onSave={saveItem}
        />
      )}

      {diffOpen && diff && (
        <Modal title="Изменения относительно активного релиза" wide onClose={() => setDiffOpen(false)}>
          <p className="muted">
            Изменено позиций: {diff.changes.length} ({Math.round(diff.changedShare * 100)}% прайса)
          </p>
          {diff.changes.length === 0 ? (
            <p>Изменений нет.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Услуга</th>
                    <th>Изменение</th>
                    <th className="num">Рост</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changes.map((c) => (
                    <tr key={c.num}>
                      <td className="num">{c.num}</td>
                      <td>{c.name}</td>
                      <td>
                        {c.kind === 'added'
                          ? 'Новая позиция'
                          : c.from && c.to
                            ? `${formatSoums(c.from[0])} – ${formatSoums(c.from[1])} → ${formatSoums(c.to[0])} – ${formatSoums(c.to[1])}`
                            : 'Цена изменена'}
                      </td>
                      <td className="num">
                        {c.kind === 'price_changed' && c.growth !== null && c.growth !== undefined
                          ? `${c.growth > 0 ? '+' : ''}${Math.round(c.growth * 100)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function FragmentGroup({
  group,
  editable,
  onSave,
  onSaveNameUz,
  onEditAttrs,
}: {
  group: { category: string; items: PriceItem[] };
  editable: boolean;
  onSave: EditableCellProps['onSave'];
  onSaveNameUz: (itemId: string, nameUz: string | null) => Promise<void>;
  onEditAttrs: (item: PriceItem) => void;
}) {
  return (
    <>
      <tr className="row--category">
        <td colSpan={9}>{group.category}</td>
      </tr>
      {group.items.map((item) => (
        <tr key={item.id}>
          <td className="num">{item.num}</td>
          <td>{item.name}</td>
          <NameUzCell item={item} onSave={onSaveNameUz} />
          <td className="muted">{item.unit}</td>
          <EditableCell item={item} field="priceFromTiyin" editable={editable} onSave={onSave} />
          <EditableCell item={item} field="priceToTiyin" editable={editable} onSave={onSave} />
          <EditableCell item={item} field="normHours" editable={editable} onSave={onSave} />
          <td
            className={editable ? 'cell--editable' : undefined}
            title={editable ? 'Изменить атрибуты позиции' : undefined}
            onClick={editable ? () => onEditAttrs(item) : undefined}
          >
            <AttrChips item={item} />
          </td>
          <td className="muted">{item.note ?? ''}</td>
        </tr>
      ))}
    </>
  );
}
