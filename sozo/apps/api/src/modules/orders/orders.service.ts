import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { GraphType, TransitionRequest } from '@sozo/contracts';
import {
  createOrderStateMachine,
  emptyContext,
  uuidv7,
  MASTER_SHARE_DEFAULT_PERMILLE,
  sharePermilleFor,
  type TransitionContext,
} from '@sozo/kernel';
import { ORDER_REPOSITORY, type OrderRecord, type OrderRepository } from './order.repository';
import { PricingService } from '../pricing/pricing.service';
import { EventBus, type OrderClosedEvent, type OrderStatusChangedEvent } from '../../common/event-bus';
import { AccessService } from '../access/access.service';
import { BuildingsService } from '../buildings/buildings.service';
import { SlaService } from '../sla/sla.service';
import { CrmService } from '../crm/crm.service';
import { AffiliationService } from '../masters/affiliation.service';
import { PromoService } from '../promo/promo.module';
import { ParametersService } from '../platform/parameters.service';
import { StateStore } from '../../common/state-store';
import { localHour } from '../../common/tz';

export interface CreateOrderDto {
  clientPhone: string;
  clientName?: string;
  address: string;
  lat?: number;
  lng?: number;
  description?: string;
  urgency?: 'normal' | 'urgent' | 'emergency';
  source?: 'phone' | 'app' | 'landing';
  organizationId?: string;
  locationId?: string;
  promoCode?: string;
  items?: Array<{ priceItemId: string; qty?: number }>;
  /**
   * Заявка из подписанной позиции акта осмотра — граф from_defect (DEV-10 §4.6).
   *
   * `estimatedAt` — когда позицию оценили на объекте. Без него заявку создать
   * нельзя: единственный guard этого графа проверяет, что оценке меньше 30
   * дней, а раньше признак свежести жёстко проставлялся как `true`, то есть
   * guard был выключен. `estimateTiyin` — цена из акта: без неё заявка
   * создавалась с нулевой сметой, и граф не содержит ни одного действия,
   * которым цену можно было бы проставить потом.
   */
  fromDefect?: { actId: string; itemId: string; estimatedAt?: string; estimateTiyin?: number | null };
  /**
   * Сумма работ, назначенная вне прайса (акт осмотра, оценка офиса).
   *
   * Заводится ровно там, где позиции прайса нет по природе: дефект из акта
   * описан словами, а не кодом работы.
   */
  manualEstimateTiyin?: number;
  /** Плановый обход точки: чек-лист и акт вместо фото-цикла — граф inspection (ТЗ 9.3) */
  inspection?: boolean;
  /** Выбранное клиентом время (C-10): пожелание до брони в ленте мастера */
  requestedWindow?: OrderRecord['requestedWindow'];
  /** Чек-лист доступа к общим зонам (C-11) */
  commonAreaAccess?: OrderRecord['commonAreaAccess'];
  /** Детали доступа, если клиент указал их сразу (сохранённый адрес, C-29) */
  addressDetails?: OrderRecord['addressDetails'];
  /** Мастер, которого клиент попросил запомнить (C-21) — мягкий приоритет */
  preferredMasterId?: string;
  /**
   * Ключ идемпотентности создания.
   *
   * Приходит заголовком `Idempotency-Key` из приложения и живёт в черновике,
   * переживая выгрузку процесса. Нужен ровно для одного случая: сервер заявку
   * создал, ответ не доехал (таймаут на пяти фотографиях в base64), человек
   * жмёт «Отправить» ещё раз. Единственной защитой была проверка дубля по
   * адресу за сутки, требующая ручного решения, — то есть человек в лучшем
   * случае видел вопрос, а в худшем заводил вторую заявку.
   */
  idempotencyKey?: string;
  // ---- контур «Дом» (M7) ----
  /** Развилка первого шага C-07: «в моей квартире» или «в доме» (общее имущество) */
  scope?: 'private' | 'common_area';
  /** Житель выбрал исполнителем службу оператора по её прайсу, а не мастера платформы */
  providerOperator?: boolean;
  /** Позиция собственного прайса оператора, если выбран он */
  operatorPriceItemId?: string;
}

/**
 * Кто выполняет переход.
 *
 * Роли нужны не для доступа — его проверяет guard на контроллере, — а для
 * того, чтобы решить, чьи утверждения о мире вообще принимать. Диспетчер по
 * телефонному каналу отмечает то, чего в системе нет физически («фото у
 * мастера на руках»), мастер сообщает факты с объекта, а клиент не сообщает
 * ничего: всё, что относится к клиенту, у сервера уже записано.
 */
export interface TransitionActor {
  phone?: string;
  roles?: string[];
}

/**
 * Флаги, которые сервер принимать обязан, потому что источник факта — человек
 * на объекте, а не запись в базе. Их присылает приложение мастера.
 */
const FIELD_FLAGS = [
  'restorationDeclined',
  'checklistFilled',
  'representativeFixed',
  'faultQualified',
  'stageChainConfirmed',
] as const;

/**
 * Флаги телефонного канала: диспетчер отвечает за них лично, и они пишутся
 * на заявку с его телефоном. Мастеру и клиенту недоступны.
 */
const BACK_OFFICE_FLAGS = ['dispatcherSanction', 'moderationPassed', 'paymentCollected', 'photosBefore', 'photosAfter'] as const;

const BACK_OFFICE_ROLES = ['dispatcher', 'admin'];

/** Заглушка геокодера (PRD-05 §12.4): детерминированная точка в пределах Ташкента по хешу адреса */
function geocodeStub(address: string): { lat: number; lng: number } {
  let h = 0;
  for (const ch of address) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    lat: 41.311 + ((h % 1000) / 1000 - 0.5) * 0.12,
    lng: 69.279 + (((h >> 10) % 1000) / 1000 - 0.5) * 0.16,
  };
}

/**
 * Публичный сервис переходов — единственная точка смены статуса (DEV-10, PRD-05 §1).
 * Недопустимый переход → 409 с машиночитаемым телом.
 */
