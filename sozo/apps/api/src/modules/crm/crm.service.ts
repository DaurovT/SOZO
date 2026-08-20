import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';

export interface ContractTerms {
  /** Пороги утверждений 1–3 уровня (ТЗ 5.2): пример — рук. точки 1 млн, рук. организации 5 млн, свыше — двойное */
  approvalThresholds: Array<{ role: string; limitTiyin: number | null }>;
  slaEmergencyMin: [number, number]; // день / ночь (ТЗ 18-п.2)
  carryoverPercent: number; // перенос остатка абонентки, 0 = не переносится
  loyaltyEnabled: boolean; // программа баллов персонала — только с согласия организации (ТЗ 17.14)
  penaltyEnabled: boolean; // пени 0.1%/день, потолок 10% (по умолч. выкл)
  showMoneyToEmployees: boolean;
  materialsSeparateInvoice: boolean;
}

export interface OrganizationRec {
  id: string;
  name: string;
  inn: string;
  vatPayer: boolean;
  contractType: 'subscription' | 'one_off';
  contractKind: 'annual' | 'monthly'; // годовой — цены заморожены; месячный — перевод на текущий релиз при продлении
  subscriptionTiyin: number | null;
  status: 'active' | 'suspended' | 'terminated';
  terms: ContractTerms;
  /**
   * Релиз прайса, замороженный по годовому договору (ТЗ 3.7).
   *
   * `contractKind: 'annual'` обещает клиенту неизменные цены на срок договора.
   * До этого поля обещание было текстом на экране: выходил новый релиз, и
   * заявки годовых договоров считались по нему. Заполняется при первой заявке
   * организации — тем релизом, который действует на этот момент.
   */
  priceReleaseIdFrozen?: string;
  terminationNote?: string;
  locations: LocationRec[];
  createdAt: string;
}

export const DEFAULT_TERMS: ContractTerms = {
  approvalThresholds: [
    { role: 'Руководитель точки', limitTiyin: 100_000_000 },
    { role: 'Руководитель организации', limitTiyin: 500_000_000 },
    { role: 'Свыше — двойное утверждение с владельцем', limitTiyin: null },
  ],
  slaEmergencyMin: [60, 120],
  carryoverPercent: 0,
  loyaltyEnabled: false,
  penaltyEnabled: false,
  showMoneyToEmployees: false,
  materialsSeparateInvoice: false,
};

export interface LocationPassport {
  areaM2: number | null; // паспорт объекта (A-09) — источник точного расчёта абонентки
  bathrooms: number | null;
  acUnits: number | null;
  electricPanels: number | null;
  objectType: string | null;
}

export interface LocationAccess {
  schedule: string | null; // график доступа (учитывается планировщиком)
  accessNotes: string | null; // пропускной режим, шлагбаум, техническое окно
  hoaContact: string | null; // контакт ТСЖ/УК — для «Заблокировано третьей стороной»
  /**
   * Где перекрыть при аварии. Экран «Авария» в приложении читал эти поля
   * с самого начала, но в типе их не было и в админке негде было завести —
   * подсказки всегда оставались пустыми.
   *
   * Формулировка свободная и человеческая: «в подсобке за стеллажом справа».
   * Координаты и схемы здесь не нужны — их читают в панике, на телефоне.
   */
  waterShutoff: string | null;
  electricalPanel: string | null;
  gasValve: string | null;
}

/**
 * Ответственный на точке — тот, кто в клиентском приложении подписывает акты
 * осмотра и принимает работы. Телефон здесь — это же и логин приложения:
 * отдельного реестра клиентских пользователей не заводим, точка сама называет
 * своих людей (ТЗ 5.2 — уровни утверждения привязаны к ролям, а не к штату SOZO).
 */
export interface RepresentativeRec {
  id: string;
  fullName: string;
  phone: string; // +998XXXXXXXXX
  role: string; // «Руководитель точки», «Завхоз» — из approvalThresholds договора
  /**
   * Должность — как человек называется у себя в организации.
   *
   * Отдельно от `role` намеренно. `role` — это уровень утверждения из договора,
   * и он диктует потолок; должность к деньгам отношения не имеет. Пока их
   * держали одним полем, два завхоза с разными лимитами не описывались вообще:
   * чтобы дать одному больший потолок, приходилось выдумывать ему должность.
   */
  position?: string;
  /** Потолок утверждения; null — без лимита (уровень организации) */
  approvalLimitTiyin: number | null;
  /** Главный на точке: ему по умолчанию уходят акты и запросы приёмки */
  primary: boolean;
}

