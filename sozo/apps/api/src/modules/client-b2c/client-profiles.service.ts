import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';

/**
 * Профиль клиента B2C: согласия, язык, сохранённые адреса, жалобы.
 *
 * Отдельно от `identity`: там учётная запись и роли, здесь — то, что клиент
 * сам про себя сообщил. Ключ — телефон: он же идентификатор входа.
 */

export interface ClientAddressRec {
  id: string;
  /** «Дом», «Дача» — как клиент назвал; пусто — показываем улицу */
  label?: string;
  street: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  intercom?: string;
  hasLift?: boolean;
  comment?: string;
  lat?: number;
  lng?: number;
  primary: boolean;
}

export interface ClientComplaintRec {
  id: string;
  type: string;
  text: string;
  orderId?: string;
  orderNumber?: string;
  photos: string[];
  status: 'new' | 'in_progress' | 'resolved' | 'closed';
  resolution?: string;
  createdAt: string;
  /**
   * Ссылка на запись в реестре качества — там жалоба живёт по-настоящему:
   * с SLA, ответственным и плейбуком резолюции. Здесь остаётся то, что
   * написал клиент, и статус подтягивается оттуда при чтении.
   */
  qualityId?: string;
}

export interface ClientProfileRec {
  phone: string;
  fullName: string;
  locale: 'ru' | 'uz';
  consents: { personalData: boolean; marketing: boolean; at?: string };
  addresses: ClientAddressRec[];
  complaints: ClientComplaintRec[];
  /**
   * Прочитанные уведомления. Сама лента выводится из данных, а отметку
   * «прочитано» выводить не из чего — только из действий пользователя.
   */
  readNotifications?: string[];
  /** Мастер, которого клиент попросил запомнить после оценки 4–5 (C-21) */
  favoriteMasterId?: string;
  favoriteMasterName?: string;
  /**
   * Чем человек обычно платит.
   *
   * Не «сохранённая карта» — карту без мерчанта сохранить нельзя, её токен
   * выдаёт Payme или Click после 3-D Secure. Здесь только память о выборе:
   * тыкать один и тот же способ в двадцатый раз — работа за пользователя.
   */
  preferredPaymentProvider?: 'payme' | 'click' | 'uzum' | 'card' | 'cash';
  /**
   * Промокоды, которые человек ввёл заранее.
   *
   * Раньше код можно было применить только в одном месте — на последнем шаге
   * оформления, — и услышав код в рекламе, его негде было сохранить: пока
   * дойдёшь до заявки, забудешь. Кошелёк хранит сам код, а скидка считается
   * заново при использовании: процент за месяц мог измениться, а код —
   * закончиться.
   */
  promoWallet?: { code: string; addedAt: string; usedAt?: string; orderNumber?: string }[];
}

