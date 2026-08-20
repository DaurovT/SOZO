import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';

export interface UserRecord {
  id: string;
  phone: string;
  fullName: string;
  roles: string[];
  blockedAt?: string;
  blockedReason?: string;
  lastLoginAt?: string;
}

export interface LoginEventRec {
  id: string;
  phone: string;
  at: string;
  ok: boolean;
  reason?: string;
  roles: string[];
}

export interface IdentityRepository {
  byPhone(phone: string): Promise<UserRecord | undefined>;
  byId(id: string): Promise<UserRecord | undefined>;
  list(): Promise<UserRecord[]>;
  create(u: Omit<UserRecord, 'id'>): Promise<UserRecord>;
  save(u: UserRecord): Promise<void>;
  trackLogin(e: Omit<LoginEventRec, 'id'>): Promise<void>;
  loginLog(limit: number): Promise<LoginEventRec[]>;
}

/**
 * Роли в базе — перечень RoleKind, в коде — свои строки, и они не совпадают:
 * схема писалась по DEV-02, где клиент называется `b2c_client`. Отображение
 * держим в одном месте: разъехавшиеся копии этого списка означали бы, что
 * человек с ролью admin в базе не админ в приложении.
 */
const TO_DB: Record<string, string> = {
  client: 'b2c_client',
  master: 'master',
  dispatcher: 'dispatcher',
  accountant: 'accountant',
  admin: 'admin',
};
const FROM_DB: Record<string, string> = Object.fromEntries(Object.entries(TO_DB).map(([k, v]) => [v, k]));

@Injectable()
export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly users = new Map<string, UserRecord>(); // ключ — телефон
  private readonly logins: LoginEventRec[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'identity',
      () => ({ users: [...this.users.values()], logins: this.logins.slice(-1000) }),
      (d) => {
        // Раньше здесь лежал просто массив пользователей — читаем оба вида,
        // иначе обновление стирает всех, кто был заведён до него
        const data = Array.isArray(d)
          ? { users: d as UserRecord[], logins: [] as LoginEventRec[] }
          : (d as { users: UserRecord[]; logins?: LoginEventRec[] });
        this.users.clear();
        for (const u of data?.users ?? []) this.users.set(u.phone, u);
        this.logins.length = 0;
        this.logins.push(...(data?.logins ?? []));
      },
    );
  }

  async byPhone(phone: string) {
    return this.users.get(phone);
  }
  async byId(id: string) {
    return [...this.users.values()].find((u) => u.id === id);
  }
  async list() {
    return [...this.users.values()];
  }
  async create(u: Omit<UserRecord, 'id'>) {
    const rec = { id: uuidv7(), ...u };
    this.users.set(rec.phone, rec);
    this.store.persist();
    return rec;
  }
  async save(u: UserRecord) {
    this.users.set(u.phone, u);
    this.store.persist();
  }
  async trackLogin(e: Omit<LoginEventRec, 'id'>) {
    this.logins.push({ id: uuidv7(), ...e });
    if (this.logins.length > 2000) this.logins.splice(0, this.logins.length - 2000);
    this.store.persist();
  }
  async loginLog(limit: number) {
    return this.logins.slice(-limit).reverse();
  }
}

/** Идентификатор из снимка мог быть не uuid: колонка строгая, журнал — нет */
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

