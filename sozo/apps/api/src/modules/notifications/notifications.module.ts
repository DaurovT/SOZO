import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DeviceTokensService } from './device-tokens.service';
import { PushDispatchService } from './push-dispatch.service';
import { DevicesController } from './devices.controller';
import { SmsService } from '../../common/sms.service';
import { PushService } from '../../common/push.service';
import { PlatformModule } from '../platform/platform.module';

/**
 * notifications (DEV-07 §2 п.13): доставка сообщений человеку.
 *
 * Ничего не экспортирует и никем не импортируется: подписывается на шину и
 * работает от событий. Так и задумано — доменные модули публикуют факт, а не
 * распоряжаются доставкой.
 *
 * Единственный контроллер здесь — регистрация устройства. Он живёт в этом
 * модуле по той же причине: таблица токенов одна на оба приложения, и
 * заводить её копию в API мастера и в API клиента незачем.
 */
@Module({
  imports: [PlatformModule],
  controllers: [DevicesController],
  providers: [NotificationsService, DeviceTokensService, PushDispatchService, SmsService, PushService],
})
export class NotificationsModule {}
