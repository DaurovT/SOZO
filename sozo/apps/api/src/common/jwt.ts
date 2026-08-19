import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Dev-JWT (HS256) без внешних зависимостей — для M0-заглушки identity.
 * TODO(M0-E2-S2): ротация refresh, отзыв, секрет из секрет-хранилища.
 */
/**
 * Секрет подписи. В проде обязателен и не может остаться дефолтным: этим
 * ключом подписываются роли, и знающий его выпишет себе admin. Поэтому
 * NODE_ENV=production без своего JWT_SECRET — отказ на старте, а не
 * молчаливая работа с ключом из репозитория.
 */
const DEV_SECRET = 'dev-only-change-me';

function resolveSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  const isProd = process.env.NODE_ENV === 'production';
  if (fromEnv && fromEnv !== DEV_SECRET) return fromEnv;
  if (isProd) {
    throw new Error(
      'JWT_SECRET не задан (или оставлен дефолтным) при NODE_ENV=production. ' +
        'Сгенерируйте: openssl rand -base64 48 — и передайте через окружение.',
    );
  }
  return DEV_SECRET;
}

const SECRET = resolveSecret();

export interface JwtClaims {
  sub: string;
  phone: string;
  roles: string[];
  exp: number; // unix seconds
}

const b64u = (buf: Buffer) => buf.toString('base64url');

export function signJwt(claims: Omit<JwtClaims, 'exp'>, ttlSeconds = 15 * 60): string {
  const header = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64u(Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64u(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = b64u(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as JwtClaims;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
