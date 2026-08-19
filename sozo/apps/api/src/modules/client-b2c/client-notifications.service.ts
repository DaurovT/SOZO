import { Injectable } from '@nestjs/common';
import { tr } from '../../common/locale';
import { BillingService } from '../billing/billing.service';
import { CrmService } from '../crm/crm.service';
import { FieldService } from '../field/field.service';
import { QualityService } from '../quality/quality.service';
import type { OrderRecord } from '../orders/order.repository';
import { ClientProfilesService } from './client-profiles.service';
import { ClientViewService } from './client-view.service';

/**
 * Лента уведомлений клиента.
 *
 * Не отдельное хранилище, а вывод из уже имеющихся данных: журнала статусов,
 * ждущих решений, счетов и жалоб. Своя копия ленты рано или поздно разойдётся
 * с фактами — заявка закрыта, а уведомление всё зовёт подтвердить смету.
 * Здесь такое невозможно: пропало основание — пропал и пункт.
 *
 * Хранится только отметка «прочитано»: у неё нет источника, кроме действий
 * пользователя.
 */

export type ClientNotification = {
  id: string;
  kind: 'order' | 'decision' | 'money' | 'warranty' | 'complaint' | 'site';
  title: string;
  body: string;
  at: string;
  orderId?: string;
  /** Уведомление зовёт что-то сделать, а не просто сообщает */
  actionable: boolean;
  read: boolean;
};

const STATUS_NEWS: Record<string, { title: string; body: string }> = {
  estimated: { title: 'Заявка оценена', body: 'Показали предварительную вилку — точную цену назовёт мастер на месте' },
  assigned: { title: 'Мастер назначен', body: 'Уточните детали адреса, чтобы он доехал быстрее' },
  master_departed: { title: 'Мастер выехал', body: 'Скоро будет у вас' },
  in_progress: { title: 'Мастер приступил к работе', body: '' },
  completed: { title: 'Работа выполнена', body: 'Проверьте результат и подтвердите приёмку' },
  verified: { title: 'Заявка проверена', body: 'Осталось оплатить' },
  closed: { title: 'Заявка закрыта', body: 'Оцените работу мастера' },
  cancelled: { title: 'Заявка отменена', body: '' },
  dispute: { title: 'Спор открыт', body: 'Разберёмся и вернёмся с решением' },
};

@Injectable()
export class ClientNotificationsService {
  constructor(
    private readonly profiles: ClientProfilesService,
    private readonly view: ClientViewService,
    private readonly crm: CrmService,
    private readonly field: FieldService,
    private readonly billing: BillingService,
    private readonly quality: QualityService,
  ) {}