@Injectable()
export class ClientProfilesService implements OnModuleInit {
  private readonly profiles = new Map<string, ClientProfileRec>();

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'clientProfiles',
      () => [...this.profiles.values()],
      (d) => {
        this.profiles.clear();
        for (const p of (d ?? []) as ClientProfileRec[]) this.profiles.set(p.phone, p);
      },
    );
    this.mirror = new PgMirror(prisma, 'ClientProfiles', {
      load: async (tx) => {
        const rows = await tx.clientProfile.findMany({
          include: { addresses: true, complaints: true, promoWallet: true, readNotifications: true },
        });
        if (!rows.length) return 0;
        this.profiles.clear();
        for (const r of rows) {
          this.profiles.set(r.phone, {
            phone: r.phone,
            fullName: r.fullName,
            locale: r.locale as ClientProfileRec['locale'],
            consents: {
              personalData: r.consentPersonalData,
              marketing: r.consentMarketing,
              at: r.consentAt?.toISOString(),
            },
            addresses: r.addresses.map((a) => ({
              id: a.id,
              label: a.label ?? undefined,
              street: a.street,
              apartment: a.apartment ?? undefined,
              entrance: a.entrance ?? undefined,
              floor: a.floor ?? undefined,
              intercom: a.intercom ?? undefined,
              hasLift: a.hasLift,
              comment: a.comment ?? undefined,
              lat: a.geoLat ?? undefined,
              lng: a.geoLng ?? undefined,
              primary: a.isPrimary,
            })),
            complaints: r.complaints.map((c) => ({
              id: c.id,
              type: c.type,
              text: c.text,
              orderId: c.orderId ?? undefined,
              orderNumber: c.orderNumber ?? undefined,
              photos: c.photoIds,
              status: c.status as ClientComplaintRec['status'],
              resolution: c.resolution ?? undefined,
              createdAt: c.createdAt.toISOString(),
              qualityId: c.qualityId ?? undefined,
            })),
            readNotifications: r.readNotifications.map((n) => n.notificationId),
            favoriteMasterId: r.favoriteMasterId ?? undefined,
            favoriteMasterName: r.favoriteMasterName ?? undefined,
            preferredPaymentProvider: (r.preferredPaymentProvider ?? undefined) as ClientProfileRec['preferredPaymentProvider'],
            promoWallet: r.promoWallet.map((w) => ({
              code: w.code,
              addedAt: w.addedAt.toISOString(),
              usedAt: w.usedAt?.toISOString(),
              orderNumber: w.orderNumber ?? undefined,
            })),
          });
        }
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const p of this.profiles.values()) {
          const data = {
            fullName: p.fullName,
            locale: p.locale,
            consentPersonalData: p.consents.personalData,
            consentMarketing: p.consents.marketing,
            // CHECK в m25: согласие без даты в споре с регулятором стоит
            // столько же, сколько его отсутствие
            consentAt:
              p.consents.personalData || p.consents.marketing
                ? new Date(p.consents.at ?? new Date().toISOString())
                : null,
            favoriteMasterId: p.favoriteMasterId ?? null,
            favoriteMasterName: p.favoriteMasterName ?? null,
            preferredPaymentProvider: p.preferredPaymentProvider ?? null,
          };
          await tx.clientProfile.upsert({
            where: { tenantId_phone: { tenantId, phone: p.phone } },
            create: { tenantId, phone: p.phone, ...data },
            update: data,
          });

          // Дочерние наборы переписываются целиком: адресов у человека
          // единицы, а вычислять разницу здесь — лишний код там, где ошибка
          // означает потерянный адрес
          await tx.clientAddress.deleteMany({ where: { tenantId, clientPhone: p.phone } });
          for (const a of p.addresses) {
            await tx.clientAddress.create({
              data: {
                id: a.id, tenantId, clientPhone: p.phone, label: a.label ?? null, street: a.street,
                apartment: a.apartment ?? null, entrance: a.entrance ?? null, floor: a.floor ?? null,
                intercom: a.intercom ?? null, hasLift: Boolean(a.hasLift), comment: a.comment ?? null,
                geoLat: a.lat ?? null, geoLng: a.lng ?? null, isPrimary: a.primary,
              },
            });
          }
          for (const c of p.complaints) {
            const cd = {
              type: c.type, text: c.text, orderId: c.orderId ?? null, orderNumber: c.orderNumber ?? null,
              photoIds: c.photos, status: c.status, resolution: c.resolution ?? null,
              qualityId: c.qualityId ?? null,
            };
            await tx.clientComplaint.upsert({
              where: { id: c.id },
              create: { id: c.id, tenantId, clientPhone: p.phone, createdAt: new Date(c.createdAt), ...cd },
              update: cd,
            });
          }
          for (const w of p.promoWallet ?? []) {
            const wd = {
              addedAt: new Date(w.addedAt),
              usedAt: w.usedAt ? new Date(w.usedAt) : null,
              orderNumber: w.orderNumber ?? null,
            };
            await tx.clientPromoWallet.upsert({
              where: { tenantId_clientPhone_code: { tenantId, clientPhone: p.phone, code: w.code } },
              create: { id: uuidv7(), tenantId, clientPhone: p.phone, code: w.code, ...wd },
              update: wd,
            });
          }
          for (const id of p.readNotifications ?? []) {
            await tx.clientReadNotification.upsert({
              where: { tenantId_clientPhone_notificationId: { tenantId, clientPhone: p.phone, notificationId: id } },
              create: { tenantId, clientPhone: p.phone, notificationId: id },
              update: {},
            });
          }
        }
      },
    });
    this.store.registerMirror(this.mirror);
  }

  onModuleInit(): Promise<void> {
    return this.mirror.init();
  }

  /** Разовый перенос state.json (deploy/import-state) */
  flushToDb(): Promise<void> {
    return this.mirror.flush();
  }

  /** Все профили — для админского реестра; порядок не важен, ключ у всех разный */
  all(): ClientProfileRec[] {
    return [...this.profiles.values()];
  }

  /** Профиль создаётся при первом обращении: отдельной регистрации у клиента нет */
  get(phone: string): ClientProfileRec {
    const existing = this.profiles.get(phone);
    if (existing) return existing;
    const rec: ClientProfileRec = {
      phone,
      fullName: '',
      locale: 'ru',
      consents: { personalData: false, marketing: false },
      addresses: [],
      complaints: [],
    };
    this.profiles.set(phone, rec);
    this.store.persist();
    return rec;
  }

  setConsents(phone: string, b: { personalData?: boolean; marketing?: boolean; locale?: string; fullName?: string }): ClientProfileRec {
    const p = this.get(phone);
    if (b.personalData === false && p.consents.personalData) {
      // Отзыв согласия на обработку — не переключатель в приложении:
      // он останавливает обслуживание и делается через поддержку (ТЗ 14)
      throw new BadRequestException({
        code: 'CONSENT_WITHDRAWAL_VIA_SUPPORT',
        message: 'Отозвать согласие на обработку данных можно только через поддержку',
      });
    }
    if (b.personalData === true && !p.consents.personalData) {
      p.consents.personalData = true;
      p.consents.at = new Date().toISOString();
    }
    if (typeof b.marketing === 'boolean') p.consents.marketing = b.marketing;
    if (b.locale === 'ru' || b.locale === 'uz') p.locale = b.locale;
    if (b.fullName?.trim()) p.fullName = b.fullName.trim();
    this.store.persist();
    return p;
  }

  // ---------- Адреса (C-29) ----------

  addresses(phone: string): ClientAddressRec[] {
    return this.get(phone).addresses;
  }

  saveAddress(phone: string, b: Partial<ClientAddressRec> & { street?: string }): ClientAddressRec {
    const p = this.get(phone);
    const street = b.street?.trim();
    if (!street) throw new BadRequestException({ code: 'STREET_REQUIRED', message: 'Укажите улицу и дом' });

    const existing = b.id ? p.addresses.find((a) => a.id === b.id) : undefined;
    const rec: ClientAddressRec = {
      id: existing?.id ?? uuidv7(),
      label: b.label?.trim() || existing?.label,
      street,
      apartment: b.apartment?.trim() ?? existing?.apartment,
      entrance: b.entrance?.trim() ?? existing?.entrance,
      floor: b.floor?.trim() ?? existing?.floor,
      intercom: b.intercom?.trim() ?? existing?.intercom,
      hasLift: b.hasLift ?? existing?.hasLift,
      comment: b.comment?.trim() ?? existing?.comment,
      lat: b.lat ?? existing?.lat,
      lng: b.lng ?? existing?.lng,
      // Первый адрес всегда основной: иначе новая заявка не знает, что подставить
      primary: b.primary ?? existing?.primary ?? p.addresses.length === 0,
    };
    if (rec.primary) for (const a of p.addresses) if (a.id !== rec.id) a.primary = false;

    if (existing) Object.assign(existing, rec);
    else p.addresses.push(rec);
    this.store.persist();
    return rec;
  }

  deleteAddress(phone: string, id: string): void {
    const p = this.get(phone);
    const i = p.addresses.findIndex((a) => a.id === id);
    if (i < 0) throw new BadRequestException({ code: 'ADDRESS_NOT_FOUND', message: 'Адрес не найден' });
    const [removed] = p.addresses.splice(i, 1);
    // Удалили основной — основным становится следующий, а не «никакой»
    if (removed.primary && p.addresses.length) p.addresses[0].primary = true;
    this.store.persist();
  }

  // ---------- Жалобы (C-23) ----------

  complaints(phone: string): ClientComplaintRec[] {
    return [...this.get(phone).complaints].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  fileComplaint(phone: string, b: { type?: string; text?: string; orderId?: string; orderNumber?: string; photos?: string[] }): ClientComplaintRec {
    const text = b.text?.trim();
    if (!b.type) throw new BadRequestException({ code: 'TYPE_REQUIRED', message: 'Выберите тип жалобы' });
    if (!text || text.length < 10) {
      throw new BadRequestException({ code: 'TEXT_TOO_SHORT', message: 'Опишите, что случилось — хотя бы пару предложений' });
    }
    const p = this.get(phone);
    const rec: ClientComplaintRec = {
      id: uuidv7(),
      type: b.type,
      text,
      orderId: b.orderId,
      orderNumber: b.orderNumber,
      photos: b.photos ?? [],
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    p.complaints.push(rec);
    this.store.persist();
    return rec;
  }

  /** Сохранить изменения, сделанные снаружи (отметки уведомлений) */
  touch(): void {
    this.store.persist();
  }

  setFavoriteMaster(phone: string, masterId?: string, masterName?: string): void {
    const p = this.get(phone);
    p.favoriteMasterId = masterId;
    p.favoriteMasterName = masterName;
    this.store.persist();
  }

  /**
   * Запомнить способ оплаты. Пустое значение стирает предпочтение — человек
   * вправе передумать и снова выбирать каждый раз.
   */
  /** Положить код в кошелёк. Повторный ввод того же кода — не ошибка, а «уже есть» */
  addPromo(phone: string, code: string): ClientProfileRec {
    const p = this.get(phone);
    p.promoWallet ??= [];
    const up = code.trim().toUpperCase();
    if (!p.promoWallet.some((w) => w.code === up)) {
      p.promoWallet.unshift({ code: up, addedAt: new Date().toISOString() });
      this.store.persist();
    }
    return p;
  }

  removePromo(phone: string, code: string): ClientProfileRec {
    const p = this.get(phone);
    const up = code.trim().toUpperCase();
    // Использованный не выбрасываем: это история скидок, а не мусор
    p.promoWallet = (p.promoWallet ?? []).filter((w) => w.code !== up || w.usedAt);
    this.store.persist();
    return p;
  }

  /** Отметить код израсходованным — вместе с заявкой, на которой он сработал */
  markPromoUsed(phone: string, code: string, orderNumber: string): void {
    const p = this.get(phone);
    const up = code.trim().toUpperCase();
    p.promoWallet ??= [];
    const found = p.promoWallet.find((w) => w.code === up);
    if (found) {
      found.usedAt = new Date().toISOString();
      found.orderNumber = orderNumber;
    } else {
      p.promoWallet.unshift({ code: up, addedAt: new Date().toISOString(), usedAt: new Date().toISOString(), orderNumber });
    }
    this.store.persist();
  }

  setPreferredPayment(phone: string, provider?: string): ClientProfileRec {
    const allowed = ['payme', 'click', 'uzum', 'card', 'cash'];
    if (provider && !allowed.includes(provider)) {
      throw new BadRequestException({ code: 'PROVIDER_INVALID', message: 'Неизвестный способ оплаты' });
    }
    const p = this.get(phone);
    p.preferredPaymentProvider = (provider || undefined) as ClientProfileRec['preferredPaymentProvider'];
    this.store.persist();
    return p;
  }
}
