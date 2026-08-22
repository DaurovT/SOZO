import type { OrderStatusChangedEvent } from '../../common/event-bus';
import type { DeliverInput } from './push-dispatch.service';

/**
 * Матрица уведомлений клиента по переходам заявки (PRD-01 §5, ТЗ §15.2).
 *
 * Таблица, а не цепочка условий в сервисе доставки. Причина простая: матрица
 * — это документ, её сверяют с ТЗ строка за строкой, и разложенная по
 * тридцати `if` она перестаёт сверяться вовсе. Здесь один переход даёт
 * список уведомлений, и видно, кому и что уходит.
 *
 * Тексты — русские шаблоны с подстановками. Перевод происходит при отправке,
 * в язык устройства получателя (ТЗ §14): в момент перехода язык читателя
 * неизвестен — статус меняет диспетчер или мастер, а читает клиент.
 */

/** Схема deep-link клиентского приложения — симметрично `sozo-master://` */
export const CLIENT_SCHEME = 'sozo-client';

export const link = {
  /** C-14 — карточка активной заявки */
  order: (id: string) => `${CLIENT_SCHEME}://order/${id}`,
  /** C-50 — мини-экран деталей адреса (v2.25) */
  addressDetails: (id: string) => `${CLIENT_SCHEME}://order/${id}/address`,
  /** C-15 — подтверждение стоимости */
  estimate: (id: string) => `${CLIENT_SCHEME}://order/${id}/estimate`,
  /** C-16 — вынужденная доп-работа с фото и вариантами */
  addwork: (id: string) => `${CLIENT_SCHEME}://order/${id}/addwork`,
  /** C-19 — акт выполненных работ */
  act: (id: string) => `${CLIENT_SCHEME}://order/${id}/act`,
  /** C-20 — оплата */
  payment: (id: string) => `${CLIENT_SCHEME}://order/${id}/payment`,
  /** C-21 — оценка работы */
  rate: (id: string) => `${CLIENT_SCHEME}://order/${id}/rate`,
  /** C-22 — спор */
  dispute: (id: string) => `${CLIENT_SCHEME}://order/${id}/dispute`,
  /** C-36 — экран утверждения сметы (B2B) */
  approval: (id: string) => `${CLIENT_SCHEME}://approval/${id}`,
  /** C-53 — отключения ресурсов в доме */
  shutdowns: () => `${CLIENT_SCHEME}://home/shutdowns`,
  /** C-44 — счета и абонентка организации */
  invoices: () => `${CLIENT_SCHEME}://org/invoices`,
  /** C-23 — мои жалобы */
  complaints: () => `${CLIENT_SCHEME}://complaints`,
  /** C-49 — баллы и ваучеры участника программы */
  loyalty: () => `${CLIENT_SCHEME}://loyalty`,
};

/** Готовое к отправке уведомление: всё, кроме способа доставки */
export type ClientNotice = Omit<DeliverInput, 'app'>;

/** «14:00–16:00» из минут от полуночи — так окно записано в заявке */
function windowText(w?: OrderStatusChangedEvent['window']): string | null {
  if (!w || w.startMin === undefined || w.endMin === undefined) return null;
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return `${hhmm(w.startMin)}–${hhmm(w.endMin)}`;
}

/** Сумма человеку — в сумах, а не в тийинах: тийины видит только бухгалтерия */
export function sums(tiyin?: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round((tiyin ?? 0) / 100));
}

/**
 * Что отправить клиенту на этом переходе.
 *
 * Возвращает список, а не одно уведомление: назначение мастера в B2C — это
 * сразу два разных дела для клиента, «к вам едет такой-то» и «уточните, как
 * попасть в подъезд», и склеивать их в один текст нельзя — у них разные
 * экраны и разная срочность.
 */
