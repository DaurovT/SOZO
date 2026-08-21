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

/**
 * Язык страницы уезжает в заголовке: половина того, что видит посетитель,
 * приходит отсюда — названия позиций прайса, тексты ошибок. Без заголовка
 * французская страница показала бы французские кнопки и русские ошибки
 * между ними. Читаем его из адреса, а не из контекста React: сюда, в
 * обычные функции, контекст не дотягивается, а язык всё равно задан URL-ом.
 */
function acceptLanguage(): string {
  const first = window.location.pathname.split('/')[1] ?? '';
  return /^[a-z]{2}$/.test(first) ? first : 'ru';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': acceptLanguage(),
        ...(init?.headers ?? {}),
      },
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

/**
 * Текст ошибки на языке страницы.
 *
 * Сначала свой словарь по коду: коды у нас конечны и заведены заранее, а
 * перевод в них точнее серверного — на лендинге ошибка стоит рядом с формой
 * и должна говорить, что делать. Незнакомый код показывает сообщение
 * сервера: оно уже пришло на нужном языке (см. `Accept-Language`), а
 * молчание в этом месте хуже чужой формулировки.
 */
export function apiErrorText(
  e: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!(e instanceof ApiError)) return t('error.unknown');
  const key = `error.${e.code}`;
  const translated = t(key);
  return translated === key ? e.message : translated;
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
  /**
   * Язык, на котором заполнена форма (PRD-06 §5.3, F-16).
   *
   * Не косметика: на нём же диспетчер перезвонит и на нём уйдёт SMS. Человек,
   * заполнивший корейскую форму, ждёт корейского сообщения, а не русского.
   */
  lang?: string;
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

/* ---------- Публичная карточка объекта (L-10) ---------- */

export interface PublicShutdown {
  resourceLabel: string;
  windowText: string;
  reason: string;
}

export interface PublicBuilding {
  name: string | null;
  address: string | null;
  operatorName: string | null;
  connectionStatus: 'unmanaged' | 'claimed' | 'verified' | 'active' | 'degraded';
  emergencyPhone: string | null;
  shutdowns: PublicShutdown[];
}

/**
 * Карточка дома по коду с наклейки в подъезде.
 * Неподключённый и несуществующий объект отвечают одинаково — по ответу
 * нельзя составить реестр наших домов перебором кодов.
 */
export function fetchBuilding(code: string): Promise<PublicBuilding> {
  return request<PublicBuilding>(`/public/buildings/${encodeURIComponent(code)}`);
}

/** «Моего дома здесь нет» — обращение копится в реестре модерации (A-39) */
export function submitDemand(address: string, phone?: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/public/demand', {
    method: 'POST',
    body: JSON.stringify({ address, phone }),
  });
}
