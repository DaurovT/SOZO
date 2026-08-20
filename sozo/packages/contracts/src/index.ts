// @sozo/contracts — единственный источник типов API (DEV-07 §1).
// Коды статусов/действий — DEV-03 (OpenAPI) и DEV-10 (графы). Менять синхронно с ними.
import { z } from 'zod';

// ---------- Статусы и типы заявок (DEV-03 OrderStatus / DEV-10 §1) ----------

export const ORDER_STATUSES = [
  'new',
  'estimated',
  'pending_approval',
  'approved',
  'assigned',
  'master_departed',
  'in_progress',
  'addwork_approval',
  'completed',
  'verified',
  'awaiting_payment',
  'closed',
  'rated',
  'cancelled',
  'dispute',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAUSES = ['awaiting_materials', 'tech_break', 'blocked_third_party'] as const;
export type OrderPause = (typeof ORDER_PAUSES)[number];

export const ORDER_TYPES = ['b2c', 'b2b', 'warranty', 'from_defect', 'inspection'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

// Расширенные типы графов DEV-10 §4 (аварийная/этапная/парная — вариации канала)
export const GRAPH_TYPES = [
  'b2c',
  'b2b',
  'emergency',
  'inspection',
  'warranty',
  'from_defect',
] as const;
export type GraphType = (typeof GRAPH_TYPES)[number];

// ---------- Действия переходов (DEV-03 TransitionAction / DEV-10 §2) ----------

export const TRANSITION_ACTIONS = [
  'estimate',
  'request_approval',
  'approve',
  'assign',
  'depart',
  'start',
  'confirm_estimate',
  'request_addwork',
  'resolve_addwork',
  'pause',
  'resume',
  'complete_stage',
  'complete',
  'verify',
  'return_to_work',
  'await_payment',
  'close',
  'rate',
  'cancel',
  'open_dispute',
  'resolve_dispute',
] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

// ---------- Схемы запросов ----------

export const TransitionRequestSchema = z.object({
  action: z.enum(TRANSITION_ACTIONS),
  version: z.number().int().nonnegative(), // оптимистичная блокировка (DEV-10 §3.6)
  clientOpUuid: z.string().uuid().optional(), // идемпотентность офлайн-операций (ТЗ 7.2)
  reason: z.string().max(500).optional(), // обязателен для cancel — проверяет guard
  payload: z.record(z.unknown()).optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

export const OrderCreateSchema = z.object({
  type: z.enum(ORDER_TYPES),
  urgency: z.enum(['normal', 'urgent', 'emergency']).default('normal'),
  clientId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  address: z.object({ street: z.string(), house: z.string() }).optional(), // детали — C-50 после назначения
  lines: z
    .array(z.object({ priceItemId: z.string().uuid(), qty: z.number().positive().default(1) }))
    .default([]),
  description: z.string().max(2000).optional(),
  clientUuid: z.string().uuid().optional(),
});
export type OrderCreate = z.infer<typeof OrderCreateSchema>;

// Машиночитаемая ошибка недопустимого перехода — 409 (DEV-03)
export interface StateMachineViolation {
  code: 'STATE_MACHINE_VIOLATION' | 'GUARD_FAILED' | 'VERSION_CONFLICT';
  orderType: string;
  from: OrderStatus;
  action: TransitionAction;
  failedGuard?: string;
  message: string;
}

// ============================================================
// КОНТУР «ДОМ» (M7/M8) — DEV-15, DEV-10 §7, DEV-03
// Менять только синхронно с DEV-10 §7.5 (машиночитаемое описание графа).
// ============================================================

export const PERMIT_STATUSES = [
  'draft',
  'requested',
  'approved',
  'rescheduled',
  'rejected',
  'scheduled',
  'opened',
  'closed',
  'expired',
  'cancelled',
] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_TERMINAL_STATUSES = ['rejected', 'closed', 'expired', 'cancelled'] as const;

export const PERMIT_ACTIONS = [
  'submit',
  'approve',
  'auto_approve',
  'reject',
  'propose_window',
  'accept_window',
  'decline_window',
  'schedule',
  'open',
  'close',
  'expire',
  'cancel',
] as const;
export type PermitAction = (typeof PERMIT_ACTIONS)[number];

export const PERMIT_APPROVAL_KINDS = ['manual', 'auto_silence', 'emergency_override'] as const;
export type PermitApprovalKind = (typeof PERMIT_APPROVAL_KINDS)[number];

export const BUILDING_CONNECTION_STATUSES = [
  'unmanaged',
  'claimed',
  'verified',
  'active',
  'degraded',
] as const;
export type BuildingConnectionStatus = (typeof BUILDING_CONNECTION_STATUSES)[number];

export const SHUTDOWN_STATUSES = ['draft', 'scheduled', 'active', 'restored', 'cancelled'] as const;
export type ShutdownStatus = (typeof SHUTDOWN_STATUSES)[number];

export const RESOURCE_TYPES = [
  'cold_water',
  'hot_water',
  'heating',
  'electricity',
  'gas',
  'sewage',
  'lift',
  'ventilation',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ZONE_TYPES = [
  'electrical_panel',
  'water_riser',
  'sewage_riser',
  'basement',
  'roof',
  'technical_floor',
  'lift_machine_room',
  'ventilation_chamber',
  'heat_point',
  'gas_equipment',
  'fire_system',
  'yard',
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export interface ZoneTypeInfo {
  code: ZoneType;
  label: string;
  /** авто-согласие молчанием запрещено — наряд ждёт решения человека */
  critical: boolean;
  /** наряд мастеру платформы не выдаётся вообще (ТЗ 17.8) */
  licensed: boolean;
  /** квалификация, без которой мастер платформы в зону не заходит */
  qualification: string | null;
}

/**
 * A-41 — справочник типов общих зон (DEV-15 §4).
 *
 * Единственный источник: раньше коды жили в ZONE_TYPES, флаги критичности —
 * в buildings.service, подписи — в контроллере страницы согласования, а
 * админка держала свою копию всего сразу. Подписи уже разъехались
 * («вентиляционная камера» против «камеры дымоудаления»), и это ровно тот
 * случай, когда консьерж в SMS читает одно, а инженер в кабинете — другое.
 *
 * Два флага несут разный смысл и путать их нельзя: критичная зона запрещает
 * авто-согласие, лицензируемая запрещает самого исполнителя.
 */
export const ZONE_TYPE_INFO = [
  { code: 'water_riser',         label: 'Стояк ХВС',                critical: false, licensed: false, qualification: null },
  { code: 'sewage_riser',        label: 'Канализационный стояк',    critical: false, licensed: false, qualification: null },
  { code: 'basement',            label: 'Подвал',                   critical: false, licensed: false, qualification: 'замкнутые пространства' },
  { code: 'yard',                label: 'Двор',                     critical: false, licensed: false, qualification: null },
  { code: 'technical_floor',     label: 'Техэтаж',                  critical: false, licensed: false, qualification: null },
  { code: 'electrical_panel',    label: 'Электрощитовая',           critical: true,  licensed: false, qualification: 'группа по электробезопасности' },
  { code: 'roof',                label: 'Кровля',                   critical: true,  licensed: false, qualification: 'работы на высоте' },
  { code: 'heat_point',          label: 'ИТП',                      critical: true,  licensed: false, qualification: 'тепловые энергоустановки' },
  { code: 'ventilation_chamber', label: 'Камера дымоудаления',      critical: true,  licensed: false, qualification: null },
  { code: 'gas_equipment',       label: 'Газовое оборудование',     critical: true,  licensed: true,  qualification: 'лицензия на газ' },
  { code: 'lift_machine_room',   label: 'Лифтовая',                 critical: true,  licensed: true,  qualification: 'лицензия на лифты' },
  { code: 'fire_system',         label: 'Пожарные системы',         critical: true,  licensed: true,  qualification: 'лицензия МЧС' },
] as const satisfies readonly ZoneTypeInfo[];

/**
 * Компилятор следит, что справочник покрывает все коды: добавили зону в
 * ZONE_TYPES и забыли описать — сборка падает здесь, а не молча в рантайме,
 * где зона окажется некритичной и уйдёт под авто-согласие.
 */
type AssertNever<T extends never> = T;
type _ZoneCoverage = AssertNever<Exclude<ZoneType, (typeof ZONE_TYPE_INFO)[number]['code']>>;

export const CRITICAL_ZONE_TYPES = ZONE_TYPE_INFO.filter((z) => z.critical).map((z) => z.code);
export const LICENSED_ZONE_TYPES = ZONE_TYPE_INFO.filter((z) => z.licensed).map((z) => z.code);

/** Подпись зоны для человека; неизвестный код возвращается как есть */
export function zoneLabel(code: string): string {
  return ZONE_TYPE_INFO.find((z) => z.code === code)?.label ?? code;
}

export const ORDER_SCOPES = ['private', 'common_area'] as const;
export type OrderScope = (typeof ORDER_SCOPES)[number];

export const LABOR_SETTLEMENTS = ['salary', 'share'] as const;
export type LaborSettlement = (typeof LABOR_SETTLEMENTS)[number];

export const TENANT_KINDS = ['hoa', 'bc', 'inhouse', 'fm'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const SUBSCRIPTION_PLANS = ['free', 'pro', 'enterprise'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** Единица тарификации подписки (параметр 139). Действующая — per_object (ТЗ 19.3 п.2) */
export const BILLING_UNITS = ['per_object', 'per_unit'] as const;
export type BillingUnit = (typeof BILLING_UNITS)[number];

/** Цена Pro по умолчанию: 3 000 000 сум = 300 000 000 тийин за объект в месяц (параметр 138) */
export const PRO_PRICE_PER_OBJECT_TIYIN = 300_000_000n;

export const PASS_TYPES = [
  'master',
  'helper',
  'guest',
  'resident_contractor',
  'operator_contractor',
] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const SLA_BREACH_FLAGS = ['response', 'arrival', 'resolution'] as const;
export type SlaBreachFlag = (typeof SLA_BREACH_FLAGS)[number];

export const OBSERVATION_SEVERITIES = [
  'emergency',
  'work_required',
  'housekeeping',
  'info',
] as const;
export type ObservationSeverity = (typeof OBSERVATION_SEVERITIES)[number];

export const OBSERVATION_SOURCES = ['walkthrough', 'resident', 'master', 'complaint'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const OBSERVATION_ROUTES = ['task', 'defect', 'order', 'contractor', 'journal'] as const;
export type ObservationRoute = (typeof OBSERVATION_ROUTES)[number];

export interface ObservationCategory {
  id: string;
  label: string;
  /** серьёзность, если фиксирующий её не указал */
  defaultSeverity: ObservationSeverity;
  /** куда замечание уходит по умолчанию — решение всё равно за человеком */
  defaultRoute: ObservationRoute;
  /**
   * иконка плитки быстрой фиксации M-49.
   * Имя обязано существовать в assets/icons приложения мастера — иначе плитка
   * рисуется пустой; стережёт тест master-app/test/observation_icons_test.dart
   */
  icon: string;
}

/**
 * A-44 — справочник категорий замечаний (DEV-15 §7.7.2, PRD-04 A-44).
 *
 * Шире каталога дефектов намеренно: грязь во дворе, перегоревший фонарь и
 * граффити не являются дефектами оборудования, но терять их нельзя. Тащить
 * их в DEFECT неправильно — техдолг перестал бы означать состояние здания.
 *
 * Порядок значим: это порядок плиток на экране быстрой фиксации, а мастер
 * бьёт по ним не глядя. Сверху то, что встречается на каждом обходе.
 */
export const OBSERVATION_CATEGORIES: readonly ObservationCategory[] = [
  { id: 'housekeeping',  label: 'Содержание и уборка',       defaultSeverity: 'housekeeping',   defaultRoute: 'task',       icon: 'sparkles' },
  { id: 'lighting',      label: 'Освещение',                  defaultSeverity: 'work_required',  defaultRoute: 'task',       icon: 'bolt' },
  { id: 'small_forms',   label: 'Малые архитектурные формы',   defaultSeverity: 'work_required',  defaultRoute: 'task',       icon: 'toolbox' },
  { id: 'greenery',      label: 'Зелёные насаждения',          defaultSeverity: 'housekeeping',   defaultRoute: 'contractor', icon: 'globe' },
  { id: 'parking',       label: 'Парковка и проезды',          defaultSeverity: 'housekeeping',   defaultRoute: 'journal',    icon: 'car' },
  { id: 'waste',         label: 'Мусорные площадки',           defaultSeverity: 'housekeeping',   defaultRoute: 'contractor', icon: 'archive' },
  { id: 'vandalism',     label: 'Вандализм и граффити',        defaultSeverity: 'work_required',  defaultRoute: 'task',       icon: 'pen' },
  { id: 'engineering',   label: 'Инженерные системы',          defaultSeverity: 'work_required',  defaultRoute: 'defect',     icon: 'wrench' },
  { id: 'structure',     label: 'Конструктив',                 defaultSeverity: 'work_required',  defaultRoute: 'defect',     icon: 'home' },
  { id: 'safety',        label: 'Безопасность и доступность',  defaultSeverity: 'emergency',      defaultRoute: 'order',      icon: 'shield' },
  { id: 'residents',     label: 'Нарушения жителей',           defaultSeverity: 'info',           defaultRoute: 'journal',    icon: 'users' },
] as const;

export const OBSERVATION_CATEGORY_IDS = OBSERVATION_CATEGORIES.map((c) => c.id);

export function observationCategory(id: string): ObservationCategory | undefined {
  return OBSERVATION_CATEGORIES.find((c) => c.id === id);
}

/** Коды ошибок контура (DEV-03) */
export const PERMIT_ERROR_CODES = [
  'ACCESS_PERMIT_REQUIRED',   // start заявки без открытого наряда (DEV-10 §3 правило 9)
  'QUALIFICATION_REQUIRED',   // мастер платформы без действующей квалификации под зону
  'LICENSED_ZONE_FORBIDDEN',  // лицензируемая зона мастеру платформы — всегда запрещена (ТЗ 17.8)
  'SERVICE_FEE_ABOVE_CAP',    // ставка сбора выше потолка 10%
  'SHIFT_OVERLAP',            // пересечение смен разных работодателей одного мастера
] as const;
export type PermitErrorCode = (typeof PERMIT_ERROR_CODES)[number];

/** Тело запроса перехода наряда: POST /permits/{id}/transitions */
export const permitTransitionSchema = z.object({
  action: z.enum(PERMIT_ACTIONS),
  clientOpUuid: z.string().uuid(), // идемпотентность офлайн-синка мастера
  reason: z.string().max(500).optional(),
  windowFrom: z.string().datetime().optional(),
  windowTo: z.string().datetime().optional(),
  photoId: z.string().uuid().optional(),
});
export type PermitTransitionRequest = z.infer<typeof permitTransitionSchema>;
