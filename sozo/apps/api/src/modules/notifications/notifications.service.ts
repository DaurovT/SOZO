import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/event-bus';
import { SmsService } from '../../common/sms.service';
import { ParametersService } from '../platform/parameters.service';

/**
 * Доставка сообщений человеку (DEV-07 §2 п.13).
 *
 * До сих пор короткие коды выписывались, складывались в журнал — и никуда не
 * уходили. Кабинет показывал, «кому ушла SMS», хотя не уходило ничего:
 * отправлял их человек руками, а на согласовании наряда-допуска держится
 * весь контур доступа. Теперь код превращается в сообщение здесь.
 *
 * Модуль подписан на шину и не импортируется никем: access публикует событие
 * и не знает, что с ним будет дальше (DEV-07 §3). Поэтому же отказ доставки
 * не роняет переход наряда — согласование не должно срываться из-за
 * недоступного поставщика, у согласующего остаётся кабинет.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly bus: EventBus,
    private readonly sms: SmsService,
    private readonly params: ParametersService,
  ) {}

  /**
   * Адрес публичных страниц. Параметр 201, а не переменная окружения: он же
   * стоит в ссылке на веб-карточку заявки, и два источника разъехались бы
   * при первом переезде домена.
   */
  private base(): string {
    return this.params.text(201, 'https://sozo.uz');
  }

  onModuleInit(): void {
    /**
     * W-06: согласование наряда-допуска.
     *
     * Текст умещается в одну SMS. Кириллицей это 70 символов, поэтому в нём
     * нет ни адреса объекта, ни перечня зон: всё это согласующий увидит на
     * странице, а разбитое на три части сообщение стоит втрое и приходит
     * вразнобой.
     */
    this.bus.subscribe<{ code: string; approverPhone: string; isBackup: boolean }>('permit.link_issued', (e) =>
      this.send(e.approverPhone, `SOZO: наряд-допуск на согласование. ${this.base()}/p/${e.code}`, 'наряд-допуск'),
    );

    /**
     * C-56: доступ в чужое помещение.
     *
     * Житель отвечает по ссылке — приложения у него может не быть вовсе.
     * Спецификация называет это пушем, но FCM в системе нет, и обещать
     * доставку, которой не существует, нельзя.
     */
    this.bus.subscribe<{ accessCode: string; residentPhone: string }>('unit_access.link_issued', (e) =>
      this.send(e.residentPhone, `SOZO: нужен доступ в вашу квартиру. Решить: ${this.base()}/u/${e.accessCode}`, 'доступ в помещение'),
    );
  }

  private async send(phone: string, text: string, what: string): Promise<void> {
    if (!phone) return;
    const res = await this.sms.send(phone, text);
    if (!res.sent) {
      // Не бросаем: доставка — следствие события, а не его условие. Провал
      // виден в журнале, а согласующему остаётся кабинет
      this.log.error(`${what}: SMS на ${phone} не ушла — ${res.error ?? 'причина неизвестна'}`);
    }
  }
}
