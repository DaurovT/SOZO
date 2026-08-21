/**
 * Разовый перенос state.json в PostgreSQL.
 *
 *   STATE_FILE=/var/lib/sozo/state.json \
 *   DATABASE_URL=postgresql://... \
 *   node dist/tools/import-state.js [--dry]
 *
 * Почему инструмент, а не «включить DATABASE_URL и перезапустить». Модули,
 * работающие на базе, файл не читают вовсе — это и есть смысл переезда: один
 * источник истины. Поэтому включение флага на проде дало бы не перенос
 * данных, а пустую систему рядом с полным файлом, и обнаружилось бы это на
 * первом же запросе клиента.
 *
 * Инструмент поднимает приложение целиком и зовёт у модулей их собственную
 * запись — ту же, которой они пользуются в работе. Отдельный путь записи для
 * переноса означал бы, что в базу единожды легло не то, что туда кладёт
 * приложение, и расхождение всплыло бы не здесь, а через месяц в отчёте.
 *
 * Переносится только то, у чего есть таблицы. Остальные девятнадцать
 * разделов остаются в файле — и файл поэтому не удаляется.
 */
import { NestFactory } from '@nestjs/core';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma.service';
import { ParametersService } from '../modules/platform/parameters.service';
import { AUDIT_REPOSITORY } from '../modules/platform/audit.service';
import { PrismaAuditRepository } from '../modules/platform/audit.repository';
import { IDENTITY_REPOSITORY } from '../modules/identity/identity.service';
import { PrismaIdentityRepository } from '../modules/identity/identity.repository';
import { PricingService } from '../modules/pricing/pricing.service';
import { CrmService } from '../modules/crm/crm.service';
import { MastersService } from '../modules/masters/masters.module';
import { InMemoryBuildingRepository } from '../modules/buildings/building.repository';
import { InMemoryPermitRepository } from '../modules/access/permit.repository';
import { PrismaOrderRepository } from '../modules/orders/prisma-order.repository';
import { BillingService } from '../modules/billing/billing.service';
import { SchedulingService } from '../modules/scheduling/scheduling.service';
import { PermitLinksService } from '../modules/access/permit-links.service';
import { WebCardLinksService } from '../modules/web-card/web-card-links.service';
import { SlaService } from '../modules/sla/sla.service';
import { SubscriptionsService } from '../modules/subscriptions/subscriptions.service';
import { SchedulerService } from '../modules/scheduler/scheduler.service';
import { AnalyticsService } from '../modules/analytics/analytics.module';
import { PromoService } from '../modules/promo/promo.module';
import { LoyaltyService } from '../modules/loyalty/loyalty.module';
import { ReserveService } from '../modules/reserve/reserve.module';
import { LeadsService } from '../modules/leads/leads.module';
import { PublicLeadsService } from '../modules/public-api/public-api.module';
import { RegistryService } from '../modules/registry/registry.module';
import { StockService } from '../modules/stock/stock.module';
import { QualityService } from '../modules/quality/quality.service';
import { ClientProfilesService } from '../modules/client-b2c/client-profiles.service';
import { DispatchOpsService } from '../modules/dispatch-ops/dispatch-ops.service';
import { FieldService } from '../modules/field/field.service';
import { NotificationsService } from '../modules/master-api/notifications.service';
import { MasterOffersService } from '../modules/master-api/offers.service';
import { RatingService } from '../modules/master-api/rating.service';
import { OnboardingService } from '../modules/master-api/onboarding.service';
import { ResourcesService } from '../modules/master-api/resources.service';
import { MasterOpsService } from '../modules/master-api/master-ops.service';

const dry = process.argv.includes('--dry');