/** Срок жизни приглашения: неделя — столько живёт «зайди оформись» в переписке */
const INVITE_TTL_DAYS = 7;

export interface InviteRec {
  id: string;
  /** Шесть символов без похожих: код диктуют голосом */
  code: string;
  organizationId: string;
  locationId: string;
  fullName: string;
  role: string;
  position?: string;
  approvalLimitTiyin: number | null;
  primary: boolean;
  createdByPhone: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedByPhone?: string;
  revokedAt?: string;
}

export interface LocationRec {
  id: string;
  name: string;
  address: string;
  lat: number | null; // гео-пин точки (A-09); геокодер Yandex/Google — PRD-05 §12.4
  lng: number | null;
  orderLimitTiyin: number | null;
  monthlyLimitTiyin: number | null;
  photoForbidden: boolean;
  passport: LocationPassport;
  access: LocationAccess;
  preferredMasterId: string | null; // закреплённый мастер — мягкий приоритет распределения
  blacklistMasterIds: string[]; // чёрный список мастеров точки (ТЗ 3.2)
  representatives: RepresentativeRec[];
}

/** crm (DEV-07 §2 п.6): организации, точки, договоры — A-06/A-07/A-09 */
@Injectable()
export class CrmService {
  private readonly orgs: OrganizationRec[] = [];
  private readonly invites: InviteRec[] = [];

  constructor(private readonly store: StateStore) {
    // Демо-организация для разработки (is_demo-контур — вне биллинга и отчётов)
    this.create({
      name: 'Демо-сеть аптек «Шифо»',
      inn: '300000001',
      vatPayer: true,
      contractType: 'subscription',
      contractKind: 'annual',
      subscriptionTiyin: 300_000_000, // тариф «Стандарт» 3 000 000 сум
    });
    const org = this.orgs[0];
    const emptyPassport = (): LocationPassport => ({ areaM2: null, bathrooms: null, acUnits: null, electricPanels: null, objectType: null });
    const emptyAccess = (): LocationAccess => ({ schedule: null, accessNotes: null, hoaContact: null, waterShutoff: null, electricalPanel: null, gasValve: null });
    org.locations.push(
      {
        id: uuidv7(), name: 'Аптека Чиланзар', address: 'Ташкент, Чиланзар-9', lat: 41.2755, lng: 69.2037,
        orderLimitTiyin: 100_000_000, monthlyLimitTiyin: 500_000_000, photoForbidden: false,
        passport: { areaM2: 85, bathrooms: 1, acUnits: 3, electricPanels: 1, objectType: 'Аптека / магазин' },
        access: {
          schedule: 'пн–вс 08:00–22:00',
          accessNotes: 'вход со двора, ключ у администратора',
          hoaContact: 'УК «Чиланзар-сервис» +998712001122',
          waterShutoff: 'кран в подсобке, за стеллажом справа',
          electricalPanel: 'щиток у входа со двора, ключ у администратора',
          gasValve: null,
        },
        preferredMasterId: null, blacklistMasterIds: [],
        representatives: [
          { id: uuidv7(), fullName: 'Азиза Каримова', phone: '+998901112233', role: 'Руководитель точки', approvalLimitTiyin: 100_000_000, primary: true },
        ],
      },
      {
        id: uuidv7(), name: 'Аптека Юнусабад', address: 'Ташкент, Юнусабад-4', lat: 41.3645, lng: 69.2871,
        orderLimitTiyin: 100_000_000, monthlyLimitTiyin: 500_000_000, photoForbidden: false,
        passport: emptyPassport(), access: emptyAccess(), preferredMasterId: null, blacklistMasterIds: [],
        representatives: [
          { id: uuidv7(), fullName: 'Бахтиёр Юлдашев', phone: '+998901112244', role: 'Руководитель точки', approvalLimitTiyin: 100_000_000, primary: true },
        ],
      },
    );
    this.store.register(
      'crm',
      () => this.orgs,
      (d) => {
        this.orgs.length = 0;
        this.orgs.push(...(d as OrganizationRec[]));
      },
    );
    this.store.register(
      'crmInvites',
      () => this.invites,
      (d) => {
        this.invites.length = 0;
        this.invites.push(...((d ?? []) as InviteRec[]));
        this.normalizePrimaries();
      },
    );
  }

