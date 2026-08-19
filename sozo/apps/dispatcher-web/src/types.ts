// Типы данных API SOZO (/v1/dispatch/*)

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
  roles: string[];
}

export type Urgency = 'normal' | 'urgent' | 'emergency';

export interface OrderLine {
  priceItemId?: string;
  name: string;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  qty: number;
}

/** D-06 вкладка «Смета» (ТЗ 4.6): вилка → санкция клиента → доп-сметы. */
export interface Quote {
  kind: 'initial' | 'approved' | 'additional_forced' | 'additional_upsell' | 'conservation';
  amountTiyin: number;
  approvedVia?: string; // 'app' | 'phone_dispatcher' | 'offline_signature'
  note?: string;
  at: string;
}

/**
 * D-06 вкладка «Фото» (PRD-05 §9). Файл есть у загруженных фото; отметки конвейера
 * (dev-флаги при переходах) приходят без `file`.
 */
export interface OrderPhoto {
  id?: string;
  stage: 'before' | 'during' | 'after' | 'receipt';
  source: string;
  /** Имя файла на сервере — отдаётся по `${API_BASE}/photos/{file}?token=…`. */
  file?: string;
  /** Веб-загрузка без гео — флаг качества, не блокер (ТЗ 7.2). */
  geoMissing?: boolean;
  at: string;
}

/** D-06 вкладка «Материалы» (ТЗ 8.4). */
export interface OrderMaterial {
  kind: 'spare_part' | 'consumable';
  name: string;
  amountTiyin: number;
  sourceChannel: 'partner_store' | 'master_own' | 'client_self' | 'company_stock';
  hasReceipt: boolean;
  priceTier?: 'economy' | 'standard' | 'premium';
  at: string;
}

/** Предпросмотр денежных последствий отмены — матрица ТЗ 4.4. */
export interface CancelPreview {
  clientPaysTiyin: number;
  masterCompTiyin: number | null;
  note: string;
  conditional?: { lateCancelClientTiyin: number; lateCancelMasterTiyin: number };
}

export interface StatusLogEntry {
  from: string | null;
  to: string;
  action: string;
  actorPhone: string;
  reason?: string | null;
  at: string;
}

export interface Order {
  id: string;
  number: string;
  graphType: string; // 'b2c' | 'b2b' | 'emergency' | ...
  status: string;
  version: number;
  urgency: Urgency;
  /**
   * Срок выезда по договору для аварийной заявки (ТЗ 18 п.2). Пусто —
   * заявка не аварийная или у организации нет такого условия.
   */
  slaDueAt?: string;
  source: string;
  clientPhone: string;
  clientName: string;
  address: string;
  description: string;
  masterId?: string | null;
  masterName?: string | null;
  lines: OrderLine[];
  /** База до скидок — от неё считается доля мастера (ТЗ 3.7). */
  baseFromTiyin: number;
  baseToTiyin: number;
  totalFromTiyin: number;
  totalToTiyin: number;
  promoCode?: string;
  promoDiscountPercent?: number;
  quotes?: Quote[];
  photos?: OrderPhoto[];
  materials?: OrderMaterial[];
  totalMaterialTiyin?: number;
  statusLog?: StatusLogEntry[];
  createdAt: string;
}

export interface OrderDetail extends Order {
  allowedActions: string[];
}

export interface KanbanColumn {
  status: string;
  orders: Order[];
}

export interface KanbanData {
  columns: KanbanColumn[];
  archive: Order[];
}

export interface PriceItem {
  id: string;
  num: number;
  category: string;
  name: string;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
}

export interface PriceItemsResponse {
  releaseId: string;
  items: PriceItem[];
}

export interface DispatchMaster {
  id: string;
  fullName: string;
  phone: string;
  skillTags: string[];
  rating: number;
  grade: 'bronze' | 'silver' | 'gold';
}

// ---------- Планировщик ёмкости (/dispatch/scheduling, ТЗ 17.3) ----------

/** Бронь в ленте мастера: слоты по 30 мин, включая дорожный буфер 20%. */
export interface LaneBooking {
  id: string;
  orderId: string;
  orderNumber: string;
  startMin: number;
  endMin: number;
  start: string;
  end: string;
  slots: number;
  normHours: number;
  bufferMin: number;
  anchored: boolean;
  priority: number;
  /** 2-часовое окно, которое видит клиент. */
  clientWindowText: string;
}

export interface Lane {
  masterId: string;
  masterName: string;
  zone?: string;
  /** Дежурный: плановые заявки ему не бронируются. */
  isDuty: boolean;
  shift: { start: string; end: string; startMin: number; endMin: number };
  loadPercent: number;
  /** План дня упёрся в потолок 80% смены. */
  capReached: boolean;
  bookings: LaneBooking[];
}

export interface LanesResponse {
  date: string;
  lanes: Lane[];
}

/** Сводка ёмкости дня — плитки и гистограмма D-04. */
export interface DayCapacity {
  date: string;
  masters: number;
  totalMin: number;
  busyMin: number;
  loadPercent: number;
  capPercent: number;
  overloaded: number;
  byHour: { hour: number; busy: number; free: number }[];
  waitlist: number;
}

