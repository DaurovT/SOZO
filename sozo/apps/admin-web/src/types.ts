// Типы данных API SOZO (/v1)

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
  roles: string[];
}

/** A-05: эталонная таблица 123 позиций (PRD-04 §5); значения — документные строки. */
export interface SystemParameter {
  num: number;
  name: string;
  value: string;
  levels: string[];
  usage: string;
  tz: string;
}

export type ReleaseStatus = 'draft' | 'scheduled' | 'active' | 'archived';

export interface PriceRelease {
  id: string;
  number: number;
  status: ReleaseStatus;
  coeffs: Record<string, number>;
  itemsCount: number;
  createdAt: string;
  activatedAt?: string;
}

export interface PriceItem {
  id: string;
  num: number;
  category: string;
  name: string;
  /** Название для узбекского интерфейса — ведёт владелец, пусто = покажем русское */
  nameUz: string | null;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  normHours: number | null;
  note?: string | null;
  /** Атрибуты распределения (ТЗ 3.7/4.1/4.5): skill-фильтр, оборудование, парная, этапная */
  requiredSkills: string[];
  requiresEquipment: boolean;
  isPaired: boolean;
  isStaged: boolean;
}

export interface PriceReleaseDetail extends PriceRelease {
  items: PriceItem[];
}

export interface PriceDiffChange {
  num: number;
  name: string;
  kind: 'added' | 'price_changed';
  from?: [number, number];
  to?: [number, number];
  growth?: number | null;
}

export interface PriceDiff {
  changedShare: number;
  changes: PriceDiffChange[];
}

export type OrgStatus = 'active' | 'suspended' | 'terminated';

export interface Organization {
  id: string;
  name: string;
  inn: string;
  vatPayer: boolean;
  contractType: 'subscription' | 'one_off';
  contractKind: 'annual' | 'monthly';
  subscriptionTiyin: number;
  status: OrgStatus;
  locationsCount: number;
  createdAt: string;
}

/** A-09: паспорт объекта — источник точного расчёта абонентки */
export interface LocationPassport {
  objectType: string | null;
  areaM2: number | null;
  bathrooms: number | null;
  acUnits: number | null;
  electricPanels: number | null;
}

export interface LocationAccess {
  schedule: string | null;
  accessNotes: string | null;
  hoaContact: string | null;
  /** Где перекрыть при аварии — эти строки читает клиент на экране «Авария» */
  waterShutoff: string | null;
  electricalPanel: string | null;
  gasValve: string | null;
}

/**
 * Ответственный на точке: тот, кто в клиентском приложении видит заявки,
 * подписывает акты и утверждает сметы в пределах лимита.
 *
 * `approvalLimitTiyin: null` — без потолка, это уровень организации.
 * Ноль — сотрудник: заявку создать может, утверждать не может.
 */
export interface Representative {
  id: string;
  fullName: string;
  phone: string;
  /** Уровень утверждения из договора — он диктует потолок */
  role: string;
  /** Должность в организации: к деньгам отношения не имеет */
  position?: string | null;
  approvalLimitTiyin: number | null;
  primary: boolean;
}

export interface OrgLocation {
  id: string;
  name: string;
  address: string;
  representatives: Representative[];
  orderLimitTiyin: number;
  monthlyLimitTiyin: number;
  photoForbidden: boolean;
  passport: LocationPassport;
  access: LocationAccess;
  preferredMasterId: string | null;
  blacklistMasterIds: string[];
}

/** A-07/A-16: финансы организации — баланс абонентки с прогнозом */
export interface OrgFinance {
  subscriptionTiyin: number;
  paidTiyin: number;
  consumedTiyin: number;
  balanceTiyin: number;
  forecastDay: number | null;
  overlimit: boolean;
  contractKind: 'annual' | 'monthly';
  priceFreeze: string;
}

