import { BadRequestException, Body, Controller, Get, Module, Param, Post, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { RegistryModule, RegistryService } from '../registry/registry.module';
import { MastersModule, MastersService } from '../masters/masters.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadsService } from '../leads/leads.module';
import { AuditService } from '../platform/audit.service';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { Injectable } from '@nestjs/common';

/**
 * Публичный API лендингов (PRD-05 §12.8, ТЗ 17.15).
 * Read-only без аутентификации, только агрегаты: цены «от» и ставки типов объектов
 * из активного релиза. Кеш с TTL + инвалидация по активации релиза.
 * Приём лидов: каждая форма порождает лид в операционном контуре с задачей и SLA
 * (PRD-06 §4.1) — «лид никогда не остаётся письмом на почту».
 */

export interface CallTask {
  id: string;
  kind: 'b2c_lead' | 'b2b_lead' | 'master_candidate';
  title: string;
  phone: string;
  payload: Record<string, unknown>;
  slaMinutes: number;
  dueAt: string;
  status: 'open' | 'done';
  source: string;
  utm?: Record<string, string>;
  createdAt: string;
  doneAt?: string;
  result?: string;
}

@Injectable()
export class PublicLeadsService implements OnModuleInit {
  readonly tasks: CallTask[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'publicLeads',
      () => this.tasks,
      (d) => {
        this.tasks.length = 0;
        this.tasks.push(...(d as CallTask[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'CallTasks', {
      load: async (tx) => {
        const rows = await tx.callTask.findMany({ orderBy: { createdAt: 'asc' } });
        if (!rows.length) return 0;
        this.tasks.length = 0;
        this.tasks.push(
          ...rows.map((r) => ({
            id: r.id,
            kind: r.kind as CallTask['kind'],
            title: r.title,
            phone: r.phone,
            payload: (r.payload as Record<string, unknown>) ?? {},
            slaMinutes: r.slaMinutes,
            dueAt: r.dueAt.toISOString(),
            status: r.status as CallTask['status'],
            source: r.source,
            utm: (r.utm as Record<string, string>) ?? undefined,
            createdAt: r.createdAt.toISOString(),
            doneAt: r.doneAt?.toISOString(),
            result: r.result ?? undefined,
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const t of this.tasks) {
          const data = {
            kind: t.kind,
            title: t.title,
            phone: t.phone,
            payload: (t.payload ?? {}) as object,
            slaMinutes: t.slaMinutes,
            dueAt: new Date(t.dueAt),
            status: t.status,
            source: t.source,
            utm: (t.utm ?? {}) as object,
            doneAt: t.doneAt ? new Date(t.doneAt) : null,
            result: t.result ?? null,
          };
          await tx.callTask.upsert({
            where: { id: t.id },
            create: { id: t.id, tenantId, createdAt: new Date(t.createdAt), ...data },
            update: data,
          });
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

  add(task: Omit<CallTask, 'id' | 'createdAt' | 'status' | 'dueAt'>): CallTask {
    const rec: CallTask = {
      id: uuidv7(),
      status: 'open',
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + task.slaMinutes * 60_000).toISOString(),
      ...task,
    };
    this.tasks.push(rec);
    this.store.persist();
    return rec;
  }

  complete(id: string, result: string): CallTask | undefined {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return undefined;
    t.status = 'done';
    t.doneAt = new Date().toISOString();
    t.result = result;
    this.store.persist();
    return t;
  }

  open(): CallTask[] {
    return this.tasks.filter((t) => t.status === 'open').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
}

@Controller('public')
export class PublicApiController {
  constructor(
    private readonly pricing: PricingService,
    private readonly registry: RegistryService,
    private readonly masters: MastersService,
    private readonly leads: LeadsService,
    private readonly publicLeads: PublicLeadsService,
    private readonly audit: AuditService,
  ) {}

  /** Цены «от» по категориям — только агрегаты, «от» не оферта (PRD-06 §1) */
  @Get('prices')
  prices() {
    const release = this.pricing.active();
    const byCategory = new Map<string, number>();
    for (const item of release.items) {
      // Газ и лифты закрыты до договора с лицензиатом (ТЗ 17.8) — на лендинг не выводим
      if (/газ|лифт/i.test(item.category) || /газов|лифт/i.test(item.name)) continue;
      const cur = byCategory.get(item.category);
      if (cur === undefined || item.priceFromTiyin < cur) byCategory.set(item.category, item.priceFromTiyin);
    }
    return {
      releaseNumber: release.number,
      categories: [...byCategory.entries()].map(([category, priceFromTiyin]) => ({ category, priceFromTiyin })),
      note: 'Цена «от» — типовой случай, не оферта. Точная стоимость называется до начала работ.',
    };
  }

  /** Ставки типов объектов для упрощённого калькулятора абонентки (ТЗ 17.2) */
  @Get('object-type-rates')
  objectTypeRates() {
    return this.registry.objectTypeRates.map((r) => ({
      objectType: r.objectType,
      ratePerM2Tiyin: r.ratePerM2Tiyin,
      typicalAreaM2: r.typicalAreaM2,
    }));
  }

  /** L-07: верификация бейджа мастера. Несуществующий код — тот же ответ «недействителен» */
  @Get('master-verify/:code')
  verify(@Param('code') code: string) {
    const m = this.masters.list().find((x) => x.qrBadgeCode === code);
    if (!m || m.status !== 'active') {
      return { valid: false, message: 'НЕДЕЙСТВИТЕЛЕН' };
    }
    // Без телефона и контактов (PRD-06 §3, L-07)
    return {
      valid: true,
      fullName: m.fullName,
      skillTags: m.skillTags,
      grade: m.grade,
      message: 'Действует',
    };
  }

  /**
   * Приём лида с лендинга. B2C → задача «Позвонить» с SLA 10 мин;
   * B2B → лид в реестр A-37 + задача с SLA 4 рабочих часа;
   * кандидат-мастер → карточка в воронке онбординга.
   */
  @Post('leads')
  createLead(@Body() b: {
    kind?: 'b2c' | 'b2b' | 'master';
    phone?: string;
    name?: string;
    company?: string;
    category?: string;
    description?: string;
    pointsCount?: number;
    objectType?: string;
    email?: string;
    skills?: string[];
    experience?: string;
    transport?: string;
    zones?: string[];
    consent?: boolean;
    honeypot?: string;
    utm?: Record<string, string>;
  }) {
    // Антиспам: honeypot — тихий отказ, форма отвечает «успешно» (PRD-06 §4.4)
    if (b?.honeypot) return { accepted: true, ticket: 'SP-' + uuidv7().slice(0, 8) };
    if (!b?.consent) {
      throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Требуется согласие на обработку персональных данных (ЗРУ-547)' });
    }
    if (!b?.phone?.match(/^\+998\d{9}$/)) {
      throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Телефон в формате +998XXXXXXXXX' });
    }
    const kind = b.kind ?? 'b2c';

    if (kind === 'b2b') {
      const lead = { company: b.company ?? '—', contactName: b.name ?? '', phone: b.phone, pointsCount: b.pointsCount ?? 1, objectType: b.objectType, utm: b.utm };
      const rec = { id: uuidv7(), stage: 'new' as const, createdAt: new Date().toISOString(), ...lead };
      this.leads.leads.push(rec);
      this.leads.touch();
      const task = this.publicLeads.add({
        kind: 'b2b_lead',
        title: `КП для «${lead.company}» (${lead.pointsCount} точек)`,
        phone: b.phone,
        payload: { ...lead, leadId: rec.id },
        slaMinutes: 4 * 60, // 4 рабочих часа (параметр №114)
        source: 'landing_b2b',
        utm: b.utm,
      });
      this.audit.write({ actorPhone: 'лендинг', action: 'lead.b2b_created', entity: 'Lead', entityId: rec.id, payload: { company: lead.company } });
      return { accepted: true, ticket: task.id.slice(0, 8).toUpperCase(), slaMinutes: task.slaMinutes };
    }

    if (kind === 'master') {
      const m = this.masters.create({
        fullName: b.name ?? `Кандидат ${b.phone.slice(-4)}`,
        phone: b.phone,
        skillTags: b.skills ?? [],
        taxMode: 'self_employed',
        hasVehicle: b.transport === 'own_car',
      });
      this.masters.update(m.id, { zones: b.zones ?? [] });
      const task = this.publicLeads.add({
        kind: 'master_candidate',
        title: `Анкета мастера: ${m.fullName}`,
        phone: b.phone,
        payload: { masterId: m.id, skills: b.skills, experience: b.experience, transport: b.transport, zones: b.zones },
        slaMinutes: 2 * 24 * 60, // связаться в течение 2 рабочих дней
        source: 'landing_masters',
        utm: b.utm,
      });
      this.audit.write({ actorPhone: 'лендинг', action: 'master.candidate_created', entity: 'MasterProfile', entityId: m.id });
      return { accepted: true, ticket: task.id.slice(0, 8).toUpperCase(), slaMinutes: task.slaMinutes };
    }

    // B2C: SLA перезвона 10 минут (параметр №113, ТЗ 17.15)
    const task = this.publicLeads.add({
      kind: 'b2c_lead',
      title: `Заявка с лендинга: ${b.category ?? 'категория не указана'}`,
      phone: b.phone,
      payload: { name: b.name, category: b.category, description: b.description },
      slaMinutes: 10,
      source: 'landing_b2c',
      utm: b.utm,
    });
    this.audit.write({ actorPhone: 'лендинг', action: 'lead.b2c_created', entity: 'CallTask', entityId: task.id, payload: { category: b.category } });
    return { accepted: true, ticket: task.id.slice(0, 8).toUpperCase(), slaMinutes: 10 };
  }
}

@Module({
  imports: [PricingModule, RegistryModule, MastersModule, LeadsModule],
  controllers: [PublicApiController],
  providers: [PublicLeadsService],
  exports: [PublicLeadsService],
})
export class PublicApiModule {}
