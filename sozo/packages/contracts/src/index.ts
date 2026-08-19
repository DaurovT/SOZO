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