async function main(): Promise<void> {
  const file = process.env.STATE_FILE;
  if (!file) throw new Error('STATE_FILE не задан: нечего переносить');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан: некуда переносить');

  const state = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const size = (v: unknown): number =>
    Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.values(v).reduce<number>((s, x) => s + (Array.isArray(x) ? x.length : 0), 0) : 0;

  console.log(`Снимок: ${file}`);
  for (const k of ['parameters', 'pricing', 'crm', 'masters', 'buildings', 'access', 'orders', 'billing', 'scheduling', 'identity', 'audit']) {
    console.log(`  ${k}: ${size(state[k])}`);
  }
  /**
   * Сверка до записи.
   *
   * Файл разрешал то, чего не разрешает схема: на проде оказались семь
   * тестовых организаций с одним ИНН. Без этой проверки перенос падал бы на
   * второй записи с ошибкой драйвера, половина данных была бы уже в базе, а
   * человек читал бы стек вместо списка того, что чинить.
   *
   * Конфликты называются все сразу и до первой записи. Пропустить их можно
   * только явно — и тогда в отчёте видно, что именно не поехало.
   */
  const skip = process.argv.includes('--skip-conflicts');
  /**
   * Второй способ разрешить конфликт ИНН — обнулить его у повторов.
   *
   * Частичный уникальный индекс пропускает пустые ИНН: организация без него
   * существовать может, две с одним и тем же — нет. Для тестовых записей это
   * лучше пропуска: организация остаётся вместе со своими точками B2B, и
   * заявки на них не повисают. Настоящий ИНН вписывается потом руками.
   */
  const blankInn = process.argv.includes('--blank-duplicate-inn');
  const conflicts: string[] = [];

  const orgs = (state.crm ?? []) as Array<{ id: string; inn?: string; name?: string }>;
  const byInn = new Map<string, typeof orgs>();
  for (const o of orgs) {
    if (!o.inn) continue;
    byInn.set(o.inn, [...(byInn.get(o.inn) ?? []), o]);
  }
  const dupOrgIds = new Set<string>();
  for (const [inn, group] of byInn) {
    if (group.length < 2) continue;
    const fate = blankInn ? 'останется с пустым ИНН' : 'будет пропущена';
    conflicts.push(
      `ИНН ${inn} у ${group.length} организаций — в базе он уникален (это налоговый номер, а не метка):\n` +
        group.map((o, i) => `      ${i === 0 ? 'останется' : fate}: ${o.name ?? o.id}`).join('\n'),
    );
    for (const o of group.slice(1)) {
      if (blankInn) o.inn = '';
      else dupOrgIds.add(o.id);
    }
  }

  const users = Array.isArray(state.identity)
    ? (state.identity as Array<{ phone: string }>)
    : (((state.identity ?? {}) as { users?: Array<{ phone: string }> }).users ?? []);
  const seenPhone = new Set<string>();
  const dupPhones = new Set<string>();
  for (const u of users) {
    if (seenPhone.has(u.phone)) dupPhones.add(u.phone);
    seenPhone.add(u.phone);
  }
  if (dupPhones.size) conflicts.push(`Телефон встречается дважды у ${dupPhones.size} учётных записей: ${[...dupPhones].join(', ')}`);

  /**
   * Повисшие ссылки заявок.
   *
   * Пропуск организации уносит с собой её точки B2B, а на точку ссылается
   * заявка внешним ключом. Без этой проверки перенос доходил до середины
   * заявок и падал на драйвере — уже записав часть.
   */
  const liveLocations = new Set<string>();
  for (const o of orgs) {
    if (dupOrgIds.has(o.id)) continue;
    for (const l of ((o as { locations?: Array<{ id: string }> }).locations ?? [])) liveLocations.add(l.id);
  }
  const liveMasters = new Set(((state.masters ?? []) as Array<{ id: string }>).map((m) => m.id));
  const allOrders = (state.orders ?? []) as Array<{ id: string; number: string; locationId?: string | null; masterId?: string | null }>;
  const orphanOrders = allOrders.filter(
    (o) => (o.locationId && !liveLocations.has(o.locationId)) || (o.masterId && !liveMasters.has(o.masterId)),
  );
  if (orphanOrders.length) {
    conflicts.push(
      `Заявок со ссылкой на пропущенную точку или отсутствующего мастера: ${orphanOrders.length} ` +
        `(${orphanOrders.slice(0, 5).map((o) => o.number).join(', ')}${orphanOrders.length > 5 ? ', …' : ''})`,
    );
  }
  const orphanIds = new Set(orphanOrders.map((o) => o.id));

  const numbers = new Map<string, number>();
  for (const o of (state.orders ?? []) as Array<{ number: string }>) numbers.set(o.number, (numbers.get(o.number) ?? 0) + 1);
  const dupNumbers = [...numbers].filter(([, n]) => n > 1);
  if (dupNumbers.length) conflicts.push(`Номер заявки повторяется: ${dupNumbers.map(([n, c]) => `${n} (${c})`).join(', ')}`);

  if (conflicts.length) {
    console.log('\nСнимок конфликтует со схемой:');
    for (const c of conflicts) console.log(`  · ${c}`);
    if (!skip && !dry) {
      throw new Error(
        'Перенос остановлен до первой записи. Почините снимок или добавьте --skip-conflicts, ' +
          'чтобы перенести всё остальное — пропущенное будет перечислено',
      );
    }
  }

  if (dry) {
    console.log('\n--dry: ничего не записано');
    return;
  }

  /**
   * Снимок копируется, и приложение поднимается на копии.
   *
   * Хранилище состояния пишет в STATE_FILE само, и уже на первом запуске
   * инструмента снимок был перезаписан: разделы, которые с включённой базой
   * больше не регистрируются, из файла исчезли. На проде это уничтожило бы
   * источник посреди переноса — до того, как стало бы ясно, что перенос
   * удался.
   */
  const tmp = mkdtempSync(join(tmpdir(), 'sozo-import-'));
  const working = join(tmp, 'state.json');
  copyFileSync(file, working);
  process.env.STATE_FILE = working;

  /**
   * Посев демо выключается здесь, а не в команде запуска.
   *
   * На пустой базе модули пишут в неё демо-мастеров, демо-организации и
   * стартовый прайс. Забыть переменную легко, а результат — выдуманные
   * контрагенты вперемешку с живыми, которых потом не отличить.
   */
  process.env.SOZO_NO_SEED = '1';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  if (!prisma.enabled) throw new Error('PrismaService выключен — проверьте DATABASE_URL');

  /**
   * Пустая база — условие переноса.
   *
   * Повторный перенос поверх работающей базы затёр бы данными из снимка всё,
   * что появилось после переключения. Проверка стоит до первой записи, а не
   * после, и снимается только руками.
   */
  const already = await prisma.withContext(async (tx) => ({
    orders: await tx.order.count(),
    users: await tx.user.count(),
  }));
  if ((already.orders > 0 || already.users > 0) && !process.argv.includes('--force')) {
    throw new Error(
      `В базе уже есть данные (заявок ${already.orders}, пользователей ${already.users}). ` +
        'Перенос делается один раз в пустую базу; повтор затрёт то, что появилось после переключения. ' +
        'Если это осознанно — добавьте --force',
    );
  }

  const done: Array<[string, unknown]> = [];

  // Порядок задан внешними ключами: на заявку ссылаются проводки и брони, на
  // объект — заявка, на организацию — объект
  done.push(['параметры', await app.get(ParametersService).importFromState(state.parameters)]);
  done.push(['учётные записи', await (app.get(IDENTITY_REPOSITORY) as PrismaIdentityRepository).importFromState(state.identity)]);
  done.push(['прайс', await app.get(PricingService).importFromState(state.pricing)]);
  const orgsToImport = orgs.filter((o) => !dupOrgIds.has(o.id));
  done.push(['контрагенты', await app.get(CrmService).importFromState(orgsToImport, state.crmInvites)]);
  if (dupOrgIds.size) console.log(`  (организаций пропущено по конфликту ИНН: ${dupOrgIds.size})`);
  done.push(['мастера', await app.get(MastersService).importFromState(state.masters)]);
  done.push(['объекты', await app.get(InMemoryBuildingRepository).importFromState(state.buildings)]);
  const ordersToImport = allOrders.filter((o) => !orphanIds.has(o.id));
  done.push(['заявки', await app.get(PrismaOrderRepository).importFromState(ordersToImport)]);
  if (orphanIds.size) console.log(`  (заявок пропущено по повисшим ссылкам: ${orphanIds.size})`);
  done.push(['наряды-допуски', await app.get(InMemoryPermitRepository).flushToDb()]);
  done.push(['биллинг', await app.get(BillingService).flushToDb()]);
  done.push(['планировщик', await app.get(SchedulingService).flushToDb()]);
  done.push(['аудит', await (app.get(AUDIT_REPOSITORY) as PrismaAuditRepository).importFromState(state.audit)]);

  /**
   * Модули, переехавшие на спроектированные таблицы (DEV-19).
   *
   * Им переносить нечего в том смысле, в каком переносили заявкам: они читают
   * state.json и с включённой базой, поэтому в памяти к этому моменту уже
   * лежит содержимое снимка. Нужно только записать — и дождаться записи, а не
   * «назначить» её.
   *
   * Порядок здесь не важен: у их таблиц нет внешних ключей на чужие модули —
   * это решение принято при проектировании и оно же позволяет не выстраивать
   * зависимости повторно.
   */
  const mirrors: Array<[string, { flushToDb: () => Promise<unknown> }]> = [
    ['ссылки наряда', app.get(PermitLinksService)],
    ['ссылки веб-карточки', app.get(WebCardLinksService)],
    ['SLA', app.get(SlaService)],
    ['расчёт с оператором', app.get(SubscriptionsService)],
    ['таймеры', app.get(SchedulerService)],
    ['спрос', app.get(AnalyticsService)],
    ['промо', app.get(PromoService)],
    ['лояльность', app.get(LoyaltyService)],
    ['резервный фонд', app.get(ReserveService)],
    ['лиды', app.get(LeadsService)],
    ['обзвон', app.get(PublicLeadsService)],
    ['реестры', app.get(RegistryService)],
    ['склад', app.get(StockService)],
    ['качество', app.get(QualityService)],
    ['профили клиентов', app.get(ClientProfilesService)],
    ['диспетчерская', app.get(DispatchOpsService)],
    ['акты осмотра', app.get(FieldService)],
    ['уведомления мастеру', app.get(NotificationsService)],
    ['предложения мастеру', app.get(MasterOffersService)],
    ['рейтинг мастера', app.get(RatingService)],
    ['анкеты кандидатов', app.get(OnboardingService)],
    ['ресурсы мастера', app.get(ResourcesService)],
    ['работа на заявке', app.get(MasterOpsService)],
  ];
  for (const [name, svc] of mirrors) {
    await svc.flushToDb();
    done.push([name, 'записано']);
  }

  console.log('\nПеренесено:');
  for (const [name, res] of done) console.log(`  ${name}: ${typeof res === 'object' ? JSON.stringify(res) : String(res)}`);

  // Сверка: считаем строки в базе, а не доверяем счётчикам переноса
  const rows = await prisma.withContext(async (tx) => ({
    параметров: await tx.systemParameter.count(),
    пользователей: await tx.user.count(),
    организаций: await tx.organization.count(),
    мастеров: await tx.masterProfile.count(),
    заявок: await tx.order.count(),
    проводок: await tx.transaction.count(),
    смен: await tx.shift.count(),
    записейАудита: await tx.auditLog.count(),
  }));
  console.log('\nВ базе после переноса:');
  for (const [k, v] of Object.entries(rows)) console.log(`  ${k}: ${v}`);

  await app.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\nИсходный снимок не тронут: ${file}`);
}

main().catch((e: unknown) => {
  console.error(`Перенос не выполнен: ${(e as Error).message}`);
  process.exit(1);
});