/** A-07: условия договора (пороги, SLA, перенос остатка, баллы, пени) */
export interface ContractTerms {
  approvalThresholds: Array<{ role: string; limitTiyin: number | null }>;
  slaEmergencyMin: [number, number];
  carryoverPercent: number;
  loyaltyEnabled: boolean;
  penaltyEnabled: boolean;
  showMoneyToEmployees: boolean;
  materialsSeparateInvoice: boolean;
}

export interface OrganizationDetail extends Organization {
  locations: OrgLocation[];
  terms: ContractTerms;
  terminationNote?: string;
}

export type MasterStatus = 'candidate' | 'checking' | 'training' | 'active' | 'blocked' | 'offboarding';

export type MasterTransport = 'own_car' | 'public' | 'none';

export interface SkillExam {
  skill: string;
  passedAt: string;
  examiner: string;
}

export interface MasterDocument {
  name: string;
  status: 'uploaded' | 'verified' | 'missing';
}

export interface Master {
  id: string;
  fullName: string;
  phone: string;
  status: MasterStatus;
  skillTags: string[];
  skillExams: SkillExam[];
  zones: string[];
  transport: MasterTransport;
  rating: number;
  grade: 'bronze' | 'silver' | 'gold';
  taxMode: 'self_employed' | 'gph';
  gphContractUntil: string | null;
  documents: MasterDocument[];
  hasVehicle: boolean;
  cashDebtTiyin: number;
  qrBadgeCode: string;
  referrerName?: string;
  offboardingNote?: string;
  createdAt: string;
}

/** A-11: полная карточка мастера — агрегат BFF /admin/dashboard/masters/:id/card */
export interface MasterCardOrder {
  id: string;
  number: string;
  status: string;
  address: string;
  totalFromTiyin: number;
  createdAt: string;
}

export interface MasterCard {
  master: Master;
  alerts: {
    gphExpiring: boolean;
    gphDaysLeft: number | null;
    cashDebtNearLimit: boolean;
    documentsMissing: number;
  };
  orders: {
    total: number;
    active: number;
    closed: number;
    recent: MasterCardOrder[];
  };
  money: {
    accruedTiyin: number;
    paidTiyin: number;
    dueTiyin: number;
    cashDebtTiyin: number;
    cashDebtLimitTiyin: number;
  };
  equipment: Array<{ inventoryNumber: string; name: string }>;
  ratingBreakdown: {
    current: number;
    grade: Master['grade'];
    formula: Record<string, number>;
    note: string;
  };
}

export interface AdminDashboard {
  orders: {
    total: number;
    active: number;
    unassigned: number;
    /** Без мастера дольше часа — это уже не «свежие», а зависшие */
    stuck: number;
    /** Сорванный срок выезда по договору (ТЗ 18 п.2) */
    slaOverdue: number;
    emergencies: number;
    closedToday: number;
    cancelled: number;
  };
  /** Только то, из-за чего кто-то уже ждёт дольше обещанного */
  urgent: {
    clientRequests: number;
    clientRequestsOverdue: number;
    partsToBuy: number;
    actsWaiting: number;
    actsExpired: number;
  };
  finance: {
    revenueTiyin: number;
    avgCheckTiyin: number;
    masterPayableTiyin: number;
    reserveFundTiyin: number;
    arTiyin: number;
    balanceCheckOk: boolean;
  };
  people: {
    mastersActive: number;
    mastersCandidates: number;
    organizations: number;
  };
  pricing: {
    activeReleaseNumber: number | null;
    itemsCount: number;
    itemsWithoutNormHours: number;
  };
}

/** P&L (F-007): выручка минус прямые расходы = валовая, минус фонд и амортизация = операционная. */
export interface AnalyticsPnl {
  revenueTiyin: number;
  masterShareTiyin: number;
  providerFeesTiyin: number;
  reserveFundTiyin: number;
  depreciationTiyin: number;
  grossTiyin: number;
  operatingTiyin: number;
  grossMarginPercent: number;
  operatingMarginPercent: number;
  note: string;
}

/** NPS (F-008): считается по закрытым заявкам с оценкой; без оценок nps = null. */
export interface AnalyticsNps {
  ratedCount: number;
  closedCount: number;
  coveragePercent: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  note?: string;
}

