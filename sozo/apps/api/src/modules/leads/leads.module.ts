import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Req, UseGuards, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { AuditService } from '../platform/audit.service';
import { CrmService } from '../crm/crm.service';
import { CrmModule } from '../crm/crm.module';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import type { JwtClaims } from '../../common/jwt';

/**
 * A-37: реестр B2B-лидов (ТЗ 17.15, 17.2). Воронка: лид → демо → аудит → КП → договор.
 * Роли «менеджер продаж» в MVP нет — задачи падают админу. Правило лид-контура:
 * у каждого лида либо открытая задача, либо терминальный исход с причиной.
 */
export const LEAD_STAGES = ['new', 'demo', 'audit', 'proposal', 'contract', 'rejected'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface LeadRec {
  id: string;
  company: string;
  contactName: string;
  phone: string;
  pointsCount: number;
  objectType?: string;
  stage: LeadStage;
  rejectReason?: string;
  utm?: Record<string, string>;
  note?: string;
  organizationId?: string; // после конвертации
  nextTouchAt?: string;
  createdAt: string;
}

@Injectable()
export class LeadsService implements OnModuleInit {
  readonly leads: LeadRec[] = [];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.leads.push({
      id: uuidv7(),
      company: 'Сеть кофеен «Дон» (демо-лид)',
      contactName: 'Умид',
      phone: '+998935554433',
      pointsCount: 4,
      objectType: 'кафе',
      stage: 'new',
      utm: { utm_source: 'instagram', utm_campaign: 'b2b_launch' },
      createdAt: new Date().toISOString(),
    });
    this.store.register(
      'leads',
      () => this.leads,
      (d) => {
        this.leads.length = 0;
        this.leads.push(...(d as LeadRec[]));
      },
    );
    this.mirror = new PgMirror(prisma, 'Leads', {
      load: async (tx) => {
        const rows = await tx.lead.findMany({ orderBy: { createdAt: 'asc' } });
        if (!rows.length) return 0;
        this.leads.length = 0;
        this.leads.push(
          ...rows.map((r) => ({
            id: r.id,
            company: r.company,
            contactName: r.contactName,
            phone: r.phone,
            pointsCount: r.pointsCount,
            objectType: r.objectType ?? undefined,
            stage: r.stage as LeadRec['stage'],
            rejectReason: r.rejectReason ?? undefined,
            utm: (r.utm as Record<string, string>) ?? undefined,
            note: r.note ?? undefined,
            organizationId: r.organizationId ?? undefined,
            nextTouchAt: r.nextTouchAt?.toISOString(),
            createdAt: r.createdAt.toISOString(),
          })),
        );
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const l of this.leads) {
          const data = {
            company: l.company,
            contactName: l.contactName,
            phone: l.phone,
            pointsCount: l.pointsCount,
            objectType: l.objectType ?? null,
            stage: l.stage,
            rejectReason: l.rejectReason ?? null,
            utm: (l.utm ?? {}) as object,
            note: l.note ?? null,
            organizationId: l.organizationId ?? null,
            nextTouchAt: l.nextTouchAt ? new Date(l.nextTouchAt) : null,
          };
          await tx.lead.upsert({
            where: { id: l.id },
            create: { id: l.id, tenantId, createdAt: new Date(l.createdAt), ...data },
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

  touch(): void {
    this.store.persist();
  }

  get(id: string): LeadRec {
    const l = this.leads.find((x) => x.id === id);
    if (!l) throw new NotFoundException({ code: 'LEAD_NOT_FOUND' });
    return l;
  }
}

@Controller('admin/leads')
@UseGuards(AuthGuard)
export class LeadsController {
  constructor(
    private readonly svc: LeadsService,
    private readonly crm: CrmService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return [...this.svc.leads].reverse();
  }

  @Post()
  @Roles('admin')
  create(@Body() body: any) {
    const lead: LeadRec = {
      id: uuidv7(),
      company: body.company,
      contactName: body.contactName ?? '',
      phone: body.phone,
      pointsCount: body.pointsCount ?? 1,
      objectType: body.objectType,
      stage: 'new',
      note: body.note,
      utm: body.utm,
      createdAt: new Date().toISOString(),
    };
    this.svc.leads.push(lead);
    this.svc.touch();
    return lead;
  }

  /** Движение по воронке; отклонение — только с причиной */
  @Put(':id/stage')
  @Roles('admin')
  setStage(@Param('id') id: string, @Body() body: { stage: LeadStage; rejectReason?: string; note?: string }, @Req() req: { auth: JwtClaims }) {
    const lead = this.svc.get(id);
    if (!LEAD_STAGES.includes(body.stage)) throw new BadRequestException({ code: 'STAGE_UNKNOWN' });
    if (body.stage === 'rejected' && !body.rejectReason) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Терминальный исход — только с причиной (лид-контур PRD-06 §4.1)' });
    }
    lead.stage = body.stage;
    lead.rejectReason = body.rejectReason;
    if (body.note) lead.note = body.note;
    this.svc.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: `lead.${body.stage}`, entity: 'Lead', entityId: id });
    return lead;
  }

  /** Конвертация в организацию с наследованием UTM (событие contract.signed_from_lead) */
  @Post(':id/convert')
  @Roles('admin')
  convert(@Param('id') id: string, @Body() body: { subscriptionTiyin?: number; inn?: string }, @Req() req: { auth: JwtClaims }) {
    const lead = this.svc.get(id);
    if (lead.organizationId) throw new BadRequestException({ code: 'ALREADY_CONVERTED' });
    const org = this.crm.create({
      name: lead.company,
      inn: body.inn ?? '',
      vatPayer: false,
      contractType: body.subscriptionTiyin ? 'subscription' : 'one_off',
      contractKind: 'monthly',
      subscriptionTiyin: body.subscriptionTiyin ?? null,
    });
    lead.stage = 'contract';
    lead.organizationId = org.id;
    this.svc.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: 'lead.converted', entity: 'Lead', entityId: id, payload: { organizationId: org.id, utm: lead.utm } });
    return { lead, organization: org };
  }
}

@Module({
  imports: [CrmModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
