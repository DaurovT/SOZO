import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus, type ObservationCreatedEvent } from '../../common/event-bus';
import { BuildingsService } from '../buildings/buildings.service';
import { OrdersService } from './orders.service';

/**
 * Аварийное замечание превращается в заявку без решения человека
 * (DEV-15 §7.7.4, PRD-04 A-44).
 *
 * Живёт в orders, а не в buildings: заявку создаёт тот, кто ей владеет, и
 * обратный импорт перевернул бы направление зависимостей (DEV-07 §3). Все
 * нужные поля приезжают в событии — подписчик не ходит обратно в buildings
 * ни за чем, кроме адреса объекта.
 *
 * Замечание всегда об ОБЩЕМ имуществе, поэтому заявка создаётся со
 * `scope: 'common_area'`: окна первой руки нет, мастеру платформы она не
 * достаётся ни при каких условиях, денег с жителя за неё не берут
 * (ТЗ §19.3 п.5 — правило абсолютное).
 */
@Injectable()
export class ObservationOrdersService implements OnModuleInit {
  private readonly log = new Logger(ObservationOrdersService.name);

  constructor(
    private readonly bus: EventBus,
    private readonly orders: OrdersService,
    private readonly buildings: BuildingsService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<ObservationCreatedEvent>('observation.created', (e) => {
      void this.handle(e);
    });
  }

  private async handle(e: ObservationCreatedEvent): Promise<void> {
    if (e.severity !== 'emergency') return;

    const building = this.buildings.listBuildings('t0').find((b) => b.id === e.buildingId);
    // Объект без действующего оператора: общего имущества как отдельного
    // контура нет, и вешать аварию не на кого. Замечание остаётся в журнале.
    if (!building || building.connectionStatus !== 'active') return;

    try {
      const order = await this.orders.create('t0', {
        clientPhone: e.authorPhone,
        address: `${building.address}, ${e.zoneKey}`,
        description: e.comment ?? 'Аварийное замечание с обхода объекта',
        urgency: 'emergency',
        source: 'app',
        scope: 'common_area',
      });
      this.buildings.linkObservationOrder('t0', e.observationId, order.id);
      this.log.log(`Замечание ${e.observationId} → аварийная заявка ${order.number}`);
    } catch (err) {
      // Ронять фиксацию замечания нельзя: снимок уже сделан, и потерять его
      // хуже, чем не создать заявку. Замечание останется открытым в кабинете.
      this.log.error(`Не удалось создать заявку по замечанию ${e.observationId}: ${String(err)}`);
    }
  }
}