/** Упущенный спрос (F-003): клиент искал окно и не нашёл — сигнал найма. */
export interface AnalyticsDemandMiss {
  total: number;
  byReason: Array<{ reason: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
  hint: string;
}

/** Follow-up (F-005): повторные клиенты и гарантийные обращения. */
export interface AnalyticsFollowUp {
  clientsTotal: number;
  repeatClients: number;
  repeatSharePercent: number;
  repeatOrders: number;
  repeatRevenueTiyin: number;
  warrantyOrders: number;
}

/** Парные заявки (F-004): доля выездов вдвоём. */
export interface AnalyticsPairs {
  ordersTotal: number;
  pairedOrders: number;
  pairedSharePercent: number;
  hint: string;
}

/** Ёмкость дня — тот же срез, что у диспетчера в D-04. */
export interface AnalyticsCapacity {
  date: string;
  masters: number;
  totalMin: number;
  busyMin: number;
  loadPercent: number;
  capPercent: number;
  overloaded: number;
  byHour: Array<{ hour: number; busy: number; free: number }>;
  waitlist: number;
}

/** Сводка GET /admin/analytics — весь набор F-003…F-008 одним запросом. */
export interface AdminAnalytics {
  pnl: AnalyticsPnl;
  nps: AnalyticsNps;
  demandMiss: AnalyticsDemandMiss;
  followUp: AnalyticsFollowUp;
  pairs: AnalyticsPairs;
  complaints: ComplaintStats;
  capacity: AnalyticsCapacity;
}

export type ComplaintStatus = 'new' | 'in_progress' | 'resolved' | 'rejected';

/** Жалоба D-10 (ТЗ 17.10): SLA первого ответа и резолюции, метод плейбука, подтверждение вины. */
/**
 * Акт осмотра (ТЗ 9.3): что мастер нашёл на плановом обходе и что с этим
 * решил заказчик. Принятые позиции превращаются в заявки автоматически.
 */
export interface ActParty {
  id: string;
  fullName: string;
  phone: string;
}

export interface DefectItem {
  id: string;
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  /** null — оценить на месте нельзя, цену считает офис после замера */
  estimateTiyin: number | null;
  decision: 'pending' | 'accepted' | 'declined';
  declineReason?: string;
  orderId?: string;
}

export interface InspectionAct {
  id: string;
  number: string;
  organizationId: string;
  locationId: string;
  locationName: string;
  masterName: string;
  checklist: Array<{ zone: string; ok: boolean; note?: string }>;
  items: DefectItem[];
  status: 'draft' | 'sent' | 'approved' | 'partially_approved' | 'rejected' | 'expired';
  createdAt: string;
  sentAt?: string;
  decidedAt?: string;
  representative?: ActParty | null;
  decidedBy?: ActParty;
  rejectionReason?: string;
  representativeAbsent?: boolean;
  expiresAt?: string;
}

export interface InspectionActsPending {
  waiting: number;
  overdue: number;
  items: Array<{ id: string; number: string; locationName: string; status: string }>;
}

export interface Complaint {
  id: string;
  orderNumber?: string;
  complainantPhone: string;
  complainantName?: string;
  isOrgManager: boolean;
  type: string;
  text: string;
  masterName?: string;
  status: ComplaintStatus;
  slaFirstResponseAt: string;
  slaResolutionAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  playbookCode?: string;
  resolution?: string;
  confirmed?: boolean;
  createdAt: string;
}

export interface ComplaintStats {
  total: number;
  open: number;
  overdueFirstResponse: number;
  overdueResolution: number;
  byType: Array<{ type: string; count: number }>;
  confirmedShare: number;
  /** 3+ подтверждённых жалобы на мастера за 30 дней — повод для разбора. */
  patterns: Array<{ masterId: string; masterName: string; count: number; types: string[] }>;
}

export interface ComplaintsResponse {
  items: Complaint[];
  stats: ComplaintStats;
}

export type DisputeStatus = 'open' | 'escalated' | 'resolved';
export type DisputeResolution = 'for_client' | 'for_master' | 'compromise';

/** Спор D-11 (ТЗ 4.2): окно 72 ч после «Выполнена», доля мастера блокируется до резолюции. */
export interface Dispute {
  id: string;
  orderNumber: string;
  openedByPhone: string;
  openedByRole: string;
  reason: string;
  amountTiyin: number;
  status: DisputeStatus;
  resolution?: DisputeResolution;
  refundTiyin?: number;
  masterShareBlocked: boolean;
  comment?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface DisputeStats {
  total: number;
  open: number;
  refundTotalTiyin: number;
  byResolution: Array<{ resolution: DisputeResolution; count: number }>;
}

export interface DisputesResponse {
  items: Dispute[];
  stats: DisputeStats;
}

export interface AdminUser {
  id: string;
  phone: string;
  fullName: string;
  roles: string[];
  /** Доступ закрыт: учётная запись не удаляется, чтобы след в аудите читался */
  blockedAt?: string;
  blockedReason?: string;
  lastLoginAt?: string;
}

export type EquipmentStatus = 'in_stock' | 'issued' | 'maintenance' | 'written_off';

export interface EquipmentItem {
  id: string;
  inventoryNumber: string;
  name: string;
  costTiyin: number;
  status: EquipmentStatus;
  issuedToMasterName?: string;
}

export interface PartnerStore {
  id: string;
  name: string;
  categories: string[];
  creditLimitTiyin: number;
  payableTiyin: number;
  status: string;
}

export interface Consumable {
  id: string;
  name: string;
  unit: string;
  fixPriceTiyin: number;
}

export type AccountKind = 'asset' | 'liability' | 'income' | 'expense';

export interface BillingAccount {
  code: string;
  name: string;
  kind: AccountKind;
  balanceTiyin: number;
}

export interface BillingTransaction {
  id: string;
  operationId: string;
  type: string;
  debit: string;
  credit: string;
  amountTiyin: number;
  orderId?: string;
  masterId?: string;
  isStorno: boolean;
  reversedTxId?: string;
  comment: string;
  createdAt: string;
}

export interface BalanceCheck {
  ok: boolean;
  discrepancyTiyin: number;
  totalDebitTiyin: number;
  totalCreditTiyin: number;
  txCount: number;
  checkedAt: string;
}

export type InvoiceStatus = 'issued' | 'paid';

export interface Invoice {
  id: string;
  number: string;
  organizationId: string;
  organizationName: string;
  kind: string;
  amountTiyin: number;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt?: string;
  /** НДС внутри суммы, записан при выставлении и потом не пересчитывается */
  vatTiyin: number;
  vatRatePercent: number;
}

export interface PayoutRow {
  masterId: string;
  masterName: string;
  accruedTiyin: number;
  paidTiyin: number;
  dueTiyin: number;
}

export interface ReceivableRow {
  number: string;
  organizationName: string;
  amountTiyin: number;
  ageDays: number;
  issuedAt?: string;
}

export interface ReceivablesData {
  buckets: {
    d0_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  rows: ReceivableRow[];
}

/** A-19: закрытие периода */
export interface BillingPeriod {
  month: string;
  closed: boolean;
  txCount: number;
  revenueTiyin: number;
}

/** A-31: налоговые регистры */
export interface TaxRegisters {
  month: string;
  invoicesRegister: Array<{
    number: string;
    organization: string;
    kind: string;
    amountTiyin: number;
    vatTiyin: number;
    status: string;
    issuedAt: string;
  }>;
  receiptsRegister: Array<{
    orderId?: string;
    channel: string;
    amountTiyin: number;
    at: string;
    note: string;
  }>;
  payoutsRegister: Array<{
    masterId?: string;
    amountTiyin: number;
    at: string;
    note: string;
  }>;
}

/** A-32: стартовые остатки */
export interface OpeningBalancesResult {
  operationId: string;
  entries: number;
  balanceCheck: BalanceCheck;
}

/** A-21: клиринг Payme/Click */
export interface ClearingState {
  pendingTiyin: number;
  register: Array<{ orderId?: string; amountTiyin: number; at: string }>;
}

/** A-37: воронка B2B-лидов */
export type LeadStage = 'new' | 'demo' | 'audit' | 'proposal' | 'contract' | 'rejected';

export interface Lead {
  id: string;
  company: string;
  contactName: string;
  phone: string;
  pointsCount: number;
  objectType?: string;
  stage: LeadStage;
  rejectReason?: string;
  utm?: Record<string, string>;
  note?: string;
  organizationId?: string;
  createdAt: string;
}

/** A-12: воронка онбординга мастеров */
export interface MasterFunnelStage {
  stage: MasterStatus;
  count: number;
  masters: Master[];
}

/**
 * Кандидат в воронке онбординга (ТЗ 17.1). Шесть стадий, а не четыре статуса
 * карточки мастера: анкета и документы происходят до того, как карточка вообще
 * заведена, а собеседование и экзамен в статусе не отражаются никак.
 */
export interface OnboardingCandidate {
  id: string;
  phone: string;
  fullName: string;
  skillTags: string[];
  experienceYears: number;
  documentsReady: boolean;
  toolsReady: boolean;
  trainingDone: number;
  bestExam: number;
  interviewAt?: string;
  updatedAt: string;
}

export interface OnboardingStage {
  code: string;
  title: string;
  count: number;
  candidates: OnboardingCandidate[];
}

export interface OnboardingFunnel {
  stages: OnboardingStage[];
  total: number;
}

/** A-38: внутренний склад */
export type StockCategory = 'special_equipment' | 'tool' | 'consumable' | 'uniform_merch' | 'other';

export interface StockItem {
  id: string;
  category: StockCategory;
  name: string;
  unit: string;
  qtyOnHand: number;
  minQty: number;
  costTiyin: number;
  belowMin: boolean;
}

export type StockMovementType = 'receipt' | 'temp_use' | 'sale_to_master' | 'write_off' | 'return';

export interface StockMovement {
  id: string;
  stockItemId: string;
  itemName: string;
  type: StockMovementType;
  qty: number;
  masterId?: string;
  masterName?: string;
  priceTiyin?: number;
  comment?: string;
  createdAt: string;
}

/** A-20: резервный фонд ущербов */
export type DamageCaseStatus = 'filed' | 'review' | 'approved' | 'rejected' | 'paid';

export interface DamageCase {
  id: string;
  orderId?: string;
  description: string;
  claimantName: string;
  amountTiyin: number;
  regressTiyin: number;
  masterId?: string;
  masterName?: string;
  status: DamageCaseStatus;
  resolution?: string;
  createdAt: string;
}

/** Справочники (registry) */
export interface SparePart {
  id: string;
  name: string;
  unit: string;
  economTiyin: number;
  standardTiyin: number;
  premiumTiyin: number;
}

export interface Zone {
  id: string;
  city: string;
  name: string;
  active: boolean;
}

export interface ComplaintType {
  type: string;
  slaFirstResponseH: number;
  slaResolutionH: number;
}

export interface ObjectTypeRate {
  id: string;
  objectType: string;
  ratePerM2Tiyin: number;
  typicalAreaM2: number;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface ToolChecklist {
  skill: string;
  tools: string[];
}

export interface InspectionChecklist {
  objectType: string;
  items: string[];
}

/** A-01: карта клиентов — точки B2B и заявки с гео */
export interface MapLocation {
  id: string;
  name: string;
  address: string;
  organization: string;
  orgStatus: OrgStatus;
  lat: number;
  lng: number;
}

export interface MapOrder {
  id: string;
  number: string;
  graphType: string;
  status: string;
  urgency: string;
  clientPhone: string;
  address: string;
  totalFromTiyin: number;
  lat: number;
  lng: number;
  active: boolean;
}

export interface MapData {
  locations: MapLocation[];
  orders: MapOrder[];
}

/** Промокоды (ТЗ 15, решение №13) */
export interface PromoCode {
  id: string;
  code: string;
  discountPercent: number;
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  comment?: string;
  createdAt: string;
}

/** A-36: баллы персонала точек и пул ваучеров (ТЗ 17.14) */
export interface LoyaltyOperation {
  id?: string;
  kind: 'accrual' | 'voucher' | 'storno';
  amountTiyin: number;
  note: string;
  at: string;
}

export interface LoyaltyAccount {
  phone: string;
  balanceTiyin: number;
  history: LoyaltyOperation[];
}

export interface Voucher {
  id: string;
  code: string;
  nominalTiyin: number;
  expiresAt: string;
  status: 'free' | 'issued';
  issuedToPhone?: string;
  issuedAt?: string;
}

export interface AuditRecord {
  id: string;
  actorPhone: string;
  action: string;
  entity: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
}

// ---------- A-01: реестр заявок (read-only срез операционки, PRD-04) ----------

export type OrderGraphType =
  | 'b2c'
  | 'b2b'
  | 'emergency'
  | 'warranty'
  | 'from_defect'
  | 'inspection';

export type OrderUrgency = 'normal' | 'urgent' | 'emergency';

export type OrderSource = 'phone' | 'app' | 'landing';

/** Строка списка GET /admin/orders — агрегаты вместо вложенных массивов. */
export interface AdminOrder {
  id: string;
  number: string;
  graphType: OrderGraphType;
  status: string;
  urgency: OrderUrgency;
  source: OrderSource;
  clientPhone: string;
  clientName: string;
  address: string;
  description: string;
  masterName: string | null;
  organizationId: string | null;
  baseFromTiyin: number;
  totalFromTiyin: number;
  totalMaterialTiyin: number;
  promoCode: string | null;
  promoDiscountPercent: number | null;
  photosCount: number;
  photosWithFile: number;
  quotesCount: number;
  materialsCount: number;
  createdAt: string;
  closedAt: string | null;
}

export interface OrderLine {
  priceItemId?: string;
  name: string;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  qty: number;
}

/** Смета: первичная вилка → санкция клиента → доп-сметы (ТЗ 4.6). */
export interface OrderQuote {
  kind: 'initial' | 'approved' | 'additional_forced' | 'additional_upsell' | 'conservation';
  amountTiyin: number;
  approvedVia?: string;
  note?: string;
  at: string;
}

/** Фото заявки: у загруженных снимков есть `file`, у отметок конвейера — нет (PRD-05 §9). */
export interface OrderPhoto {
  id?: string;
  stage: 'before' | 'during' | 'after' | 'receipt';
  source: string;
  file?: string;
  geoMissing?: boolean;
  at: string;
}

export interface OrderMaterial {
  kind: 'spare_part' | 'consumable';
  name: string;
  amountTiyin: number;
  sourceChannel?: string;
  hasReceipt: boolean;
  priceTier?: string;
  at: string;
}

export interface OrderStatusLogEntry {
  from: string | null;
  to: string;
  action: string;
  actorPhone: string;
  reason?: string | null;
  at: string;
}

/** Карточка GET /admin/orders/:id — полный состав без действий над конвейером. */
export interface AdminOrderDetail {
  id: string;
  number: string;
  graphType: OrderGraphType;
  status: string;
  urgency: OrderUrgency;
  source: OrderSource;
  clientPhone: string;
  clientName: string;
  address: string;
  description: string;
  masterId?: string | null;
  masterName?: string | null;
  organizationId?: string | null;
  lines: OrderLine[];
  baseFromTiyin: number;
  baseToTiyin: number;
  totalFromTiyin: number;
  totalToTiyin: number;
  totalMaterialTiyin?: number;
  promoCode?: string | null;
  promoDiscountPercent?: number | null;
  quotes?: OrderQuote[];
  photos?: OrderPhoto[];
  materials?: OrderMaterial[];
  statusLog?: OrderStatusLogEntry[];
  createdAt: string;
  /** Пояснение границы ролей, приходит с сервера. */
  readOnlyNote: string;
}
