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
    // Возвращаем промис, а не глотаем его: publishAndWait ждёт именно его,
    // иначе ответ на фиксацию замечания обгонял бы создание заявки
    this.bus.subscribe<ObservationCreatedEvent>('observation.created', (e) => this.handle(e));
  }

  private async handle(e: ObservationCreatedEvent): Promise<void> {
    if (e.severity !== 'emergency') return;

    /**
     * Заявка по этому замечанию уже создана — второй не заводим.
     *
     * Обработчик обязан быть идемпотентным: шина повторяет доставку, а
     * ошибка после создания заявки (например, при связывании) означала бы
     * ещё одну заявку на каждую попытку. Признак берём из самого замечания —
     * он же виден в кабинете, так что состояние одно, а не два.
     */
    const already = this.buildings.getObservation('t0', e.observationId);
    if (already?.routedEntityId) return;

    const building = this.buildings.listBuildings('t0').find((b) => b.id === e.buildingId);
    // Объект без действующего оператора: общего имущества как отдельного
    // контура нет, и вешать аварию не на кого. Замечание остаётся в журнале.
    if (!building || building.connectionStatus !== 'active') return;

    /**
     * Телефон автора замечания в заявку не переносим вслепую.
     *
     * `create` валидирует его строгой регуляркой `+998XXXXXXXXX`, а автор
     * замечания — сотрудник на обходе, чей номер мог быть записан как угодно.
     * При расхождении формата создание падало, ошибка уходила в лог, и
     * аварийного замечания просто не становилось заявкой — молча. Аварийная
     * заявка по общему имуществу оформляется на дежурный телефон объекта:
     * клиента у неё нет по определению, платит оператор.
     */
    const PHONE = /^\+998\d{9}$/;
    const clientPhone = PHONE.test(e.authorPhone) ? e.authorPhone : (building.emergencyPhone ?? '');
    if (!PHONE.test(clientPhone)) {
      // Молчать нельзя: аварийного замечания не станет заявкой, и никто об
      // этом не узнает. Причина ложится на само замечание — её видно в
      // кабинете рядом с ним, — и бросаем: шина покажет запись в DLQ
      this.buildings.markObservationRoutingFailed('t0', e.observationId, 'некорректный телефон автора и дежурный телефон объекта');
      throw new Error(
        `Замечание ${e.observationId}: ни телефон автора (${e.authorPhone}), ни аварийный телефон объекта не в формате +998XXXXXXXXX`,
      );
    }
    let order;
    try {
      order = await this.orders.create('t0', {
        clientPhone,
        address: `${building.address}, ${e.zoneKey}`,
        description: e.comment ?? 'Аварийное замечание с обхода объекта',
        urgency: 'emergency',
        source: 'app',
        scope: 'common_area',
      });
    } catch (err) {
      /**
       * Ронять фиксацию замечания нельзя: снимок уже сделан, и потерять его
       * хуже, чем не создать заявку. Но и молчать нельзя — раньше ошибка
       * оставалась только в логе, и никто не узнавал, что аварийной заявки
       * нет. Причина ложится на замечание, и бросаем дальше: шина повторит
       * доставку, а после исчерпания попыток запись останется в DLQ.
       *
       * Повтор безопасен: выше стоит проверка «заявка уже создана».
       */
      this.log.error(`Не удалось создать заявку по замечанию ${e.observationId}: ${String(err)}`);
      this.buildings.markObservationRoutingFailed('t0', e.observationId, 'не удалось создать аварийную заявку');
      throw err;
    }
    /**
     * Связывание — вне try создания и сразу после него.
     *
     * Если бы ошибка связывания уходила в общий повтор, каждая попытка
     * доставки заводила бы новую заявку: восемь попыток — восемь аварийных
     * заявок из одного замечания. Заявка уже есть; не связалась — это
     * отдельная беда, и лечится она отдельно.
     */
    try {
      this.buildings.linkObservationOrder('t0', e.observationId, order.id);
      this.log.log(`Замечание ${e.observationId} → аварийная заявка ${order.number}`);
    } catch (err) {
      this.log.error(`Заявка ${order.number} создана, но не связалась с замечанием ${e.observationId}: ${String(err)}`);
      this.buildings.markObservationRoutingFailed('t0', e.observationId, `заявка ${order.number} создана, связь не записана`);
    }
  }
}