@Injectable()
export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  private tenant(): string {
    return (currentDbContext() ?? systemContext()).tenantId;
  }

  private toRecord(u: {
    id: string;
    phone: string;
    fullName: string | null;
    blockedAt: Date | null;
    blockedReason: string | null;
    lastLoginAt: Date | null;
    roles: { role: string }[];
  }): UserRecord {
    return {
      id: u.id,
      phone: u.phone,
      fullName: u.fullName ?? '',
      roles: u.roles.map((r) => FROM_DB[r.role] ?? r.role),
      blockedAt: u.blockedAt?.toISOString(),
      blockedReason: u.blockedReason ?? undefined,
      lastLoginAt: u.lastLoginAt?.toISOString(),
    };
  }

  async byPhone(phone: string) {
    return this.prisma.withContext(async (tx) => {
      const u = await tx.user.findFirst({ where: { tenantId: this.tenant(), phone }, include: { roles: true } });
      return u ? this.toRecord(u) : undefined;
    });
  }

  async byId(id: string) {
    return this.prisma.withContext(async (tx) => {
      const u = await tx.user.findFirst({ where: { tenantId: this.tenant(), id }, include: { roles: true } });
      return u ? this.toRecord(u) : undefined;
    });
  }

  async list() {
    return this.prisma.withContext(async (tx) => {
      const rows = await tx.user.findMany({ where: { tenantId: this.tenant() }, include: { roles: true } });
      return rows.map((u) => this.toRecord(u));
    });
  }

  async create(u: Omit<UserRecord, 'id'>) {
    const id = uuidv7();
    const tenantId = this.tenant();
    return this.prisma.withContext(async (tx) => {
      const created = await tx.user.create({
        data: {
          id,
          tenantId,
          phone: u.phone,
          fullName: u.fullName || null,
          roles: {
            create: u.roles.map((r) => ({ id: uuidv7(), tenantId, role: (TO_DB[r] ?? r) as never })),
          },
        },
        include: { roles: true },
      });
      return this.toRecord(created);
    });
  }

  async save(u: UserRecord) {
    const tenantId = this.tenant();
    await this.prisma.withContext(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: {
          fullName: u.fullName || null,
          isBlocked: Boolean(u.blockedAt),
          blockedAt: u.blockedAt ? new Date(u.blockedAt) : null,
          blockedReason: u.blockedReason ?? null,
          lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
        },
      });
      // Роли переписываем целиком: набор маленький, а вычислять разницу —
      // лишний код там, где ошибка означает потерянный или лишний доступ
      await tx.userRole.deleteMany({ where: { tenantId, userId: u.id } });
      for (const r of u.roles) {
        await tx.userRole.create({ data: { id: uuidv7(), tenantId, userId: u.id, role: (TO_DB[r] ?? r) as never } });
      }
    });
  }

  /**
   * Разовый перенос учётных записей и журнала входов (deploy/import-state).
   *
   * Идентификаторы сохраняются, а не выдаются заново: на пользователя
   * ссылаются роли, и перевыдача id превратила бы перенос в тихую потерю
   * доступов. Телефон уникален — повтор переноса ничего не задвоит.
   */
  async importFromState(raw: unknown): Promise<{ users: number; logins: number }> {
    const data = Array.isArray(raw)
      ? { users: raw as UserRecord[], logins: [] as LoginEventRec[] }
      : ((raw ?? {}) as { users?: UserRecord[]; logins?: LoginEventRec[] });
    const tenantId = this.tenant();
    const users = data.users ?? [];
    for (const u of users) {
      await this.prisma.withContext(async (tx) => {
        const existing = await tx.user.findFirst({ where: { tenantId, phone: u.phone } });
        const id = existing?.id ?? (isUuid(u.id) ? u.id : uuidv7());
        await tx.user.upsert({
          where: { id },
          create: {
            id,
            tenantId,
            phone: u.phone,
            fullName: u.fullName || null,
            isBlocked: Boolean(u.blockedAt),
            blockedAt: u.blockedAt ? new Date(u.blockedAt) : null,
            blockedReason: u.blockedReason ?? null,
            lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
          },
          update: { fullName: u.fullName || null },
        });
        await tx.userRole.deleteMany({ where: { tenantId, userId: id } });
        for (const r of u.roles ?? []) {
          await tx.userRole.create({ data: { id: uuidv7(), tenantId, userId: id, role: (TO_DB[r] ?? r) as never } });
        }
      });
    }
    const logins = data.logins ?? [];
    for (let i = 0; i < logins.length; i += 500) {
      const chunk = logins.slice(i, i + 500);
      await this.prisma.withContext(async (tx) => {
        await tx.loginEvent.createMany({
          data: chunk.map((e) => ({
            id: uuidv7(),
            tenantId,
            phone: e.phone,
            ok: e.ok,
            reason: e.reason ?? null,
            roles: e.roles,
            at: new Date(e.at),
          })),
        });
      });
    }
    return { users: users.length, logins: logins.length };
  }

  async trackLogin(e: Omit<LoginEventRec, 'id'>) {
    const tenantId = this.tenant();
    await this.prisma.withContext(async (tx) => {
      await tx.loginEvent.create({
        data: { id: uuidv7(), tenantId, phone: e.phone, ok: e.ok, reason: e.reason ?? null, roles: e.roles, at: new Date(e.at) },
      });
    });
  }

  async loginLog(limit: number) {
    return this.prisma.withContext(async (tx) => {
      const rows = await tx.loginEvent.findMany({
        where: { tenantId: this.tenant() },
        orderBy: { at: 'desc' },
        take: limit,
      });
      return rows.map((r): LoginEventRec => ({
        id: r.id,
        phone: r.phone,
        at: r.at.toISOString(),
        ok: r.ok,
        reason: r.reason ?? undefined,
        roles: r.roles,
      }));
    });
  }
}