  /**
   * Главный на точке ровно один — приводим к этому уже сохранённые данные.
   *
   * От признака `primary` зависит роль (`roleOf`) и право приглашать людей.
   * В базе накопились точки с пятью «основными» и точки без единого: правило
   * соблюдалось при записи через API, но не при прогонах демо-данных. Чинить
   * только запись мало — сломанное состояние уже лежит на диске.
   */
  private normalizePrimaries(): void {
    let changed = false;
    for (const org of this.orgs) {
      for (const loc of org.locations ?? []) {
        const reps = loc.representatives ?? [];
        if (!reps.length) continue;
        const primaries = reps.filter((r) => r.primary);
        if (primaries.length === 1) continue;
        // Из нескольких оставляем первого: порядок в списке — порядок заведения,
        // и первый заведённый ответственный ближе всего к смыслу «главный»
        const keep = primaries[0] ?? reps[0];
        for (const r of reps) r.primary = r === keep;
        changed = true;
      }
    }
    if (changed) this.store.persist();
  }

  /**
   * Кому потолок утверждения не совпадает с порогом его роли по договору.
   *
   * Сравниваем по названию роли: именно так порог и записан в условиях.
   * Роли, которой нет в договоре («Завхоз»), пропускаем — по ней порога нет,
   * и придумывать его за владельца не надо.
   */
  thresholdMismatches(orgId: string): Array<{
    locationId: string;
    locationName: string;
    repId: string;
    fullName: string;
    role: string;
    currentTiyin: number | null;
    contractTiyin: number | null;
  }> {
    const org = this.get(orgId);
    const out = [];
    for (const loc of org.locations) {
      for (const rep of loc.representatives ?? []) {
        // Пустой потолок — не «лимит не заполнен», а уровень организации:
        // такой человек утверждает без ограничения и видит финансы сети.
        // Подставить ему число из порога значит молча понизить его в правах —
        // ровно тот случай, когда «привести в соответствие» ломает договор
        if (rep.approvalLimitTiyin === null) continue;
        const t = org.terms.approvalThresholds.find((x) => x.role.toLowerCase() === rep.role.toLowerCase());
        if (!t) continue;
        if (t.limitTiyin === rep.approvalLimitTiyin) continue;
        out.push({
          locationId: loc.id,
          locationName: loc.name,
          repId: rep.id,
          fullName: rep.fullName,
          role: rep.role,
          currentTiyin: rep.approvalLimitTiyin,
          contractTiyin: t.limitTiyin,
        });
      }
    }
    return out;
  }

  /** Применить пороги договора к людям — по явной команде, не автоматически */
  applyThresholds(orgId: string): ReturnType<CrmService['thresholdMismatches']> {
    const org = this.get(orgId);
    const mismatches = this.thresholdMismatches(orgId);
    for (const m of mismatches) {
      const loc = org.locations.find((l) => l.id === m.locationId);
      const rep = loc?.representatives?.find((r) => r.id === m.repId);
      if (rep) rep.approvalLimitTiyin = m.contractTiyin;
    }
    if (mismatches.length) this.store.persist();
    return mismatches;
  }

  /** Сохранить изменения, сделанные снаружи (заморозка релиза по годовому договору) */
  touch(): void {
    this.store.persist();
  }

  /**
   * Все точки с их паспортами и контактами — нужен контуру «Дом» для сверки
   * заявки на подключение объекта с контактом ТСЖ/УК, который мастера
   * накопили при первых осмотрах (A-09). Эти данные старше любой заявки.
   */
  allLocations(): Array<LocationRec & { orgId: string; orgName: string }> {
    return this.orgs.flatMap((o) =>
      (o.locations ?? []).map((l) => ({ ...l, orgId: o.id, orgName: o.name })),
    );
  }

  list(): Array<Omit<OrganizationRec, 'locations'> & { locationsCount: number }> {
    return this.orgs.map(({ locations, ...o }) => ({ ...o, locationsCount: locations.length }));
  }

  get(id: string): OrganizationRec {
    const o = this.orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return o;
  }