export interface Shift {
  id: string;
  masterId: string;
  masterName: string;
  date: string;
  startMin: number;
  endMin: number;
  isDuty: boolean;
  zone?: string;
}

/** Окно, реально обеспеченное ёмкостью (клиент не видит окно без мастеров). */
export interface SlotWindow {
  startMin: number;
  label: string;
  mastersAvailable: number;
  slots: number;
}

export interface WindowsResponse {
  date: string;
  normHours: number;
  /** Нормо-часы не заполнены в прайсе — планируем по 1 ч (DEV-05 п.17). */
  normHoursAssumed: boolean;
  slotsNeeded: number;
  windows: SlotWindow[];
}

export interface WaitlistEntry {
  orderId: string;
  orderNumber: string;
  normHours: number;
  priority: number;
  at: string;
}

/** Снятие брони → событие slot.freed с предложением следующему в очереди. */
export interface ReleaseResult {
  freed: { orderId: string; orderNumber: string } | null;
  nextCandidate: { orderId: string; orderNumber: string } | null;
}

export interface DispatchOrganization {
  id: string;
  name: string;
  locationsCount: number;
}

/** Авто-подбор мастера (ТЗ 7.3, PRD-05 §3) */
export interface AssignmentCandidate {
  masterId: string;
  masterName: string;
  rating: number;
  grade: string;
  score: number;
  reasons: string[];
  blockers: string[];
  loadPercent: number;
  hasShift: boolean;
}

export interface AssignmentCandidates {
  order: { number: string; requiredSkills: string[]; requiresEquipment: boolean; isPaired: boolean };
  candidates: AssignmentCandidate[];
  rejected: AssignmentCandidate[];
}

// ---------- Операции смены (/dispatch/ops): D-12, D-13, D-17, D-19 ----------

export type ReplacementReason = 'no_departure' | 'declined' | 'geo_stale' | 'manual';

/** Этапы протокола замены (ТЗ 17.3): детект → бродкаст → назначение → закрытие. */
export type ReplacementStage = 'detected' | 'broadcast' | 'assigned' | 'escalated' | 'closed';

/** Квалификация невыхода при закрытии протокола. */
export type Sanction = 'none' | 'warning' | 'no_show' | 'blocked';

export interface Replacement {
  id: string;
  orderId: string;
  orderNumber: string;
  reason: ReplacementReason;
  detectedAt: string;
  fromMasterId?: string;
  fromMasterName?: string;
  stage: ReplacementStage;
  broadcastStartedAt?: string;
  /** Окно бродкаст-оффера в секундах: первый принявший забирает (параметр №32). */
  broadcastSeconds: number;
  toMasterId?: string;
  toMasterName?: string;
  resolvedAt?: string;
  /** «Молчание запрещено»: клиенту уходит уведомление сразу после замены. */
  clientNotified: boolean;
  sanction?: Sanction;
  note?: string;
}

/** Ответ закрытия протокола: невыходы за 90 дней и автоматическая мера. */
export interface ReplacementClosed extends Replacement {
  noShowCount: number;
  autoSanction: string;
}

/** Кандидат на срыв: мастер не выехал или гео не обновляется. */
export interface ReplacementRisk {
  orderId: string;
  orderNumber: string;
  masterId?: string;
  masterName?: string;
  status: string;
  minutes: number;
  reason: 'no_departure' | 'geo_stale';
}

export interface ReplacementDetect {
  candidates: ReplacementRisk[];
  active: Replacement[];
}

export interface ReplacementCandidates {
  replacement: Replacement;
  candidates: AssignmentCandidate[];
  rejected: AssignmentCandidate[];
}

/**
 * Обращение клиента из приложения, ждущее диспетчера: перенос, разбор низкой
 * оценки, сообщение по заявке. `overdue` считает сервер — у клиента браузера
 * может быть сбито время, а срок звонка по оценке 1–2 отсчитывается всерьёз.
 */
export interface ClientRequest {
  id: string;
  kind: 'reschedule' | 'low_rating' | 'message';
  orderId: string;
  orderNumber: string;
  clientPhone: string;
  clientName?: string;
  masterName?: string;
  title: string;
  detail: string;
  dueAt?: string;
  status: 'new' | 'in_work' | 'done';
  takenByPhone?: string;
  resolution?: string;
  createdAt: string;
  overdue: boolean;
}

export interface Incident {
  id: string;
  title: string;
  zone: string;
  category: string;
  openedAt: string;
  closedAt?: string;
  orderIds: string[];
  note?: string;
  openedBy: string;
}

/** Кластер заявок одной зоны за окно детекта — признак массовой аварии. */
export interface IncidentCluster {
  zone: string;
  count: number;
  suspicious: boolean;
}

export interface IncidentDetect {
  windowHours: number;
  threshold: number;
  clusters: IncidentCluster[];
}