  /**
   * @param orders все заявки клиента — и личные, и по его точкам: лента одна,
   *               человеку неважно, в каком контуре случилось событие
   */
  build(phone: string, orders: OrderRecord[]): ClientNotification[] {
    const profile = this.profiles.get(phone);
    const read = new Set(profile.readNotifications ?? []);
    const out: ClientNotification[] = [];
    const add = (n: Omit<ClientNotification, 'read'>) => out.push({ ...n, read: read.has(n.id) });

    for (const o of orders) {
      // События по журналу статусов: только те, что клиенту что-то говорят
      for (const log of o.statusLog) {
        const news = STATUS_NEWS[log.to];
        if (!news) continue;
        add({
          id: `${o.id}:${log.to}`,
          kind: 'order',
          // Переводим до склейки, а не после: интерцептор сверяет строку со
          // словарём целиком, и «Z-2026-000090 · Скоро будет у вас» не совпадёт
          // ни с одним ключом. Из-за этого вся лента оставалась русской даже
          // на узбекском — тексты были переведены, а показывались склеенными
          title: tr(news.title),
          body: [o.number, news.body && tr(news.body)].filter(Boolean).join(' · '),
          at: new Date(log.at).toISOString(),
          orderId: o.id,
          actionable: ['completed', 'closed', 'assigned'].includes(log.to),
        });
      }

      // Ждут решения — самое важное в ленте, поэтому отдельным пунктом
      const decision = this.view.card(o).decision;
      if (decision) {
        add({
          id: `${o.id}:decision:${decision.kind}`,
          kind: 'decision',
          title: tr(decision.title),
          body: o.number,
          at: new Date(o.statusLog[o.statusLog.length - 1]?.at ?? o.createdAt).toISOString(),
          orderId: o.id,
          actionable: true,
        });
      }

      // Гарантия заканчивается — повод проверить, всё ли в порядке
      const until = this.view.card(o).warrantyUntil;
      if (until) {
        const daysLeft = Math.floor((new Date(until).getTime() - Date.now()) / 86_400_000);
        if (daysLeft >= 0 && daysLeft <= 7) {
          add({
            id: `${o.id}:warranty`,
            kind: 'warranty',
            title: tr('Гарантия заканчивается'),
            body: [
              o.number,
              tr('осталось {0} дн. Если что-то не так — сообщите сейчас, это бесплатно', daysLeft),
            ].join(' · '),
            at: new Date(Date.now() - (7 - daysLeft) * 86_400_000).toISOString(),
            orderId: o.id,
            actionable: true,
          });
        }
      }
    }

    // Жалобы: статус берём из реестра качества, где идёт разбор. Своя копия
    // в профиле не обновляется никогда — по ней клиенту вечно «жалоба принята»,
    // хотя её давно закрыли
    for (const c of profile.complaints) {
      const q = c.qualityId ? this.quality.complaints.find((x) => x.id === c.qualityId) : undefined;
      const status = q?.status ?? c.status;
      if (status === 'new') continue;
      add({
        id: `complaint:${c.id}:${status}`,
        kind: 'complaint',
        title: tr(
          status === 'in_progress'
            ? 'Жалоба в работе'
            : status === 'rejected'
              ? 'По жалобе принято решение'
              : 'Жалоба решена',
        ),
        body: tr(q?.resolution ?? c.resolution ?? c.type),
        at: q?.resolvedAt ?? q?.firstResponseAt ?? c.createdAt,
        actionable: false,
      });
    }

    // Бизнес-контур: акты на подпись и неоплаченные счета
    const sites = this.crm.locationsForPhone(phone);
    for (const s of sites) {
      for (const act of this.field.list({ locationId: s.loc.id })) {
        if (act.status !== 'sent') continue;
        add({
          id: `act:${act.id}`,
          kind: 'site',
          title: tr('Акт осмотра ждёт решения'),
          body: [act.locationName, tr('дефектов: {0}', act.items.length)].join(' · '),
          at: act.sentAt ?? act.createdAt,
          actionable: true,
        });
      }
    }
    const orgIds = [...new Set(sites.map((s) => s.org.id))];
    for (const invoice of this.billing.invoicesList()) {
      if (!orgIds.includes(invoice.organizationId) || invoice.status !== 'issued') continue;
      const days = Math.floor((Date.now() - new Date(invoice.issuedAt).getTime()) / 86_400_000);
      if (days < 3) continue; // до T+3 счёт просто выставлен, тревожить не за чем
      add({
        id: `invoice:${invoice.id}`,
        kind: 'money',
        title: tr('Счёт не оплачен'),
        body: [invoice.number, tr('{0} дн. с выставления', days)].join(' · '),
        at: invoice.issuedAt,
        actionable: true,
      });
    }

    // Непрочитанное, зовущее к действию, — наверх независимо от времени:
    // «мастер ждёт подтверждения» не должно тонуть под «мастер приступил»,
    // у которых одна и та же отметка времени. Остальное — свежее сверху.
    return out
      .sort((a, b) => {
        const aTop = a.actionable && !a.read ? 1 : 0;
        const bTop = b.actionable && !b.read ? 1 : 0;
        if (aTop !== bTop) return bTop - aTop;
        return b.at.localeCompare(a.at);
      })
      .slice(0, 100);
  }

  unread(phone: string, orders: OrderRecord[]): number {
    return this.build(phone, orders).filter((n) => !n.read).length;
  }

  markRead(phone: string, ids: string[]): void {
    const profile = this.profiles.get(phone);
    profile.readNotifications = [...new Set([...(profile.readNotifications ?? []), ...ids])].slice(-500);
    this.profiles.touch();
  }
}