  create(data: Pick<OrganizationRec, 'name' | 'inn' | 'vatPayer' | 'contractType' | 'contractKind' | 'subscriptionTiyin'>): OrganizationRec {
    const org: OrganizationRec = {
      id: uuidv7(),
      ...data,
      status: 'active',
      terms: structuredClone(DEFAULT_TERMS),
      locations: [],
      createdAt: new Date().toISOString(),
    };
    this.orgs.push(org);
    this.store.persist();
    return org;
  }

  updateTerms(id: string, patch: Partial<ContractTerms>): OrganizationRec {
    const org = this.get(id);
    Object.assign(org.terms, patch);
    this.store.persist();
    return org;
  }

  /** Расторжение (ТЗ 18-п.6): остаток — зачёт работами 60 дней, затем сгорает; закрытие остатка — проводка с двойным подтверждением */
  terminate(id: string): OrganizationRec {
    const org = this.get(id);
    org.status = 'terminated';
    org.terminationNote = 'Остаток абонентки: зачёт работами 60 дней, далее сгорает (ТЗ 18-п.6). Закрытие остатка — ручная проводка A-15 с двойным подтверждением.';
    return org;
  }

  update(id: string, patch: Partial<Pick<OrganizationRec, 'name' | 'vatPayer' | 'subscriptionTiyin' | 'status' | 'contractKind'>>): OrganizationRec {
    const org = this.get(id);
    Object.assign(org, patch);
    this.store.persist();
    return org;
  }

  addLocation(orgId: string, data: Omit<LocationRec, 'id' | 'passport' | 'access' | 'preferredMasterId' | 'blacklistMasterIds' | 'representatives'>): LocationRec {
    const org = this.get(orgId);
    const loc: LocationRec = {
      id: uuidv7(),
      ...data,
      passport: { areaM2: null, bathrooms: null, acUnits: null, electricPanels: null, objectType: null },
      access: { schedule: null, accessNotes: null, hoaContact: null, waterShutoff: null, electricalPanel: null, gasValve: null },
      preferredMasterId: null,
      blacklistMasterIds: [],
      representatives: [],
    };
    org.locations.push(loc);
    this.store.persist();
    return loc;
  }

