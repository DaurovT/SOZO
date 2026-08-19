/**
 * Публичный API SOZO (PRD-05 §12.8) — read-only цены/ставки/верификация + приём лидов.
 * Все эндпоинты БЕЗ авторизации. База выносится в VITE_API_URL (см. .env.example).
 */

const RAW_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

export const API_BASE = RAW_BASE.replace(/\/+$/, '');

/** Ошибка с кодом из тела ответа: CONSENT_REQUIRED, PHONE_INVALID, … */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('NETWORK', 'Сервис временно недоступен. Попробуйте позже.');
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = body as { code?: string; message?: string } | null;
    throw new ApiError(err?.code ?? 'HTTP_ERROR', err?.message ?? `Ошибка сервиса (${res.status})`);
  }

  return body as T;
}

/* ---------- Цены ---------- */

export interface PriceCategory {
  category: string;
  /** Сумма в ТИЙИНАХ: 1 сум = 100 тийин. */
  priceFromTiyin: number;
}

export interface PublicPrices {
  releaseNumber: number;
  categories: PriceCategory[];
  note: string;
}

export function fetchPrices(): Promise<PublicPrices> {
  return request<PublicPrices>('/public/prices');
}

/* ---------- Ставки типов объектов (справочник A-29) ---------- */

export interface ObjectTypeRate {
  objectType: string;
  ratePerM2Tiyin: number;
  typicalAreaM2: number;
}

export function fetchObjectTypeRates(): Promise<ObjectTypeRate[]> {
  return request<ObjectTypeRate[]>('/public/object-type-rates');
}

/* ---------- Верификация мастера по QR ---------- */

export type MasterVerify =
  | { valid: true; fullName: string; skillTags: string[]; grade: string; message: string }
  | { valid: false; message: string };

export function fetchMasterVerify(code: string): Promise<MasterVerify> {
  return request<MasterVerify>(`/public/master-verify/${encodeURIComponent(code)}`);
}

/* ---------- Лиды ---------- */

export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

interface LeadBase {
  /** Телефон в E.164: +998XXXXXXXXX */
  phone: string;
  name?: string;
  /** ЗРУ-547 — без true бэкенд вернёт CONSENT_REQUIRED. */
  consent: true;
  utm?: Utm;
}

export type LeadPayload =
  | (LeadBase & { kind: 'b2c'; category: string; description?: string })
  | (LeadBase & {
      kind: 'b2b';
      company: string;
      pointsCount: number;
      objectType: string;
      email?: string;
    })
  | (LeadBase & {
      kind: 'master';
      skills: string[];
      experience: string;
      transport: 'own_car' | 'public' | 'none';
      zones: string[];
    });

/**
 * Обычный Omit «схлопнул» бы объединение до общих полей, поэтому распределяем его
 * по каждому варианту: у b2c остаётся category, у b2b — company и т.д.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Лид без utm — метки подмешивает useLeadSubmit. */
export type LeadInput = DistributiveOmit<LeadPayload, 'utm'>;

export interface LeadResponse {
  accepted: boolean;
  ticket: string;
  slaMinutes?: number;
}

export function submitLead(payload: LeadPayload): Promise<LeadResponse> {
  return request<LeadResponse>('/public/leads', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