export interface HandoverItem {
  id: string;
  kind: string;
  title: string;
  detail: string;
  accepted: boolean;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface Handover {
  id: string;
  fromPhone: string;
  toPhone?: string;
  startedAt: string;
  acceptedAt?: string;
  items: HandoverItem[];
}

/** Пункт черновика: id появляется только после сдачи смены. */
export interface HandoverDraftItem {
  kind: string;
  title: string;
  detail: string;
}

export interface HandoverDraft {
  items: HandoverDraftItem[];
  current: Handover | null;
}

/** Сводка здоровья смены (D-19). */
export interface OpsKpi {
  newToAssignedAvgMin: number;
  ordersTotal: number;
  closedTotal: number;
  cancelledTotal: number;
  activeReplacements: number;
  replacementsTotal: number;
  replacementsResolved: number;
  openIncidents: number;
  moderationQueue: number;
  emergenciesActive: number;
}

// ---------- Качество: жалобы D-10, споры D-11 (/dispatch/quality, ТЗ 17.10, 4.2) ----------

export type ComplaintType =
  | 'quality'
  | 'behavior'
  | 'deadline'
  | 'money'
  | 'service'
  | 'app'
  | 'other';

export type ComplaintStatus = 'new' | 'in_progress' | 'resolved' | 'rejected';

/** Метод плейбука резолюции: резолюция обязана на него ссылаться (ТЗ 17.10). */
export interface PlaybookMethod {
  code: string;
  title: string;
}

export interface PlaybookResponse {
  playbook: PlaybookMethod[];
  types: ComplaintType[];
}

export interface Complaint {
  id: string;
  orderId?: string;
  orderNumber?: string;
  complainantPhone: string;
  complainantName?: string;
  /** Жалоба руководителя организации эскалируется сразу старшему смены. */
  isOrgManager: boolean;
  type: ComplaintType;
  text: string;
  masterId?: string;
  masterName?: string;
  status: ComplaintStatus;
  /** Дедлайн первого ответа: ≤2 ч в окне 8:00–22:00. */
  slaFirstResponseAt: string;
  /** Дедлайн резолюции: ≤24 ч, сложные (деньги, приложение) — ≤72 ч. */
  slaResolutionAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  playbookCode?: string;
  resolution?: string;
  /** Вина подтверждена — только после этого влияет на рейтинг мастера. */
  confirmed?: boolean;
  createdAt: string;
}

/** 3+ подтверждённых жалобы на мастера за 30 дней — повод для разбора. */
export interface ComplaintPattern {
  masterId: string;
  masterName: string;
  count: number;
  types: string[];
}

export interface ComplaintStats {
  total: number;
  open: number;
  overdueFirstResponse: number;
  overdueResolution: number;
  byType: { type: ComplaintType; count: number }[];
  confirmedShare: number;
  patterns: ComplaintPattern[];
}

export interface ComplaintsResponse {
  items: Complaint[];
  stats: ComplaintStats;
}

/** Ответ резолюции жалобы: запись + пересчитанные паттерны. */
export interface ComplaintResolved extends Complaint {
  patterns: ComplaintPattern[];
}

export type DisputeResolution = 'for_client' | 'for_master' | 'compromise';

export interface Dispute {
  id: string;
  orderId: string;
  orderNumber: string;
  openedByPhone: string;
  openedByRole: 'client' | 'dispatcher';
  reason: string;
  amountTiyin: number;
  status: 'open' | 'escalated' | 'resolved';
  resolution?: DisputeResolution;
  refundTiyin?: number;
  /** Спор блокирует начисление доли мастера до резолюции (ТЗ 4.2). */
  masterShareBlocked: boolean;
  handledByPhone?: string;
  comment?: string;
  escalationReason?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ---------- Карта города D-03 (GET /dispatch/map) ----------

/** Активная заявка на карте: координаты — с адреса заявки (геокодер-заглушка). */
export interface MapOrder {
  id: string;
  number: string;
  graphType: string;
  status: string;
  urgency: Urgency;
  address: string;
  clientPhone: string;
  masterName: string | null;
  totalFromTiyin: number;
  lat: number;
  lng: number;
  ageMinutes: number;
}

/**
 * Мастер на карте. Координаты приходят только на время активного визита
 * (master_departed / in_progress / addwork_approval) — постоянной слежки нет (ТЗ 17.5);
 * при lat = null мастер показывается в списке «вне карты», а не маркером.
 */
export interface MapMaster {
  masterId: string;
  masterName: string;
  status: string;
  lat: number | null;
  lng: number | null;
  orderNumber: string | null;
  orderStatus?: string;
  ordersActive: number;
  /** Гео не двигалось 15+ минут — мягкий триггер протокола замены (ТЗ 17.3). */
  stale: boolean;
  minutesSinceMove?: number;
}

/** Объект B2B (точка обслуживания организации). */
export interface MapLocation {
  id: string;
  name: string;
  organization: string;
  address: string;
  lat: number;
  lng: number;
}

export interface MapData {
  orders: MapOrder[];
  masters: MapMaster[];
  locations: MapLocation[];
}