  /** A-09: паспорт объекта, доступ, закреплённый мастер, чёрный список */
  updateLocation(orgId: string, locId: string, patch: Partial<Pick<LocationRec, 'passport' | 'access' | 'preferredMasterId' | 'blacklistMasterIds' | 'orderLimitTiyin' | 'monthlyLimitTiyin' | 'photoForbidden'>>): LocationRec {
    const org = this.get(orgId);
    const loc = org.locations.find((l) => l.id === locId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    if (patch.passport) Object.assign(loc.passport, patch.passport);
    if (patch.access) Object.assign(loc.access, patch.access);
    if (patch.preferredMasterId !== undefined) loc.preferredMasterId = patch.preferredMasterId;
    if (patch.blacklistMasterIds) loc.blacklistMasterIds = patch.blacklistMasterIds;
    if (patch.orderLimitTiyin !== undefined) loc.orderLimitTiyin = patch.orderLimitTiyin;
    if (patch.monthlyLimitTiyin !== undefined) loc.monthlyLimitTiyin = patch.monthlyLimitTiyin;
    if (patch.photoForbidden !== undefined) loc.photoForbidden = patch.photoForbidden;
    // Старые записи в state.json заведены до появления ответственных
    loc.representatives ??= [];
    this.store.persist();
    return loc;
  }

  // ---------- Ответственные на точках (клиентский контур B2B) ----------

  /** Точка вместе с организацией — по id точки; нужен и мастеру, и клиентскому приложению */
  findLocation(locationId: string): { org: OrganizationRec; loc: LocationRec } | null {
    for (const org of this.orgs) {
      const loc = org.locations.find((l) => l.id === locationId);
      if (loc) {
        loc.representatives ??= [];
        return { org, loc };
      }
    }
    return null;
  }

  /**
   * Все точки, где этот телефон значится ответственным. Пустой список = номер
   * не привязан ни к одной точке, и клиентскому приложению показывать нечего.
   */
  locationsForPhone(phone: string): Array<{ org: OrganizationRec; loc: LocationRec; rep: RepresentativeRec }> {
    const out: Array<{ org: OrganizationRec; loc: LocationRec; rep: RepresentativeRec }> = [];
    for (const org of this.orgs) {
      for (const loc of org.locations) {
        const rep = (loc.representatives ?? []).find((r) => r.phone === phone);
        if (rep) out.push({ org, loc, rep });
      }
    }
    return out;
  }

  // ---------- Приглашения в команду (руководитель заводит своих сам) ----------

  /**
   * Приглашение — единственный способ для организации пополнить команду без
   * обращения в поддержку.
   *
   * До этого ответственных заводил только админ SOZO: сеть из сорока аптек
   * держала на нём каждого нового завхоза. Приглашение переносит эту работу
   * туда, где знают людей — и не требует, чтобы руководитель знал систему:
   * он выдаёт код, человек вводит его при входе и оказывается на своей точке.
   *
   * Код одноразовый и с сроком: приглашение, живущее вечно, рано или поздно
   * пересылают дальше по переписке.
   */
  issueInvite(
    byPhone: string,
    data: { locationId: string; fullName?: string; role: string; position?: string; approvalLimitTiyin: number | null; primary?: boolean },
  ): InviteRec {
    const found = this.findLocation(data.locationId);
    if (!found) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    // Ролей в одной организации у человека бывает несколько: на одной точке
    // он провизор, на другой — руководитель. Брать первую попавшуюся нельзя:
    // руководителю организации отказали бы правами сотрудника с соседней точки
    const mine = this.locationsForPhone(byPhone).filter((s) => s.org.id === found.org.id);
    if (!mine.length) throw new ForbiddenException({ code: 'NOT_IN_ORGANIZATION', message: 'Вы не в этой организации' });

    const iAmOrgManager = mine.some((s) => s.rep.approvalLimitTiyin === null);
    if (!iAmOrgManager) {
      // Ответственный точки зовёт только к себе и только с потолком не выше
      // своего: иначе приглашением можно выписать себе повышение
      const atTarget = mine.find((s) => s.loc.id === data.locationId);
      if (!atTarget?.rep.primary) {
        throw new ForbiddenException({ code: 'NOT_ALLOWED', message: 'Приглашать можно только на свою точку' });
      }
      if (data.approvalLimitTiyin === null || data.approvalLimitTiyin > (atTarget.rep.approvalLimitTiyin ?? 0)) {
        throw new ForbiddenException({
          code: 'LIMIT_TOO_HIGH',
          message: 'Потолок приглашённого не может быть выше вашего',
        });
      }
    }

    const rec: InviteRec = {
      id: uuidv7(),
      code: this.newInviteCode(),
      organizationId: found.org.id,
      locationId: data.locationId,
      fullName: data.fullName?.trim() || '',
      role: data.role?.trim() || 'Сотрудник',
      position: data.position?.trim() || undefined,
      approvalLimitTiyin: data.approvalLimitTiyin,
      primary: data.primary ?? false,
      createdByPhone: byPhone,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    };
    this.invites.push(rec);
    this.store.persist();
    return rec;
  }

  invitesOfOrg(orgId: string): InviteRec[] {
    return this.invites.filter((i) => i.organizationId === orgId).slice().reverse();
  }

  invitesForPhone(phone: string): InviteRec[] {
    const orgIds = new Set(this.locationsForPhone(phone).map((s) => s.org.id));
    return this.invites.filter((i) => orgIds.has(i.organizationId)).slice().reverse();
  }

  revokeInvite(byPhone: string, inviteId: string): InviteRec {
    const inv = this.invites.find((i) => i.id === inviteId);
    if (!inv) throw new NotFoundException({ code: 'INVITE_NOT_FOUND' });
    const me = this.locationsForPhone(byPhone).find((s) => s.org.id === inv.organizationId);
    if (!me) throw new ForbiddenException({ code: 'NOT_IN_ORGANIZATION' });
    if (inv.usedAt) throw new BadRequestException({ code: 'INVITE_USED', message: 'Приглашение уже принято' });
    inv.revokedAt = new Date().toISOString();
    this.store.persist();
    return inv;
  }

  /** Принять приглашение: телефон входящего становится ответственным на точке */
  acceptInvite(phone: string, code: string, fullName?: string): { organization: string; location: string; role: string } {
    const inv = this.invites.find((i) => i.code === code.trim().toUpperCase());
    if (!inv) throw new NotFoundException({ code: 'INVITE_NOT_FOUND', message: 'Код не найден — проверьте написание' });
    if (inv.revokedAt) throw new BadRequestException({ code: 'INVITE_REVOKED', message: 'Приглашение отозвано' });
    if (inv.usedAt) throw new BadRequestException({ code: 'INVITE_USED', message: 'Приглашение уже использовано' });
    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException({ code: 'INVITE_EXPIRED', message: 'Срок приглашения истёк — попросите новый код' });
    }
    const found = this.findLocation(inv.locationId);
    if (!found) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });

    const rep = this.addRepresentative(found.org.id, inv.locationId, {
      // Имя из приглашения — подсказка руководителя; своё человек уже назвал сам
      fullName: fullName?.trim() || inv.fullName || '',
      phone,
      role: inv.role,
      position: inv.position,
      approvalLimitTiyin: inv.approvalLimitTiyin,
      primary: inv.primary,
    });
    inv.usedAt = new Date().toISOString();
    inv.usedByPhone = phone;
    this.store.persist();
    return { organization: found.org.name, location: found.loc.name, role: rep.role };
  }

  private newInviteCode(): string {
    // Без похожих символов: код диктуют голосом и переписывают с экрана
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = '';
      for (let i = 0; i < 6; i += 1) code += abc[Math.floor(Math.random() * abc.length)];
      if (!this.invites.some((i) => i.code === code)) return code;
    }
    throw new BadRequestException({ code: 'CODE_GENERATION_FAILED' });
  }

  /** Кому по умолчанию уходит акт: главный на точке, иначе первый в списке */
  primaryRepresentative(locationId: string): RepresentativeRec | null {
    const found = this.findLocation(locationId);
    if (!found) return null;
    const reps = found.loc.representatives ?? [];
    return reps.find((r) => r.primary) ?? reps[0] ?? null;
  }

  addRepresentative(orgId: string, locId: string, data: Omit<RepresentativeRec, 'id'>): RepresentativeRec {
    const org = this.get(orgId);
    const loc = org.locations.find((l) => l.id === locId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    if (!/^\+998\d{9}$/.test(data.phone)) {
      throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Телефон ответственного: +998XXXXXXXXX' });
    }
    loc.representatives ??= [];
    if (loc.representatives.some((r) => r.phone === data.phone)) {
      throw new BadRequestException({ code: 'REPRESENTATIVE_EXISTS', message: 'Этот номер уже закреплён за точкой' });
    }
    const rep: RepresentativeRec = { id: uuidv7(), ...data };
    // Главный на точке ровно один: назначение нового снимает флаг с прежнего
    if (rep.primary) loc.representatives.forEach((r) => (r.primary = false));
    if (loc.representatives.length === 0) rep.primary = true;
    loc.representatives.push(rep);
    this.store.persist();
    return rep;
  }

  /**
   * Правка ответственного: роль, потолок утверждения, назначение главным.
   * Телефон не меняем — это идентификатор входа; другой человек заводится
   * отдельной записью, чтобы в аудите было видно, кто и когда подписывал.
   */
  updateRepresentative(
    orgId: string,
    locId: string,
    repId: string,
    patch: Partial<Omit<RepresentativeRec, 'id' | 'phone'>>,
  ): RepresentativeRec {
    const org = this.get(orgId);
    const loc = org.locations.find((l) => l.id === locId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    const rep = (loc.representatives ?? []).find((r) => r.id === repId);
    if (!rep) throw new NotFoundException({ code: 'REPRESENTATIVE_NOT_FOUND' });
    if (patch.fullName?.trim()) rep.fullName = patch.fullName.trim();
    if (patch.role?.trim()) rep.role = patch.role.trim();
    if (patch.approvalLimitTiyin !== undefined) rep.approvalLimitTiyin = patch.approvalLimitTiyin;
    if (patch.primary === true) loc.representatives.forEach((r) => (r.primary = r.id === repId));
    this.store.persist();
    return rep;
  }

  removeRepresentative(orgId: string, locId: string, repId: string): { removed: boolean } {
    const org = this.get(orgId);
    const loc = org.locations.find((l) => l.id === locId);
    if (!loc) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
    loc.representatives ??= [];
    const idx = loc.representatives.findIndex((r) => r.id === repId);
    if (idx < 0) return { removed: false };
    const [gone] = loc.representatives.splice(idx, 1);
    // Точка без главного осталась бы без адресата актов — назначаем первого
    if (gone.primary && loc.representatives.length > 0) loc.representatives[0].primary = true;
    this.store.persist();
    return { removed: true };
  }
}