@Injectable()
export class OrdersService {
  private readonly sm = createOrderStateMachine();
  /**
   * Счётчик номеров — по тенанту и без гонки.
   *
   * Был один на процесс и восстанавливался внутри create(), между проверкой и
   * инкрементом стоял `await`: два параллельных создания получали один номер.
   * Уникальный индекс ронял вставку второй заявки, но в памяти она оставалась
   * и отдавалась всем чтениям до рестарта. Теперь восстановление вынесено в
   * общий промис на тенант, а инкремент после него синхронный.
   */
  private readonly seqByTenant = new Map<string, number>();
  private readonly seqInit = new Map<string, Promise<void>>();
  /**
   * Блок-лист B2C: долг блокирует новые заявки, кроме аварийных (ТЗ 4.4).
   *
   * Ключ — тенант и телефон: блокировка у одного владельца не должна закрывать
   * номер у всех. Живёт в снимке состояния, иначе снималась любым рестартом —
   * а рестарт на этой машине автоматический при каждой сборке.
   */
  private readonly blockedClients = new Map<string, { reason: string; at: string }>();

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly repo: OrderRepository,
    private readonly pricing: PricingService,
    private readonly bus: EventBus,
    private readonly access: AccessService,
    private readonly buildings: BuildingsService,
    private readonly sla: SlaService,
    private readonly promo: PromoService,
    private readonly params: ParametersService,
    private readonly crm: CrmService,
    private readonly affiliation: AffiliationService,
    private readonly store: StateStore,
  ) {
    this.store.register(
      'orders_blocklist',
      () => [...this.blockedClients.entries()].map(([key, v]) => ({ key, ...v })),
      (data) => {
        this.blockedClients.clear();
        for (const r of (data as Array<{ key: string; reason: string; at: string }>) ?? []) {
          this.blockedClients.set(r.key, { reason: r.reason, at: r.at });
        }
      },
    );
    this.registerProbes();
  }

  /**
   * Справка для допусков: существует ли такой снимок по этой заявке.
   *
   * Guard'ы наряда «фото до вскрытия» и «фото после восстановления»
   * проверяли наличие строки в теле запроса — достаточно было прислать
   * `"photoId":"x"`. Снимки живут здесь, а импортировать заявки в допуски
   * нельзя (DEV-07 §3), поэтому ответ отдаётся через шину.
   */
  private registerProbes(): void {
    this.bus.registerProbe<{ orderId: string; photoId: string }, boolean>('orders.photo_exists', (q) => {
      const order = this.repo.peek('t0', q.orderId);
      return !!order?.photos.some((ph) => ph.id === q.photoId);
    });
  }

  /**
   * Ставка доли мастера для этой заявки.
   *
   * Собирается в одном месте и едет в событии закрытия: биллинг не должен
   * ходить ни в прайс, ни в реестр мастеров (DEV-07 §3). База — коэффициент
   * релиза, по которому заявка посчитана (владелец меняет её в релизе, и
   * валидатор unit-экономики считает маржу именно по ней), надбавка — за
   * золотой грейд, тот самый, который мастеру показан в приложении.
   */
  masterSharePermilleFor(order: OrderRecord): number {
    let base = MASTER_SHARE_DEFAULT_PERMILLE;
    try {
      const coeffs = this.pricing.get(order.priceListReleaseId).coeffs as Record<string, unknown>;
      const v = Number(coeffs.masterSharePermille);
      if (Number.isFinite(v) && v > 0 && v <= 1000) base = BigInt(Math.round(v));
    } catch {
      // Релиз удалён — считаем по умолчанию, но молча не подменяем ставку
    }
    const grades = order.masterId
      ? this.bus.probe<{ masterId: string }, string | null>('masters.grade', { masterId: order.masterId })
      : [];
    return Number(sharePermilleFor(grades.find(Boolean) ?? null, base));
  }

  /**
   * Заявка, уже созданная по этому ключу.
   *
   * Окно — сутки: дольше держать нечего, черновик к этому моменту либо
   * отправлен, либо давно забыт.
   */
  private async byIdempotencyKey(tenantId: string, key: string, phone: string): Promise<OrderRecord | undefined> {
    const dayAgo = Date.now() - 24 * 3_600_000;
    const all = await this.repo.list(tenantId);
    return all.find(
      (o) => o.idempotencyKey === key && o.clientPhone === phone && new Date(o.createdAt).getTime() > dayAgo,
    );
  }

  private blockKey(tenantId: string, phone: string): string {
    return `${tenantId}:${phone}`;
  }

  /** Следующий номер заявки. Восстановление один раз на тенант, инкремент — без await внутри */
  private async nextNumber(tenantId: string, year: number): Promise<string> {
    if (!this.seqInit.has(tenantId)) {
      this.seqInit.set(
        tenantId,
        (async () => {
          const existing = await this.repo.list(tenantId);
          this.seqByTenant.set(tenantId, existing.reduce((max, o) => Math.max(max, Number(o.number.split('-').pop()) || 0), 0));
        })(),
      );
    }
    await this.seqInit.get(tenantId);
    const next = (this.seqByTenant.get(tenantId) ?? 0) + 1;
    this.seqByTenant.set(tenantId, next);
    return `Z-${year}-${String(next).padStart(6, '0')}`;
  }

  /**
   * Коэффициент срочности из параметра 5 («+30%»). Значение редактируется
   * админом как текст, поэтому число из него достаём разбором, а не парсингом
   * фиксированного формата; не разобрали — наценки нет (безопасно для клиента).
   *
   * Публичный: каталог отдаёт это число приложению клиента. Иначе визард
   * считает предварительный итог по зашитым «тридцати процентам», а сервер —
   * по параметру, и человек видит на экране итога одну сумму, а при оплате
   * другую.
   */
  urgentSurchargePercent(): number {
    const raw = this.params.list().find((p) => p.num === 5)?.value ?? '';
    // «+30%», «30 процентов», «30 проц.» — админ пишет как привык, и раньше
    // всё, кроме знака процента, давало ноль: наценка молча исчезала
    const m = /(\d+(?:[.,]\d+)?)\s*(?:%|проц)/i.exec(raw) ?? /(\d+(?:[.,]\d+)?)/.exec(raw);
    if (!m) return 0;
    const v = Number(m[1].replace(',', '.'));
    return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : 0;
  }

  /**
   * По какому релизу прайса считать заявку.
   *
   * Обычно — по действующему. Но годовой договор обещает замороженные цены,
   * и это обещание должно исполняться само: организация не обязана следить,
   * не вышел ли новый релиз. Замораживаем на первой заявке — раньше просто
   * нечего было замораживать, а к моменту подписания релиз уже известен.
   */
  private releaseFor(dto: CreateOrderDto) {
    const active = this.pricing.active();
    if (!dto.organizationId) return active;
    const org = this.crm.get(dto.organizationId);
    if (org.contractKind !== 'annual') return active;

    if (!org.priceReleaseIdFrozen) {
      org.priceReleaseIdFrozen = active.id;
      this.crm.touch();
      return active;
    }
    try {
      return this.pricing.get(org.priceReleaseIdFrozen);
    } catch {
      // Замороженный релиз удалили — считаем по действующему, но молча
      // подменять цены нельзя, поэтому возвращаем ссылку на актуальный
      return active;
    }
  }

  private graphTypeFor(dto: CreateOrderDto): GraphType {
    if (dto.urgency === 'emergency') return 'emergency'; // аварийная минует оценку (ТЗ 4.3)
    // Позиция акта уже подписана ответственным — заявка стартует сразу «Утверждена»
    if (dto.fromDefect) return 'from_defect';
    // Обход помещения: приоритет 8, завершается актом, а не оплатой
    if (dto.inspection) return 'inspection';
    return dto.locationId || dto.organizationId ? 'b2b' : 'b2c';
  }

  async create(tenantId: string, dto: CreateOrderDto, actorPhone?: string): Promise<OrderRecord> {
    if (!dto.clientPhone?.match(/^\+998\d{9}$/)) {
      throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Телефон клиента: +998XXXXXXXXX' });
    }
    // Тот же ключ в пределах суток — та же заявка, а не вторая
    if (dto.idempotencyKey) {
      const existing = await this.byIdempotencyKey(tenantId, dto.idempotencyKey, dto.clientPhone);
      if (existing) return existing;
    }
    const graphType = this.graphTypeFor(dto);
    const block = this.blockedClients.get(this.blockKey(tenantId, dto.clientPhone));
    if (block && graphType !== 'emergency') {
      throw new BadRequestException({
        code: 'CLIENT_BLOCKED',
        message: `Клиент заблокирован (${block.reason}) — новые заявки недоступны, кроме аварийных (ТЗ 4.4)`,
      });
    }
    /**
     * Свежесть оценки дефекта — по дате из акта, а не константой.
     *
     * `defectEstimateFresh: true` означало, что единственный guard графа
     * from_defect не проверял ничего: заявка по акту годичной давности
     * создавалась по ценам того года и уходила в работу.
     */
    const estimatedAt = dto.fromDefect?.estimatedAt ? Date.parse(dto.fromDefect.estimatedAt) : NaN;
    const defectEstimateFresh = Number.isFinite(estimatedAt) && Date.now() - estimatedAt <= 30 * 86_400_000;
    const res = this.sm.validate(graphType, 'create', emptyContext({ defectEstimateFresh }));
    if (!res.ok) throw new ConflictException(res.violation);

    // Фиксация релиза прайса на момент создания + копии цен (ТЗ 3.7)
    const release = this.releaseFor(dto);
    const lines = (dto.items ?? []).map((it) => {
      const item = release.items.find((p) => p.id === it.priceItemId);
      if (!item) throw new BadRequestException({ code: 'PRICE_ITEM_NOT_FOUND', message: 'Этой услуги нет в действующем прайсе — выберите работу заново', priceItemId: it.priceItemId });
      const qty = it.qty && it.qty > 0 ? it.qty : 1;
      return {
        priceItemId: item.id,
        name: item.name,
        unit: item.unit,
        priceFromTiyin: item.priceFromTiyin * qty,
        priceToTiyin: item.priceToTiyin * qty,
        qty,
      };
    });
    /**
     * Цена, назначенная вне прайса.
     *
     * Заявка из акта дефектов создавалась без позиций — база и итог равны
     * нулю, — а граф from_defect не содержит ни составления, ни подтверждения
     * сметы: действия, которым можно проставить цену, в нём нет вовсе. То
     * есть каждая заявка из подписанного акта выполнялась бесплатно: работа
     * ноль → подписчик биллинга выходит сразу, ни выручки, ни доли мастера.
     * Цену берём оттуда, где она уже есть, — из самой позиции акта.
     */
    const manual = Number(dto.manualEstimateTiyin ?? dto.fromDefect?.estimateTiyin ?? 0);
    if (dto.manualEstimateTiyin != null && !(Number.isSafeInteger(manual) && manual >= 0)) {
      throw new BadRequestException({ code: 'ESTIMATE_INVALID', message: 'Оценка — целое неотрицательное число тийинов' });
    }
    const manualTiyin = Number.isSafeInteger(manual) && manual > 0 ? manual : 0;
    const baseFrom = lines.reduce((s, l) => s + l.priceFromTiyin, 0) + manualTiyin;
    const baseTo = lines.reduce((s, l) => s + l.priceToTiyin, 0) + manualTiyin;
    /**
     * Заявка из акта без цены не создаётся.
     *
     * Граф from_defect не содержит ни составления, ни подтверждения сметы:
     * действия, которым можно проставить цену потом, в нём нет вовсе. Пустая
     * заявка тут — это работа, выполненная бесплатно и молча: подписчик
     * биллинга при закрытии выходит на первой же строке, ни выручки, ни доли
     * мастера, ни отчисления в резервный фонд. Лучше отказать и назвать
     * причину: позицию, которую нельзя оценить на месте, считает офис.
     */
    if (graphType === 'from_defect' && baseFrom <= 0) {
      throw new BadRequestException({
        code: 'DEFECT_ESTIMATE_REQUIRED',
        message: 'Позицию акта нельзя превратить в заявку без оценки — её должен посчитать офис',
        actId: dto.fromDefect?.actId,
        itemId: dto.fromDefect?.itemId,
      });
    }
    // Наценка «Срочно» — к работам, не к материалам (ТЗ 3.7, параметр 5).
    // Ложится только на итог клиенту: база остаётся прежней, иначе наценка
    // молча увеличила бы и долю мастера, а это отдельное решение владельца.
    const urgentPercent = dto.urgency === 'urgent' ? this.urgentSurchargePercent() : 0;
    const withUrgency = (v: number) => v + Math.floor((v * urgentPercent) / 100);
    /**
     * Промокод: скидка последней к итогу работ; долю мастера не трогает
     * (ТЗ 3.7, решение №13).
     *
     * На боевом пути звался `redeem(code)` — версия без телефона и без
     * признака первой заявки. Из-за этого приветственный код с
     * `firstOrderOnly` давал скидку на каждой заявке бесконечно, а
     * `@@unique([promoCodeId, phone])` в схеме не работал, потому что телефон
     * не записывался. Теперь тем же путём, что и в клиентском приложении:
     * проверка до создания, списание — после, и с привязкой к человеку.
     */
    let discount = 0;
    let isFirstOrder = false;
    if (dto.promoCode) {
      isFirstOrder = !(await this.repo.list(tenantId)).some((o) => o.clientPhone === dto.clientPhone);
      const verdict = this.promo.evaluate(dto.promoCode, { phone: dto.clientPhone, isFirstOrder });
      if (!verdict.valid) throw new BadRequestException({ code: 'PROMO_INVALID', message: verdict.message });
      discount = verdict.discountPercent;
    }
    const applyDiscount = (v: number) => Math.floor((withUrgency(v) * (100 - discount)) / 100);
    const geo = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : geocodeStub(dto.address ?? dto.clientPhone);

    const now = new Date();
    const number = await this.nextNumber(tenantId, now.getFullYear());
    const created = await this.repo.create({
      id: uuidv7(),
      tenantId,
      number,
      graphType,
      status: res.def.to,
      version: 0,
      urgency: dto.urgency ?? 'normal',
      source: dto.source ?? 'phone',
      clientPhone: dto.clientPhone,
      clientName: dto.clientName ?? '',
      address: dto.address ?? '',
      lat: geo.lat,
      lng: geo.lng,
      description: dto.description ?? '',
      organizationId: dto.organizationId,
      locationId: dto.locationId,
      lines,
      baseFromTiyin: baseFrom,
      baseToTiyin: baseTo,
      totalFromTiyin: applyDiscount(baseFrom),
      totalToTiyin: applyDiscount(baseTo),
      promoCode: dto.promoCode?.toUpperCase(),
      promoDiscountPercent: discount || undefined,
      urgentSurchargePercent: urgentPercent || undefined,
      requestedWindow: dto.requestedWindow,
      commonAreaAccess: dto.commonAreaAccess,
      addressDetails: dto.addressDetails,
      preferredMasterId: dto.preferredMasterId,
      idempotencyKey: dto.idempotencyKey,
      fromDefect: dto.fromDefect ? { actId: dto.fromDefect.actId, itemId: dto.fromDefect.itemId, estimatedAt: dto.fromDefect.estimatedAt } : undefined,
      priceListReleaseId: release.id,
      quotes: baseFrom > 0 ? [{ kind: 'initial', amountTiyin: applyDiscount(baseFrom), note: 'Первичная вилка «от» при создании', at: now.toISOString() }] : [],
      photos: [],
      materials: [],
      totalMaterialTiyin: 0,
      statusLog: [{ from: null, to: res.def.to, action: 'create', actorPhone, at: now }],
      createdAt: now,
      ...this.homeContext(tenantId, dto, now),
    });
    // Списание промокода — после успешного создания и с привязкой к телефону.
    // Раньше списывалось до: упало создание — код всё равно потрачен
    if (dto.promoCode && discount > 0) {
      try {
        this.promo.redeemFor(dto.promoCode, dto.clientPhone, isFirstOrder);
      } catch (e) {
        // Заявка уже создана и посчитана со скидкой: отменять её из-за
        // гонки за последним использованием кода хуже, чем отдать скидку
        // eslint-disable-next-line no-console
        console.error('[Orders] промокод не списался после создания заявки:', e);
      }
    }
    this.startSla(tenantId, created);
    /**
     * Аварийная заявка по общему имуществу, которую некому назначить.
     *
     * Диспетчер узнавал об этом, только попробовав назначить мастера, — то
     * есть в лучшем случае через минуты, в худшем через часы. Событие уходит
     * сразу при создании: авария на стояке не должна стоять в «Новой» молча.
     */
    if (created.graphType === 'emergency' && created.orderScope === 'common_area' && created.buildingId) {
      const operatorOrgId = this.buildings.get(tenantId, created.buildingId).operatorOrgId;
      const available = operatorOrgId ? this.affiliation.activeMasterIds(tenantId, operatorOrgId).length : 0;
      if (available === 0) {
        this.bus.publish(
          'order.unassignable',
          {
            orderId: created.id,
            number: created.number,
            buildingId: created.buildingId,
            operatorOrgId,
            address: created.address,
            reason: 'у эксплуатирующей организации нет действующих мастеров, а общее имущество мастеру платформы не назначается',
          },
          `order.unassignable:${created.id}`,
        );
      }
    }
    return created;
  }

  /**
   * Привязка заявки к объекту и окно права первой руки (DEV-15 §2, §7.5).
   *
   * Матчинг адреса не блокирует создание заявки: при неоднозначности поля остаются
   * пустыми, привязку делает диспетчер в D-06. Молчаливо угадывать дом нельзя —
   * ошибка привязки означает наряд не в тот объект.
   */
  private homeContext(
    tenantId: string,
    dto: CreateOrderDto,
    now: Date,
  ): Partial<OrderRecord> {
    const r = this.buildings.resolve(tenantId, dto.address ?? '');
    if (r.match !== 'exact' || !r.buildingId) return {};

    // Развилка, которую житель делает на первом шаге (C-07):
    //   «в моей квартире» → private  — платная работа, исполнителя выбирает житель;
    //   «в доме»          → common_area — зона ответственности оператора, для жителя бесплатно.
    const scope: 'private' | 'common_area' = dto.scope === 'common_area' ? 'common_area' : 'private';

    // Объект без подключённого оператора: общего имущества как отдельного контура нет.
    // Заявка на стояк в таком доме — обычная платная работа, как в v2.25.
    if (r.connectionStatus !== 'active') {
      return { buildingId: r.buildingId, orderScope: 'private' };
    }

    if (scope === 'common_area') {
      // Общее имущество: окна первой руки нет — заявка ВСЕГДА и только у службы
      // оператора, в общий пул платформы она не уходит ни при каких условиях
      // (ТЗ §19.3 п.5). Денег с жителя за неё не берём.
      return {
        buildingId: r.buildingId,
        orderScope: 'common_area',
        claimedByOperator: this.buildings.get(tenantId, r.buildingId).operatorOrgId ?? undefined,
        laborSettlement: 'salary',
      };
    }

    // Житель выбрал исполнителем службу оператора по её собственному прайсу —
    // платформа в деньгах не участвует, окно первой руки не нужно: выбор уже сделан.
    if (dto.providerOperator) {
      return {
        buildingId: r.buildingId,
        orderScope: 'private',
        claimedByOperator: this.buildings.get(tenantId, r.buildingId).operatorOrgId ?? undefined,
        laborSettlement: 'salary',
      };
    }

    // Окно первой руки: рабочее время — 30 мин, нерабочее — 10 (параметры 129–130).
    // Рабочее время местное: «8–20» по `getHours()` на UTC-сервере означало
    // 13:00–01:00 по Ташкенту — то есть окно первой руки жило по чужим часам
    const hour = localHour(now);
    const working = hour >= 8 && hour < 20;
    const minutes = working ? 30 : 10;
    return {
      buildingId: r.buildingId,
      orderScope: 'private',
      firstRefusalUntil: new Date(now.getTime() + minutes * 60_000).toISOString(),
      laborSettlement: 'share',
    };
  }

  /**
   * Постановка SLA-дедлайнов на заявку подключённого объекта (DEV-15 §7.2).
   * Политика подбирается каскадом; если у оператора политик нет — SLA не ставится,
   * и это нормально: Free-тариф SLA-контроля не включает.
   */
  private startSla(tenantId: string, order: OrderRecord): void {
    if (!order.buildingId) return;
    const b = this.buildings.listBuildings(tenantId).find((x) => x.id === order.buildingId);
    if (!b?.operatorOrgId) return;
    const policy = this.sla.resolvePolicy(tenantId, b.operatorOrgId, {
      buildingId: order.buildingId,
      priority: order.graphType === 'emergency' ? 'critical' : 'normal',
      scope: order.orderScope ?? 'private',
    });
    if (!policy) return;
    this.sla.start(tenantId, order.id, policy);
  }

  /**
   * Очередь окна первой руки для кабинета (U-04).
   *
   * Показываем и уже истёкшие за последний час: диспетчер оператора должен
   * видеть, что он упустил, — иначе окно молча тикает и статистика «сколько
   * служба не тянет» собирается без его ведома.
   */
  async firstRefusalQueue(tenantId: string, buildingIds: string[], now = Date.now()) {
    const all = await this.repo.list(tenantId);
    const recent = now - 3_600_000;
    return all
      .filter(
        (o) =>
          o.buildingId &&
          buildingIds.includes(o.buildingId) &&
          o.firstRefusalUntil &&
          !o.claimedByOperator &&
          Date.parse(o.firstRefusalUntil) > recent &&
          o.status !== 'cancelled',
      )
      .map((o) => ({
        id: o.id,
        number: o.number,
        buildingId: o.buildingId,
        description: o.description,
        address: o.address,
        addressDetails: o.addressDetails ?? null,
        totalFromTiyin: o.totalFromTiyin,
        firstRefusalUntil: o.firstRefusalUntil,
        expired: Date.parse(o.firstRefusalUntil!) <= now,
        releasedReason: o.releasedReason ?? null,
        createdAt: o.createdAt,
      }))
      .sort((a, b) => Date.parse(a.firstRefusalUntil!) - Date.parse(b.firstRefusalUntil!));
  }

  /** Статистика отказов за период — аргумент оператору на продление подписки */
  async firstRefusalStats(tenantId: string, buildingIds: string[], days = 30) {
    const all = await this.repo.list(tenantId);
    const since = Date.now() - days * 86_400_000;
    const scoped = all.filter(
      (o) => o.buildingId && buildingIds.includes(o.buildingId) && Date.parse(String(o.createdAt)) >= since,
    );
    const taken = scoped.filter((o) => o.claimedByOperator).length;
    const released = scoped.filter((o) => o.releasedReason).length;
    const reasons = new Map<string, number>();
    for (const o of scoped) {
      if (o.releasedReason) reasons.set(o.releasedReason, (reasons.get(o.releasedReason) ?? 0) + 1);
    }
    return {
      days,
      taken,
      released,
      topReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    };
  }

  /** Служба оператора забирает заявку себе (U-04) */
  async claimByOperator(tenantId: string, orderId: string, operatorOrgId: string): Promise<OrderRecord> {
    const order = await this.record(tenantId, orderId);
    if (!order.firstRefusalUntil) {
      throw new BadRequestException({ code: 'NO_FIRST_REFUSAL', message: 'По этой заявке окна первой руки нет' });
    }
    if (Date.parse(order.firstRefusalUntil) < Date.now()) {
      throw new ConflictException({ code: 'FIRST_REFUSAL_EXPIRED', message: 'Окно истекло, заявка ушла в общий пул' });
    }
    order.claimedByOperator = operatorOrgId;
    // заявка выполняется своей службой: платформа в деньгах не участвует (DEV-15 §8.5)
    order.laborSettlement = 'salary';
    this.touchOrder(orderId);
    this.bus.publish('first_refusal.claimed', { orderId, operatorOrgId });
    return order;
  }

  /** Отпустить в общий пул с причиной — статистика «сколько служба не тянет» */
  async releaseByOperator(tenantId: string, orderId: string, reason: string): Promise<OrderRecord> {
    const order = await this.record(tenantId, orderId);
    order.releasedReason = reason;
    order.firstRefusalUntil = new Date(Date.now() - 1000).toISOString();
    order.claimedByOperator = undefined;
    order.laborSettlement = 'share';
    this.touchOrder(orderId);
    this.bus.publish('first_refusal.released', { orderId, reason });
    return order;
  }

  async list(tenantId: string): Promise<OrderRecord[]> {
    return this.repo.list(tenantId);
  }

  /**
   * Заявка для ответа API: копия с вычисленными действиями.
   * ВНИМАНИЕ: это снимок — присваивание полей на нём не сохраняется.
   * Для изменения полей берите record(), а не get().
   */
  async get(tenantId: string, orderId: string): Promise<OrderRecord & { allowedActions: string[] }> {
    const order = await this.record(tenantId, orderId);
    return { ...order, allowedActions: this.sm.allowedActions(order.graphType, order.status) };
  }

  /**
   * Живая запись заявки для мутаций (смета, пауза, приёмка, итоги).
   * После изменения обязателен touchOrder() — иначе правка не переживёт рестарт.
   */
  allowedActionsFor(order: OrderRecord): string[] {
    return this.sm.allowedActions(order.graphType, order.status);
  }

  /**
   * Заявка, которой принадлежит файл снимка.
   *
   * Нужна отдаче фото: имя файла — uuidv7, перебор нереален, но привязки к
   * заявке у файла не было вовсе, и любой валидный токен отдавал любой
   * снимок — включая часовой токен публичной веб-карточки.
   */
  async orderByPhotoFile(tenantId: string, file: string): Promise<OrderRecord | undefined> {
    const all = await this.repo.list(tenantId);
    return all.find((o) => o.photos.some((ph) => ph.file === file));
  }

  /**
   * Имеет ли этот человек право видеть заявку.
   *
   * Бэк-офис — по роли, клиент — по своему телефону, мастер — по назначению.
   * Раньше проверки владельца не было вовсе: `GET /v1/orders/<uuid>` отдавал
   * чужую заявку целиком — телефон клиента, адрес, суммы, журнал статусов.
   */
  mayView(order: OrderRecord, actor: TransitionActor): boolean {
    const roles = actor.roles ?? [];
    if (roles.some((r) => BACK_OFFICE_ROLES.includes(r) || r === 'accountant')) return true;
    if (actor.phone && order.clientPhone === actor.phone) return true;
    return false;
  }

  assertMayView(order: OrderRecord, actor: TransitionActor): void {
    if (!this.mayView(order, actor)) {
      throw new ForbiddenException({ code: 'ORDER_FORBIDDEN', message: 'Заявка принадлежит другому человеку' });
    }
  }

  async record(tenantId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', orderId });
    return order;
  }

  /**
   * Сухой прогон перехода без записи: почему кнопка неактивна.
   * Нужен приложению мастера — вместо немого 409 показываем ту же причину,
   * которую вернёт сервер, и ровно по тем guards, что стоят в графе этого типа заявки.
   */
  preflight(order: OrderRecord, action: string, ctx: Partial<TransitionContext>): { ok: boolean; failedGuard?: string; message?: string } {
    const full = emptyContext({ status: order.status, version: order.version, now: new Date(), ...ctx });
    const res = this.sm.validate(order.graphType, action as never, full);
    if (res.ok) return { ok: true };
    const v = res.violation as { failedGuard?: string; message?: string };
    return { ok: false, failedGuard: v.failedGuard, message: v.message };
  }

  /**
   * Обстоятельства перехода, вычисленные из самой заявки.
   *
   * Раньше сюда вливался `req.payload` целиком, а он объявлен в контракте как
   * `z.record(z.unknown())` — то есть что угодно. Достаточно было прислать
   * `{paymentConfirmed:true, billingPosted:true, moderationPassed:true,
   * photosAfter:5}`, и заявка закрывалась как оплаченная и промодерированная
   * без единого фото и без денег: все guard'ы конвейера на этом маршруте были
   * декоративны, потому что факты для них подставлял вызывающий.
   *
   * Теперь всё, что вообще может быть посчитано по записи, считается по
   * записи — и payload это не перекрывает. Остаются два узких списка:
   * FIELD_FLAGS (факт с объекта, его сообщает мастер) и BACK_OFFICE_FLAGS
   * (решение диспетчера в телефонном канале, оно пишется на заявку).
   */
  private serverFacts(order: OrderRecord): Partial<TransitionContext> {
    /**
     * Санкционированная сумма и её сравнение с итогом.
     *
     * Санкция — подтверждённая клиентом смета, а до неё первичная вилка «от»,
     * которую человек видел при создании заявки: телефонный канал считает
     * согласие по ней. Итог выше санкции — нарушение, ниже — нет: удешевить
     * работу клиент разрешать не обязан.
     *
     * Раньше это был флаг `totalEqualsSanctioned` в теле запроса, то есть
     * проверка сравнивала присланное с присланным.
     */
    const approved = [...order.quotes].reverse().find((q) => q.kind === 'approved');
    const sanctionedTiyin = (approved ?? order.quotes.find((q) => q.kind === 'initial'))?.amountTiyin ?? order.totalFromTiyin;
    const additional = order.quotes.filter((q) => q.kind === 'additional_forced' || q.kind === 'additional_upsell').length;
    const resolved = order.statusLog.filter((l) => l.action === 'resolve_addwork').length;

    const paid = order.payment?.status === 'succeeded';

    return {
      photosBefore: order.photos.filter((p) => p.stage === 'before').length,
      photosAfter: order.photos.filter((p) => p.stage === 'after').length,
      materialsWithoutReceipt: order.materials.filter((m) => m.kind === 'spare_part' && !m.hasReceipt).length,
      totalEqualsSanctioned: order.totalFromTiyin <= sanctionedTiyin && additional <= resolved,
      // Деньги на руках у мастера или прошёл онлайн-платёж — гейт завершения
      paymentCollected: paid || !!order.cashCollected,
      // А вот закрытие требует именно подтверждённого платежа
      paymentConfirmed: paid,
      restrictedSite: !!order.restrictedSite,
      acceptanceFixed: !!order.acceptance,
      // Апсейл не автостартует: признак берётся из самой доп-сметы
      isUpsell: order.quotes.some((q) => q.kind === 'additional_upsell'),
      fromInspection: order.graphType === 'inspection' || !!order.fromDefect,
      prepaymentMarked: !!order.prepayment || !!order.organizationId,
      withinOrderLimit: order.approval?.withinOrderLimit ?? false,
      monthlyLimitOk: order.approval?.monthlyLimitOk ?? false,
      dispatcherSanction: !!order.dispatcherSanction,
      moderationPassed: !!order.moderation?.passed,
      restorationDeclined: !!order.restorationDeclined,
      checklistFilled: !!order.inspectionChecklistAt,
      representativeFixed: !!order.acceptance,
      faultQualified: order.warrantyFaultPercent != null,
    };
  }

  /** Отобрать из payload только те флаги, которые этому актору разрешено сообщать */
  private allowedFlags(payload: unknown, actor: TransitionActor): Partial<TransitionContext> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const roles = actor.roles ?? [];
    const out: Record<string, unknown> = {};
    const isMaster = roles.includes('master');
    const isBackOffice = roles.some((r) => BACK_OFFICE_ROLES.includes(r));
    if (isMaster || isBackOffice) {
      for (const k of FIELD_FLAGS) if (p[k] !== undefined) out[k] = p[k];
    }
    if (isBackOffice) {
      for (const k of BACK_OFFICE_FLAGS) if (p[k] !== undefined) out[k] = p[k];
    }
    return out as Partial<TransitionContext>;
  }

  async transition(
    tenantId: string,
    orderId: string,
    req: TransitionRequest,
    actorPhone?: string,
    extra?: { masterId?: string; masterName?: string; roles?: string[] },
  ): Promise<OrderRecord> {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', orderId });
    const actor: TransitionActor = { phone: actorPhone, roles: extra?.roles };
    const nowIso = new Date().toISOString();
    const p0 = (req.payload ?? {}) as Record<string, unknown>;

    /**
     * Dev-мост телефонного канала: диспетчер отмечает галочкой то, чего в
     * системе физически нет. Раньше это была прибавка к контексту, теперь —
     * запись на заявке с телефоном того, кто её сделал: у любого утверждения
     * должен быть автор, иначе спрашивать за него не с кого.
     *
     * Мост выполняется ДО сборки контекста, поэтому guard'ы видят уже факт, а
     * не флаг, и путь у диспетчера и у мастера с камерой ровно один.
     */
    const flags = this.allowedFlags(req.payload, actor);
    if (req.action === 'start' && Number(flags.photosBefore) >= 1 && !order.photos.some((ph) => ph.stage === 'before')) {
      order.photos.push({ stage: 'before', source: `dev-флаг диспетчера ${actorPhone ?? ''}`.trim(), at: nowIso });
    }
    if (req.action === 'complete' && Number(flags.photosAfter) >= 1 && !order.photos.some((ph) => ph.stage === 'after')) {
      order.photos.push({ stage: 'after', source: `dev-флаг диспетчера ${actorPhone ?? ''}`.trim(), at: nowIso });
    }
    if (flags.paymentCollected && !order.cashCollected) {
      /**
       * Наличные у мастера — отдельная запись, а не платёж.
       *
       * Отметка диспетчера «деньги собраны» и подтверждённый онлайн-платёж —
       * разные факты: первый снимает гейт завершения, второй закрывает
       * заявку. Смешать их значит либо закрывать заявку по галочке, либо
       * прятать от клиента кнопку оплаты за наличные, которых он не давал.
       * Раньше это был флаг в теле запроса — теперь запись с автором.
       */
      order.cashCollected = { by: actorPhone ?? '', amountTiyin: order.totalFromTiyin, at: nowIso };
    }
    if (flags.dispatcherSanction) {
      order.dispatcherSanction = { reason: req.reason ?? String(p0.reason ?? ''), by: actorPhone ?? '', at: nowIso };
    }
    if (flags.moderationPassed) {
      order.moderation = { passed: true, by: actorPhone ?? '', at: nowIso };
    }
    if (flags.restorationDeclined) order.restorationDeclined = { by: actorPhone ?? '', at: nowIso };
    if (flags.checklistFilled) order.inspectionChecklistAt = nowIso;
    if (typeof p0.faultPercent === 'number' && (flags.faultQualified || actor.roles?.some((r) => BACK_OFFICE_ROLES.includes(r)))) {
      order.warrantyFaultPercent = Math.max(0, Math.min(100, Number(p0.faultPercent)));
    } else if (flags.faultQualified && order.warrantyFaultPercent == null) {
      order.warrantyFaultPercent = 0;
    }

    const ctx: TransitionContext = emptyContext({
      status: order.status,
      version: order.version,
      now: new Date(),
      reason: req.reason,
      completedAt: this.lastAt(order, 'completed'),
      closedAt: this.lastAt(order, 'closed'),
      // Факты — из записи; payload их не перекрывает
      ...this.serverFacts(order),
      /**
       * …кроме того, чему записи на заявке нет по природе.
       *
       * Представитель точки фиксируется в акте осмотра, а не на заявке, и
       * его статус знает приложение мастера; подтверждение слотов этапов
       * живёт в расписании. Оба принимаются только от мастера и бэк-офиса
       * (см. FIELD_FLAGS) — клиентский токен сюда не достаёт.
       */
      ...(flags.representativeFixed !== undefined ? { representativeFixed: !!flags.representativeFixed } : {}),
      stageChainConfirmed: !!flags.stageChainConfirmed,
    });

    /**
     * Готов ли биллинг провести закрытие.
     *
     * Спрашиваем ДО перехода: закрытый период — единственная причина, по
     * которой проводок не будет, и узнать о ней после закрытия значит не
     * узнать вовсе. Раньше post() бросал PERIOD_LOCKED уже из подписчика,
     * шина гасила исключение в console.error — и заявка закрывалась
     * успешно, а выручки, доли мастера и резервного фонда не появлялось
     * никогда, без следа в интерфейсе.
     */
    if (req.action === 'close') {
      const answers = this.bus.probe<{ at: string }, boolean>('billing.period_open', { at: nowIso });
      ctx.billingPosted = answers.length === 0 || answers.every(Boolean);
    }

    // Гейт допуска (DEV-10 §3 правило 9, контур «Дом»): заявку нельзя начать,
    // пока наряд не открыт. Проверяется ДО графа — нарушение здесь не про статусную
    // машину заявки, и код ошибки должен быть свой, иначе диспетчер будет искать
    // проблему не там. Для аварийной заявки правило снято внутри access.
    if (req.action === 'start') {
      const gate = this.access.canStartOrder(tenantId, order.id);
      if (!gate.ok) {
        throw new ConflictException({ code: 'AccessPermitRequired', message: gate.reason });
      }
    }

    const res = this.sm.validate(order.graphType, req.action, ctx);
    if (!res.ok) throw new ConflictException(res.violation);
    if (req.action === 'assign') this.assertAssignable(tenantId, order, extra?.masterId);

    const p = (req.payload ?? {}) as Record<string, unknown>;

    /**
     * Применение перехода — включая внутренние действия.
     *
     * Раньше внутренние (подтверждение сметы, пауза, доп-работа) выходили
     * ДО этого места: они не проверяли версию, не смотрели ключ операции и
     * не поднимали версию. Отсюда две беды разом — повтор при обрыве связи
     * плодил дубли записей о согласии клиента, а два параллельных изменения
     * молча затирали друг друга. Идёт через ту же запись, что и остальные:
     * из статуса в тот же статус, но с журналом, версией и идемпотентностью.
     */
    const applied = await this.repo.applyTransition(
      tenantId,
      orderId,
      req.version,
      { from: order.status, to: res.def.to, action: req.action, actorPhone, reason: req.reason, clientOpUuid: req.clientOpUuid },
      req.action === 'assign' ? { masterId: extra?.masterId, masterName: extra?.masterName } : undefined,
    );
    if (applied === 'version_conflict') {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Конкурирующий переход: обновите заявку и повторите' });
    }
    // Повтор того же клиентского действия: запись уже есть, второй сметы,
    // второго материала и второй записи о согласии не заводим
    if (applied === 'duplicate') return order;

    // Вкладки D-06: записи, которые действие оставляет на карточке.
    // Строго ПОСЛЕ применения — иначе повтор допишет смету к уже применённому
    if (req.action === 'confirm_estimate') {
      /**
       * Сумма санкции — итог заявки, а не число из тела запроса.
       *
       * Через тело её мог назначить кто угодно, и она тут же становилась
       * «санкционированной клиентом» — то есть проверка «итог равен
       * санкционированному» проверяла присланное против присланного.
       * Диспетчеру телефонного канала переопределение оставлено: у него
       * это протокол разговора, и он подписан его телефоном.
       */
      const backOffice = (extra?.roles ?? []).some((r) => BACK_OFFICE_ROLES.includes(r));
      const declared = backOffice ? Number(p.amountTiyin) : NaN;
      order.quotes.push({
        kind: 'approved',
        amountTiyin: Number.isSafeInteger(declared) && declared > 0 ? declared : order.totalFromTiyin,
        approvedVia: backOffice ? String(p.via ?? 'phone_dispatcher') : 'app',
        note: 'Санкция клиента (аудит-запись, ТЗ 4.6)',
        at: nowIso,
      });
    }
    if (req.action === 'rate' && typeof p.rating === 'number') {
      order.rating = Math.max(1, Math.min(5, Number(p.rating))); // окно 72 ч проверяет граф (DEV-10)
    }
    if (req.action === 'request_addwork') {
      const amount = Number(p.amountTiyin);
      order.quotes.push({
        kind: p.isUpsell ? 'additional_upsell' : 'additional_forced',
        amountTiyin: Number.isSafeInteger(amount) && amount > 0 ? amount : 0,
        note: p.isUpsell ? 'Апсейл — не блокирует конвейер' : 'Вынужденная доп-работа (фото обязательно)',
        at: nowIso,
      });
    }

    if (res.def.internal) {
      this.repo.touch(orderId); // сметы/фото, добавленные внутренними действиями
      return applied;
    }

    /**
     * Переход состоялся — сообщаем шине (DEV-07 §4.В).
     *
     * Публикуется после applyTransition и до всего остального: доставка
     * уведомления клиенту не должна зависеть от того, чем закончится расчёт
     * SLA или биллинга. Подписчик решает сам, о чём стоит уведомить, — заявка
     * про матрицу доставки не знает.
     */
    this.bus.publish<OrderStatusChangedEvent>('order.status_changed', {
      orderId: applied.id,
      number: applied.number,
      graphType: applied.graphType,
      action: req.action,
      from: order.status,
      to: applied.status,
      clientPhone: applied.clientPhone,
      clientName: applied.clientName,
      address: applied.address,
      masterId: applied.masterId,
      masterName: applied.masterName,
      organizationId: applied.organizationId,
      locationId: applied.locationId,
      urgency: applied.urgency,
      reason: req.reason ?? applied.pause?.reason,
      window: applied.requestedWindow
        ? {
            date: applied.requestedWindow.date,
            startMin: applied.requestedWindow.startMin,
            endMin: applied.requestedWindow.endMin,
          }
        : undefined,
      // Последняя сумма по заявке: подтверждённая смета, а до неё — вилка.
      // Именно её человек и увидит в тексте «Подтвердите стоимость»
      amountTiyin: applied.quotes.at(-1)?.amountTiyin ?? applied.totalFromTiyin,
      approvers: this.approversFor(applied, req.action),
    });

    // Отметки этапов SLA (DEV-15 §7.2): реакция — принятие в работу, прибытие — старт,
    // устранение — завершение. Дедлайны считает модуль sla, статусы он не трогает.
    if (req.action === 'assign') this.sla.markReached(tenantId, applied.id, 'response');
    if (req.action === 'start') this.sla.markReached(tenantId, applied.id, 'arrival');
    // Устранение гасит светофор: список нарушений только пополнялся, и
    // заявка оставалась красной навсегда — даже после того, как её сделали
    if (req.action === 'complete') this.sla.resolved(tenantId, applied.id);
    /**
     * Пауза учитывается в SLA.
     *
     * `addPause` не вызывался ниоткуда: настройка «время паузы не идёт в
     * срок» существовала только в коде. Вина берётся из причины паузы —
     * ожидание материалов это проблема исполнителя, и срок по ней не
     * сдвигается; ожидание клиента или третьей стороны — сдвигается.
     */
    if (req.action === 'resume' && order.pause?.since) {
      const ms = Date.now() - Date.parse(order.pause.since);
      const reason = order.pause.reason ?? '';
      const blame: 'operator' | 'client' | 'third_party' = /материал|запчаст|инструмент/i.test(reason)
        ? 'operator'
        : /клиент|жител|доступ|не открыл/i.test(reason)
          ? 'client'
          : 'third_party';
      if (ms > 0) this.sla.addPause(tenantId, applied.id, ms, blame);
    }

    // Отмена → деньги по матрице ТЗ 4.4 (событие, а не только предпросмотр)
    if (req.action === 'cancel') {
      const settle = this.cancelSettlement(order);
      if (settle.clientPaysTiyin > 0 || settle.masterCompTiyin > 0) {
        this.bus.publish(
          'order.cancelled',
          {
            orderId: applied.id,
            number: applied.number,
            graphType: applied.graphType,
            organizationId: applied.organizationId,
            clientPhone: applied.clientPhone,
            masterId: applied.masterId,
            masterName: applied.masterName,
            fromStatus: order.status,
            reason: req.reason,
            clientPaysTiyin: settle.clientPaysTiyin,
            masterCompTiyin: settle.masterCompTiyin,
            note: settle.note,
          },
          // Ключ идемпотентности события: повтор отмены той же заявки не
          // проведёт компенсацию мастеру второй раз
          `order.cancelled:${applied.id}`,
        );
      }
    }

    // Закрытие → событие для биллинга (DEV-07 §4.В: orders не знает о подписчиках)
    if (req.action === 'close') {
      const payload = (req.payload ?? {}) as { cashPayment?: boolean };
      /**
       * Санкционированная сумма, а не нижняя вилка первичной сметы.
       *
       * В биллинг уходили `totalFromTiyin` и `baseFromTiyin` — то есть «от»
       * из первичной вилки, — при том что подтверждённая клиентом смета лежит
       * в `order.quotes`, а доп-работы отдельными видами. Смета «от 300 000
       * до 800 000», клиент подтвердил 750 000, мастер сделал доп-работу на
       * 200 000 — в выручку попадало 300 000, и доля мастера считалась от них.
       *
       * Доп-работы засчитываются в порядке появления и ровно в том числе, в
       * каком по ним состоялось `resolve_addwork`: неутверждённая доп-смета
       * деньгами не становится.
       */
      const sanctioned = [...applied.quotes].reverse().find((q) => q.kind === 'approved')?.amountTiyin ?? applied.totalFromTiyin;
      const resolvedCount = applied.statusLog.filter((l) => l.action === 'resolve_addwork').length;
      const addworkTiyin = applied.quotes
        .filter((q) => q.kind === 'additional_forced' || q.kind === 'additional_upsell')
        .slice(0, resolvedCount)
        .reduce((sum, q) => sum + q.amountTiyin, 0);
      this.bus.publish<OrderClosedEvent>('order.closed', {
        orderId: applied.id,
        number: applied.number,
        graphType: applied.graphType,
        organizationId: applied.organizationId,
        clientPhone: applied.clientPhone,
        masterId: applied.masterId,
        masterName: applied.masterName,
        totalWorkTiyin: sanctioned + addworkTiyin,
        // Доля мастера — от базы без скидки; доп-работы входят в базу целиком,
        // маркетинговая скидка платформы их не касается
        baseWorkTiyin: applied.baseFromTiyin + addworkTiyin,
        // Ставка едет с событием: восемь мест расчёта хардкодили 550, а
        // мастеру с золотым грейдом приложение обещало 570
        masterSharePermille: this.masterSharePermilleFor(applied),
        paymentChannel: applied.graphType === 'b2b' ? 'subscription' : payload.cashPayment ? 'cash' : 'online',
        materialsTiyin: applied.totalMaterialTiyin,
        // Контур «Дом»: параметры сбора едут в событии, чтобы billing не импортировал buildings
        buildingId: applied.buildingId,
        operatorOrgId: applied.buildingId
          ? (this.buildings.listBuildings(tenantId).find((b) => b.id === applied.buildingId)?.operatorOrgId ?? undefined)
          : undefined,
        orderScope: applied.orderScope ?? 'private',
        laborSettlement: applied.laborSettlement ?? 'share',
        // Эффективная ставка: у Pro-оператора сбор равен нулю (ТЗ §19.3 п.4а)
        serviceFeeBps: (() => {
          if (!applied.buildingId) return undefined;
          const b = this.buildings.listBuildings(tenantId).find((x) => x.id === applied.buildingId);
          return b ? this.buildings.effectiveServiceFeeBps(tenantId, b) : undefined;
        })(),
      },
      // Закрытие заявки — один раз: повторная публикация того же факта
      // (повтор запроса, переигровка) не создаст вторых проводок
      `order.closed:${applied.id}`);
    }
    return applied;
  }

  /**
   * Правила постановки мастера на заявку — в одном месте.
   *
   * Раньше они жили внутри `transition` и потому действовали только на
   * переходе `assign`. `reassign` присваивал мастера напрямую, мимо них:
   * через переназначение мастер платформы вставал на работу по общему
   * имуществу, которую ТЗ §19.3 п.5 запрещает абсолютно, и тем же путём
   * обходилось окно права первой руки.
   */
  private assertAssignable(tenantId: string, order: OrderRecord, masterId?: string): void {
    if (!masterId) {
      throw new BadRequestException({ code: 'MASTER_REQUIRED', message: 'Для назначения укажите мастера' });
    }
    // Общее имущество никогда не уходит мастерам платформы (ТЗ §19.3 п.5).
    // Правило абсолютное: ни по просрочке, ни при деградации объекта, ни в аварии.
    if (order.orderScope === 'common_area' && order.buildingId) {
      /**
       * Раньше здесь стоял запрет на любое назначение, и он был грубее
       * правила: работы по общему имуществу выполняет служба оператора, а
       * запрет закрывал и её тоже — заявку нельзя было отдать никому, включая
       * собственного слесаря управляющей компании.
       *
       * Так вышло потому, что выразить «свой мастер» было нечем: связи
       * мастера с оператором в коде не существовало (появилась в U-05).
       * Теперь правило звучит ровно так, как в ТЗ §19.3 п.5: свой — можно,
       * мастеру платформы — никогда.
       */
      const operatorOrgId = this.buildings.get(tenantId, order.buildingId).operatorOrgId;
      const own = operatorOrgId ? this.affiliation.isActive(tenantId, masterId, operatorOrgId) : false;
      if (!own) {
        /**
         * Отказ называет ПРИЧИНУ, а не только правило.
         *
         * У оператора может не быть ни одного действующего мастера — все
         * прекращены или у всех истёк срок аффилиации. Тогда правило «только
         * своя служба» превращается в тупик: назначение отбивается всегда, а
         * у аварийного графа других выходов, кроме отмены, нет — авария на
         * стояке стоит в «Новая», пока её не отменят руками. Разница между
         * «этот мастер не ваш» и «своих мастеров нет вообще» решает, что
         * делать дальше, поэтому она названа.
         */
        const available = operatorOrgId ? this.affiliation.activeMasterIds(tenantId, operatorOrgId).length : 0;
        throw new ConflictException({
          code: available > 0 ? 'CommonAreaIsOperatorOnly' : 'CommonAreaNoOperatorMasters',
          message:
            available > 0
              ? 'Работы по общему имуществу выполняет только служба эксплуатирующей организации. ' +
                'Если у неё нет компетенции, она размещает заказ у платформы отдельной B2B-заявкой'
              : 'Работы по общему имуществу выполняет только служба эксплуатирующей организации, ' +
                'а действующих мастеров у неё сейчас нет: все аффилиации прекращены или истёк срок ' +
                'договора. Продлите аффилиацию или разместите заказ у платформы отдельной ' +
                'B2B-заявкой — мастеру платформы такая работа не достаётся ни при каких условиях (ТЗ §19.3 п.5)',
          operatorOrgId,
          activeMasters: available,
        });
      }
    }

    // Право первой руки (DEV-15 §7.5): пока окно не истекло и служба оператора
    // не отпустила заявку, мастер платформы на неё не назначается.
    if (order.firstRefusalUntil && !order.claimedByOperator && Date.parse(order.firstRefusalUntil) > Date.now()) {
      throw new ConflictException({
        code: 'FirstRefusalWindowOpen',
        message: `Окно первой руки службы оператора истекает ${order.firstRefusalUntil}`,
        until: order.firstRefusalUntil,
      });
    }
  }

  /**
   * Кому уходит запрос на утверждение (ТЗ §5.2).
   *
   * Только для действий, которые действительно требуют решения человека с
   * деньгами: на «мастер выехал» утверждающих искать незачем, а поиск по
   * представителям точки не бесплатный — он идёт на каждый переход.
   *
   * Отбор по потолку: утверждает тот, чей лимит покрывает сумму. Если не
   * покрывает никто — запрос уходит всем без лимита (уровень организации),
   * потому что дальше по иерархии эскалировать уже некуда, а молчание здесь
   * останавливает работу мастера.
   */
  private approversFor(order: OrderRecord, action: string): Array<{ phone: string; name: string }> | undefined {
    if (!['request_approval', 'request_addwork'].includes(action)) return undefined;
    if (!order.organizationId || !order.locationId) return undefined;
    const found = this.crm.findLocation(order.locationId);
    if (!found) return undefined;
    const amount = order.quotes.at(-1)?.amountTiyin ?? order.totalFromTiyin;
    const reps = found.loc.representatives;
    const able = reps.filter((r) => r.approvalLimitTiyin === null || r.approvalLimitTiyin >= amount);
    const list = able.length ? able : reps.filter((r) => r.approvalLimitTiyin === null);
    return list.map((r) => ({ phone: r.phone, name: r.fullName }));
  }

  /**
   * Сохранить изменения вложенных коллекций заявки (фото, сметы, материалы).
   *
   * `orderId` стоит передавать всегда, когда он под рукой: без него пишется
   * весь набор заявок целиком.
   */
  touchOrder(orderId?: string): void {
    this.repo.touch(orderId);
  }

  // ---------- Вкладки D-06: материалы, предпросмотр отмены, переназначение ----------

  async addMaterial(
    tenantId: string,
    orderId: string,
    m: {
      kind: 'spare_part' | 'consumable';
      name: string;
      amountTiyin: number;
      sourceChannel: string;
      hasReceipt?: boolean;
      priceTier?: string;
      /** Ключ операции клиента: повтор при обрыве связи не заводит второй материал */
      clientOpUuid?: string;
    },
  ) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (!['in_progress', 'addwork_approval', 'completed'].includes(order.status)) {
      throw new BadRequestException({ code: 'MATERIALS_STAGE_INVALID', message: 'Материалы вносятся в статусах «В работе» … «Выполнена»' });
    }
    /**
     * Сумма — целое положительное число тийинов.
     *
     * Проверки не было вовсе: отрицательная сумма уменьшала итог заявки, а
     * «две» вместо количества давала NaN, который дальше отравлял журнал
     * проводок необратимо (сторно NaN — тоже NaN).
     */
    if (!Number.isSafeInteger(m.amountTiyin) || m.amountTiyin <= 0) {
      throw new BadRequestException({ code: 'AMOUNT_INVALID', message: 'Сумма материала — целое положительное число тийинов' });
    }
    // Повтор при обрыве связи: тот же ключ — тот же материал, а не второй
    if (m.clientOpUuid && order.materials.some((x) => x.clientOpUuid === m.clientOpUuid)) {
      return order;
    }
    if (m.kind === 'spare_part' && !m.hasReceipt) {
      throw new BadRequestException({ code: 'RECEIPT_REQUIRED', message: 'Запчасть — всегда с чеком; без чека только расходники «сумки» (ТЗ 8.4)' });
    }
    if (m.kind === 'spare_part' && m.amountTiyin > 20_000_000 && !m.priceTier) {
      throw new BadRequestException({ code: 'PRICE_TIER_REQUIRED', message: 'Запчасть дороже 200 000 сум — укажите вилку эконом/стандарт/премиум (ТЗ 8.4.3)' });
    }
    order.materials.push({
      kind: m.kind,
      name: m.name,
      amountTiyin: m.amountTiyin,
      sourceChannel: m.sourceChannel as never,
      hasReceipt: !!m.hasReceipt,
      priceTier: m.priceTier as never,
      clientOpUuid: m.clientOpUuid,
      at: new Date().toISOString(),
    });
    order.totalMaterialTiyin += m.amountTiyin;
    this.repo.touch(order.id);
    return order;
  }

  /**
   * Стоимость выезда — параметр №10, а не литерал.
   *
   * Админ меняет параметр, а предпросмотр отмены показывал прежние 50 000
   * сум: цифра из кода расходилась с цифрой из настроек, и правой была
   * настройка, которую никто не читал.
   */
  private calloutTiyin(): number {
    const raw = this.params.list().find((p) => p.num === 10)?.value ?? '';
    const digits = raw.replace(/[^\d]/g, '');
    const soums = digits ? Number(digits) : 0;
    return soums > 0 ? soums * 100 : 5_000_000;
  }

  /**
   * Матрица денежных последствий отмены (ТЗ 4.4).
   *
   * Одна функция и для предпросмотра, и для проводок. До этого матрица
   * существовала только как предпросмотр: отмена не порождала ни одной
   * проводки — событие отмены не публиковалось вовсе и никто на него не был
   * подписан. Мастер выехал, клиент отменил — переход проходит, клиенту
   * ничего не выставлено, мастеру ничего не компенсировано, каждый ложный
   * вызов бесплатен.
   */
  cancelSettlement(order: OrderRecord, now = Date.now()): {
    clientPaysTiyin: number;
    masterCompTiyin: number;
    note: string;
    conditional?: { lateCancelClientTiyin: number; lateCancelMasterTiyin: number };
  } {
    const callout = this.calloutTiyin();
    const half = Math.floor(callout / 2);
    const s = order.status;
    if (['new', 'estimated', 'pending_approval', 'approved'].includes(s)) {
      return { clientPaysTiyin: 0, masterCompTiyin: 0, note: 'До назначения — отмена бесплатна (ТЗ 4.4)' };
    }
    if (s === 'assigned') {
      // «Менее двух часов до окна» — считаем, а не оставляем на человека:
      // окно клиента записано на заявке, и оно здесь единственный факт
      const w = order.requestedWindow;
      const startMs =
        w?.date && w.startMin != null ? Date.parse(`${w.date}T00:00:00`) + w.startMin * 60_000 : NaN;
      const late = Number.isFinite(startMs) ? startMs - now < 2 * 3_600_000 : false;
      if (late) {
        return {
          clientPaysTiyin: callout,
          masterCompTiyin: half,
          note: 'Отмена менее чем за 2 ч до окна — ложный вызов: клиенту стоимость выезда, мастеру 50% (ТЗ 4.4)',
        };
      }
      return {
        clientPaysTiyin: 0,
        masterCompTiyin: 0,
        note: 'Бесплатно: до окна больше 2 ч (ТЗ 4.4)',
        conditional: { lateCancelClientTiyin: callout, lateCancelMasterTiyin: half },
      };
    }
    if (s === 'master_departed') {
      return { clientPaysTiyin: callout, masterCompTiyin: half, note: 'Мастер выехал — ложный вызов: стоимость выезда, мастеру 50% (ТЗ 4.4)' };
    }
    return {
      clientPaysTiyin: callout + order.totalFromTiyin,
      masterCompTiyin: 0,
      note: 'После начала работ — выезд + фактически выполненная часть (ТЗ 4.4)',
    };
  }

  /** Предпросмотр денежных последствий отмены — та же матрица, что и в проводках */
  async cancelPreview(tenantId: string, orderId: string) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    return this.cancelSettlement(order);
  }

  /**
   * Переназначение — статусы 5–8, причина обязательна, история хранится (ТЗ 4.5).
   *
   * Идёт через те же правила и ту же запись, что и назначение. Раньше мастер
   * присваивался напрямую: без проверки правил назначения, без версии и без
   * её подъёма — два параллельных переназначения давали потерянное
   * обновление без конфликта версий, а мастер платформы этим путём вставал на
   * общее имущество.
   */
  async reassign(
    tenantId: string,
    orderId: string,
    masterId: string,
    masterName: string,
    reason: string,
    actorPhone?: string,
    expectedVersion?: number,
    clientOpUuid?: string,
  ) {
    const order = await this.repo.findById(tenantId, orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (!['assigned', 'master_departed', 'in_progress', 'addwork_approval'].includes(order.status)) {
      throw new BadRequestException({ code: 'REASSIGN_STAGE_INVALID', message: 'Переназначение возможно на статусах «Назначена»…«Доп-согласование» (ТЗ 4.5)' });
    }
    if (!reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина переназначения обязательна (справочник D-15)' });
    this.assertAssignable(tenantId, order, masterId);
    const previous = order.masterName;
    const applied = await this.repo.applyTransition(
      tenantId,
      orderId,
      expectedVersion ?? order.version,
      {
        from: order.status,
        to: order.status,
        action: 'reassign',
        actorPhone,
        reason: `${reason} · ${order.masterName ?? '—'} → ${masterName}`,
        clientOpUuid,
      },
      { masterId, masterName },
    );
    if (applied === 'version_conflict') {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Заявку уже переназначили: обновите карточку и повторите' });
    }
    if (applied === 'duplicate') return order;
    /**
     * «К вам едет другой мастер» (PRD-01 §5).
     *
     * Статус при переназначении не меняется, поэтому в общий поток переходов
     * это событие не попадает — а для клиента оно из самых заметных: он ждёт
     * конкретного человека, которого ему назвали по имени. Узнать о замене на
     * пороге хуже, чем узнать о ней заранее.
     */
    this.bus.publish('order.master_replaced', {
      orderId: order.id,
      number: order.number,
      clientPhone: order.clientPhone,
      previousMasterName: previous,
      masterName,
      reason,
    });
    return applied;
  }

  // ---------- Реестр B2C-клиентов (A-10) ----------

  /**
   * Заблокирован ли клиент и почему.
   *
   * Нужно приложению: до этого запрет срабатывал только в момент отправки
   * заявки, и человек узнавал о блокировке, собрав её целиком.
   */
  blockOf(phone: string, tenantId = 't0'): { reason: string; at: string } | null {
    return this.blockedClients.get(this.blockKey(tenantId, phone)) ?? null;
  }

  blockClient(phone: string, reason: string, tenantId = 't0'): void {
    this.blockedClients.set(this.blockKey(tenantId, phone), { reason, at: new Date().toISOString() });
    this.store.persist();
  }

  unblockClient(phone: string, tenantId = 't0'): void {
    this.blockedClients.delete(this.blockKey(tenantId, phone));
    this.store.persist();
  }

  async clientsRegistry(tenantId: string) {
    const all = await this.repo.list(tenantId);
    const b2c = all.filter((o) => o.graphType !== 'b2b');
    const byPhone = new Map<string, typeof b2c>();
    for (const o of b2c) {
      const list = byPhone.get(o.clientPhone) ?? [];
      list.push(o);
      byPhone.set(o.clientPhone, list);
    }
    return [...byPhone.entries()].map(([phone, orders]) => {
      const closed = orders.filter((o) => o.status === 'closed' || o.status === 'rated');
      const debt = orders.filter((o) => o.status === 'awaiting_payment').reduce((s, o) => s + o.totalFromTiyin, 0);
      const block = this.blockedClients.get(this.blockKey(tenantId, phone));
      return {
        phone,
        name: orders.find((o) => o.clientName)?.clientName ?? '',
        ordersTotal: orders.length,
        ordersActive: orders.filter((o) => !['closed', 'rated', 'cancelled'].includes(o.status)).length,
        ordersClosed: closed.length,
        spentTiyin: closed.reduce((s, o) => s + o.totalFromTiyin, 0),
        debtTiyin: debt,
        blocked: !!block,
        blockReason: block?.reason,
        lastOrderAt: orders[0]?.createdAt,
      };
    });
  }

  private lastAt(order: OrderRecord, status: string): Date | undefined {
    const entry = [...order.statusLog].reverse().find((l) => l.to === status);
    return entry?.at;
  }
}
