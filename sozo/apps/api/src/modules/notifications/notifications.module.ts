import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SmsService } from '../../common/sms.service';
import { PlatformModule } from '../platform/platform.module';

/**
 * notifications (DEV-07 §2 п.13): доставка сообщений человеку.
 *
 * Никого не экспортирует и никем не импортируется: подписывается на шину и
 * работает от событий. Так и задумано — доменные модули публикуют факт, а не
 * распоряжаются доставкой.
 */
@Module({
  imports: [PlatformModule],
  providers: [NotificationsService, SmsService],
})
export class NotificationsModule {}
