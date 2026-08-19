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
