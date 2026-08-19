import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { tr, trValue } from '../../common/locale';

/**
 * Лента уведомлений мастера (PRD-02 §7, матрица из 27 событий).
 *
 * Здесь события оседают и живут историей. Доставка push — отдельный слой:
 * без неё лента работает, но мастер узнаёт о событии, только открыв приложение.
 * Deep-link хранится сразу — когда появится FCM, он поедет в payload без переделки.
 */

export type NotificationKind =
  | 'offer'
  | 'offer_expired'
  | 'order_changed'
  | 'departure_reminder'
  | 'addwork_resolved'
  | 'upsell_answered'
  | 'spare_tier_chosen'
  | 'payment'
  | 'tips'
  | 'cash_debt'
  | 'payout'
  | 'rating_changed'
  | 'complaint'
  | 'appeal_resolved'
  | 'skill_suspended'
  | 'tomorrow_ready'
  | 'onboarding'
  | 'system';

/** Приоритет определяет поведение push, когда он появится (PRD-02 §7) */
export type NotificationPriority = 'heads_up' | 'high' | 'normal';

export interface NotificationRec {
  id: string;
  masterId: string;
  kind: NotificationKind;
  title: string;
  /**
   * Русский текст, при необходимости с подстановками `{0}`.
   *
   * Хранится шаблон, а не готовая фраза: уведомление рождается в контексте
   * чужого запроса — доля мастера в оффере пишется, пока другой мастер жмёт
   * «Принять». Перевести его в этот момент значило бы записать в базу язык
   * постороннего человека. Собирается фраза при чтении, в языке читателя.
   */
  body: string;
  bodyArgs?: (string | number)[];
  priority: NotificationPriority;
  /** Куда ведёт тап: sozo-master://order/{id} и т.п. */
  deepLink?: string;
  orderId?: string;
  read: boolean;
  createdAt: string;
}

/** Группировка в ленте: одна иконка на смысловую группу, а не на каждый вид */
export const NOTIFICATION_GROUPS: Record<NotificationKind, { icon: string; group: string }> = {
  offer: { icon: 'bolt', group: 'Заявки' },
  offer_expired: { icon: 'timer_off', group: 'Заявки' },
  order_changed: { icon: 'edit_calendar', group: 'Заявки' },
  departure_reminder: { icon: 'alarm', group: 'Заявки' },
  addwork_resolved: { icon: 'fact_check', group: 'Заявки' },
  upsell_answered: { icon: 'lightbulb', group: 'Заявки' },
  spare_tier_chosen: { icon: 'tune', group: 'Заявки' },
  payment: { icon: 'payments', group: 'Деньги' },
  tips: { icon: 'volunteer_activism', group: 'Деньги' },
  cash_debt: { icon: 'account_balance_wallet', group: 'Деньги' },
  payout: { icon: 'savings', group: 'Деньги' },
  rating_changed: { icon: 'insights', group: 'Репутация' },
  complaint: { icon: 'report', group: 'Репутация' },
  appeal_resolved: { icon: 'gavel', group: 'Репутация' },
  skill_suspended: { icon: 'lock', group: 'Репутация' },
  tomorrow_ready: { icon: 'event', group: 'График' },
  onboarding: { icon: 'school', group: 'Оформление' },
  system: { icon: 'info', group: 'Прочее' },
};

@Injectable()
export class NotificationsService {
  readonly items: NotificationRec[] = [];

  constructor(private readonly store: StateStore) {
    this.store.register(
      'masterNotifications',
      () => this.items.slice(-2000),
      (d) => {
        this.items.length = 0;
        this.items.push(...((d ?? []) as NotificationRec[]));
      },
    );
  }

  push(data: {
    masterId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    bodyArgs?: (string | number)[];
    priority?: NotificationPriority;
    deepLink?: string;
    orderId?: string;
  }): NotificationRec {
    const rec: NotificationRec = {
      id: uuidv7(),
      priority: data.priority ?? 'normal',
      read: false,
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.items.push(rec);
    // Лента не архив: держим последние 2000 на всех, старое мастеру не нужно
    if (this.items.length > 2000) this.items.splice(0, this.items.length - 2000);
    this.store.persist();
    return rec;
  }

  /**
   * Лента мастера: свежие сверху, сгруппированные по дню.
   * Группировка на сервере, чтобы приложение не считало «вчера» само —
   * иначе телефон с ушедшими часами покажет чужие даты.
   */
  feed(masterId: string, limit = 100) {
    const mine = this.items
      .filter((n) => n.masterId === masterId)
      .slice(-limit)
      .reverse();

    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const groups = new Map<string, NotificationRec[]>();
    for (const n of mine) {
      const day = n.createdAt.slice(0, 10);
      const label = day === today ? tr('Сегодня') : day === yesterday ? tr('Вчера') : day.split('-').reverse().join('.');
      const list = groups.get(label) ?? [];
      list.push(n);
      groups.set(label, list);
    }

    return {
      unread: mine.filter((n) => !n.read).length,
      total: mine.length,
      groups: [...groups.entries()].map(([label, items]) => ({
        label,
        items: items.map((n) => ({
          ...n,
          ...NOTIFICATION_GROUPS[n.kind],
          // Подстановки тоже переводим: внутрь фразы попадают навык, район и
          // ценовая категория — слова из справочников, а не введённый текст.
          // Название детали, которое мастер набрал руками, в словаре не найдётся
          // и останется как есть, и это правильно.
          body: tr(n.body, ...(n.bodyArgs ?? []).map((a) => (typeof a === 'string' ? trValue(a) : a))),
        })),
      })),
    };
  }

  unreadCount(masterId: string): number {
    return this.items.filter((n) => n.masterId === masterId && !n.read).length;
  }

  /** Без id помечаем всё: мастер открыл ленту — значит увидел */
  markRead(masterId: string, id?: string): number {
    let n = 0;
    for (const rec of this.items) {
      if (rec.masterId !== masterId || rec.read) continue;
      if (id && rec.id !== id) continue;
      rec.read = true;
      n++;
    }
    if (n > 0) this.store.persist();
    return n;
  }

  clear(masterId: string): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].masterId === masterId) this.items.splice(i, 1);
    }
    this.store.persist();
  }
}