export function clientNotices(e: OrderStatusChangedEvent): ClientNotice[] {
  const isB2C = e.graphType === 'b2c' || e.graphType === 'emergency' || e.graphType === 'warranty';
  const out: ClientNotice[] = [];
  const to = (n: Omit<ClientNotice, 'phone' | 'event' | 'orderId'> & { event: string }) =>
    out.push({ ...n, phone: e.clientPhone, orderId: e.orderId });

  switch (e.action) {
    case 'assign': {
      const when = windowText(e.window);
      to({
        event: 'order.assigned',
        title: 'Мастер назначен',
        body: when ? 'К вам приедет {0}, окно {1}' : 'К вам приедет {0}',
        bodyArgs: when ? [e.masterName ?? '', when] : [e.masterName ?? ''],
        priority: 'high',
        deepLink: link.order(e.orderId),
        // Телефонный клиент приложения не имеет вовсе (ТЗ §12): для него это
        // единственный способ узнать, кого ждать
        smsFallback: when
          ? 'SOZO: заявка {0} — мастер {1}, окно {2}'
          : 'SOZO: заявка {0} — мастер {1}',
        smsFallbackArgs: when ? [e.number, e.masterName ?? '', when] : [e.number, e.masterName ?? ''],
      });
      if (isB2C) {
        /**
         * Детали адреса (C-50, v2.25).
         *
         * Отдельным уведомлением и с обычным приоритетом: это просьба, а не
         * событие. Не заполнил — диспетчер уточнит звонком, поэтому будить
         * человека этим нельзя.
         */
        to({
          event: 'order.address_details_requested',
          title: 'Уточните детали адреса',
          body: 'Подъезд, этаж, домофон — чтобы мастер не искал вход',
          deepLink: link.addressDetails(e.orderId),
        });
      }
      break;
    }

    case 'depart':
      to({
        event: 'order.master_departed',
        title: 'Мастер выехал',
        body: '{0} в пути. Отслеживайте прибытие в приложении',
        bodyArgs: [e.masterName ?? ''],
        priority: 'high',
        deepLink: link.order(e.orderId),
        smsFallback: 'SOZO: мастер {0} выехал к вам по заявке {1}',
        smsFallbackArgs: [e.masterName ?? '', e.number],
      });
      break;

    case 'request_approval':
      if (isB2C) {
        // Клиент решает сам и со своего телефона — в том числе стоя рядом с
        // мастером: это защита от согласий, которые «получены» устно (ТЗ §6.1)
        to({
          event: 'order.estimate_confirm',
          title: 'Подтвердите стоимость',
          body: 'Мастер уточнил смету: {0} сум',
          bodyArgs: [sums(e.amountTiyin)],
          priority: 'high',
          deepLink: link.estimate(e.orderId),
          smsFallback: 'SOZO: подтвердите стоимость {0} сум по заявке {1}',
          smsFallbackArgs: [sums(e.amountTiyin), e.number],
        });
      } else {
        for (const a of e.approvers ?? []) {
          out.push({
            event: 'order.approval_required',
            phone: a.phone,
            orderId: e.orderId,
            title: 'Смета требует утверждения',
            body: 'Заявка {0}: {1} сум, {2}',
            bodyArgs: [e.number, sums(e.amountTiyin), e.address],
            priority: 'high',
            deepLink: link.approval(e.orderId),
            // SMS здесь по расписанию эскалации (T+24, ТЗ §5.3), а не сразу:
            // дублировать первое же уведомление значило бы платить за то,
            // что человек и так увидит на экране
          });
        }
      }
      break;

    case 'request_addwork':
      if (isB2C) {
        to({
          event: 'order.addwork_requested',
          title: 'Нужны дополнительные работы',
          body: 'Мастер прислал фото и варианты решения на {0} сум',
          bodyArgs: [sums(e.amountTiyin)],
          priority: 'high',
          deepLink: link.addwork(e.orderId),
          smsFallback: 'SOZO: по заявке {0} нужны доп-работы. Решение — в приложении или у диспетчера',
          smsFallbackArgs: [e.number],
        });
      } else {
        /**
         * Красный флаг B2B (ТЗ §5.3): push и SMS сразу, оба канала.
         *
         * Здесь SMS не запасной путь, а второй основной: мастер стоит на
         * объекте и ждёт решения, и два часа молчания стоят дороже, чем
         * сообщение каждому утверждающему.
         */
        for (const a of e.approvers ?? []) {
          out.push({
            event: 'order.addwork_approval_required',
            phone: a.phone,
            orderId: e.orderId,
            title: 'Вынужденная доп-работа',
            body: 'Заявка {0}: мастер на объекте, требуется решение по {1} сум',
            bodyArgs: [e.number, sums(e.amountTiyin)],
            priority: 'heads_up',
            deepLink: link.approval(e.orderId),
            smsFallback: 'SOZO: заявка {0} — мастер на объекте ждёт решения по доп-работам {1} сум',
            smsFallbackArgs: [e.number, sums(e.amountTiyin)],
          });
        }
      }
      break;

    case 'pause':
      // Пауза бывает разной, но человеку важна одна: работать нельзя не из-за
      // мастера, а из-за третьей стороны, и ждать придётся дольше обещанного
      to({
        event: 'order.paused',
        title: 'Работы приостановлены',
        body: e.reason ? 'Заявка {0}: {1}' : 'Заявка {0} на паузе',
        bodyArgs: e.reason ? [e.number, e.reason] : [e.number],
        priority: 'high',
        deepLink: link.order(e.orderId),
      });
      break;

    case 'resume':
      to({
        event: 'order.resumed',
        title: 'Работы продолжаются',
        body: 'Заявка {0} снята с паузы',
        bodyArgs: [e.number],
        deepLink: link.order(e.orderId),
      });
      break;

    case 'complete':
      to({
        event: 'order.completed',
        title: 'Заявка выполнена',
        body: 'Акт по заявке {0} готов — проверьте и подтвердите приёмку',
        bodyArgs: [e.number],
        priority: 'high',
        deepLink: link.act(e.orderId),
        smsFallback: 'SOZO: работы по заявке {0} завершены, акт готов',
        smsFallbackArgs: [e.number],
      });
      break;

    case 'await_payment':
      to({
        event: 'order.awaiting_payment',
        title: 'Ожидает оплаты',
        body: 'По заявке {0} к оплате {1} сум',
        bodyArgs: [e.number, sums(e.amountTiyin)],
        priority: 'high',
        deepLink: link.payment(e.orderId),
        smsFallback: 'SOZO: заявка {0} ожидает оплаты {1} сум',
        smsFallbackArgs: [e.number, sums(e.amountTiyin)],
      });
      break;

    case 'close':
      // Окно оценки — 72 часа (ТЗ §4.1), и просить об этом позже бессмысленно
      to({
        event: 'order.rate_request',
        title: 'Оцените работу',
        body: 'Как прошла заявка {0}? Оценка занимает несколько секунд',
        bodyArgs: [e.number],
        deepLink: link.rate(e.orderId),
      });
      break;

    case 'cancel':
      to({
        event: 'order.cancelled',
        title: 'Заявка отменена',
        body: e.reason ? 'Заявка {0} отменена: {1}' : 'Заявка {0} отменена',
        bodyArgs: e.reason ? [e.number, e.reason] : [e.number],
        priority: 'high',
        deepLink: link.order(e.orderId),
        smsFallback: 'SOZO: заявка {0} отменена',
        smsFallbackArgs: [e.number],
      });
      break;

    case 'open_dispute':
      to({
        event: 'order.dispute_opened',
        title: 'Спор зарегистрирован',
        body: 'Разбираемся по заявке {0}, ответим в течение двух часов',
        bodyArgs: [e.number],
        deepLink: link.dispute(e.orderId),
      });
      break;

    case 'resolve_dispute':
      to({
        event: 'order.dispute_resolved',
        title: 'Спор разрешён',
        body: e.reason ? 'Заявка {0}: {1}' : 'Решение по заявке {0} принято',
        bodyArgs: e.reason ? [e.number, e.reason] : [e.number],
        priority: 'high',
        deepLink: link.dispute(e.orderId),
      });
      break;

    default:
      // Остальные переходы человеку не адресованы: «оценка поставлена» и
      // «смета зафиксирована» — события внутренней кухни, и уведомлять о них
      // значит приучать закрывать уведомления не глядя
      break;
  }
  return out;
}
