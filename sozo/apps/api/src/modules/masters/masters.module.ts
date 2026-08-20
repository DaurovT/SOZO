import { Body, Controller, Get, Module, OnModuleInit, Param, Post, Put, UseGuards, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { IdentityService } from '../identity/identity.service';
import { StateStore } from '../../common/state-store';
import { dbFailure } from '../../common/db-failure';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { seedingAllowed } from '../../common/seeding';
import { currentDbContext, systemContext } from '../../common/db-context';

export interface MasterRec {
  id: string;
  fullName: string;
  phone: string;
  status: 'candidate' | 'checking' | 'training' | 'active' | 'blocked' | 'offboarding';
  skillTags: string[];
  skillExams: Array<{ skill: string; passedAt: string; examiner: string }>; // новые теги — только через экзамен (ТЗ 17.1)
  zones: string[];
  transport: 'own_car' | 'public' | 'none';
  rating: number; // MVP — вручную диспетчером/админом (ТЗ 7.4)
  grade: 'bronze' | 'silver' | 'gold';
  taxMode: 'self_employed' | 'gph';
  gphContractUntil: string | null; // ГПХ срочный: алерт за 14 дней (A-11)
  documents: Array<{ name: string; status: 'uploaded' | 'verified' | 'missing' }>;
  hasVehicle: boolean;
  cashDebtTiyin: number;
  qrBadgeCode: string;
  referrerName?: string;
  /** Код мастера, который привёл: связка для реферальной программы (ТЗ 18 п.11) */
  referrerCode?: string;
  /** Когда выплачен бонус пригласившему — отметку ставит бухгалтер */
  referralBonusPaidAt?: string;
  /**
   * Последняя позиция из приложения мастера. Пишется только по событиям
   * конвейера — постоянной слежки нет (ТЗ 17.5). Карта диспетчера
   * показывает её, пока у мастера есть активный визит.
   */
  lastGeo?: { lat: number; lng: number; at: string };
  /**
   * Глубина офлайн-очереди в приложении мастера на момент последней связи.
   *
   * Считать её на сервере нельзя: очередь живёт на телефоне и существует
   * именно тогда, когда телефон недоступен. Поэтому приложение само сообщает
   * её при каждом успешном обращении — и мониторинг видит, у кого копится.
   */
  offlineQueue?: { depth: number; oldestAt?: string; at: string };
  offboardingNote?: string;
  createdAt: string;
}

/** masters (DEV-07 §2 п.7): онбординг-воронка A-11/A-12, скиллы — только через экзамен */
@Injectable()
export class MastersService implements OnModuleInit {
  private readonly masters: MasterRec[] = [
    {
      id: uuidv7(),
      fullName: 'Алишер Каримов (демо)',
      phone: '+998901234567',
      status: 'active',
      skillTags: ['сантехника', 'электрика'],
      skillExams: [
        { skill: 'сантехника', passedAt: '2026-06-02', examiner: 'Техлид' },
        { skill: 'электрика', passedAt: '2026-06-15', examiner: 'Техлид' },
      ],
      zones: ['Чиланзар', 'Яккасарай'],
      transport: 'own_car',
      rating: 78,
      grade: 'silver',
      taxMode: 'self_employed',
      gphContractUntil: null,
      documents: [
        { name: 'Паспорт', status: 'verified' },
        { name: 'Справка о статусе самозанятого (Soliq)', status: 'verified' },
        { name: 'Фото инструмента по ToolChecklist', status: 'verified' },
      ],
      hasVehicle: true,
      cashDebtTiyin: 0,
      qrBadgeCode: 'm7kX9qLp2Rw4',
      createdAt: new Date().toISOString(),
    },
    {
      id: uuidv7(),
      fullName: 'Бахтиёр Тошматов (демо)',
      phone: '+998907654321',
      status: 'active',
      skillTags: ['кондиционеры'],
      skillExams: [{ skill: 'кондиционеры', passedAt: '2026-05-20', examiner: 'Техлид' }],
      zones: ['Юнусабад', 'Мирзо-Улугбек'],
      transport: 'own_car',
      rating: 88,
      grade: 'silver', // Золото требует >85 И ≥100 закрытых заявок (ТЗ 7.4)
      taxMode: 'gph',
      gphContractUntil: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), // истекает через 10 дней → алерт
      documents: [
        { name: 'Паспорт', status: 'verified' },
        { name: 'Договор ГПХ', status: 'verified' },
        { name: 'Фото инструмента по ToolChecklist', status: 'missing' },
      ],
      hasVehicle: true,
      cashDebtTiyin: 45_000_000,
      qrBadgeCode: 'aQ3nZx8Tf5Vy',
      // Связь по коду, а не по имени: имя в демо-данных совпадало с фамилией
      // мастера лишь по совпадению и рвалось при любом переименовании
      referrerName: 'Алишер Каримов (демо)',
      referrerCode: 'm7kX9qLp2Rw4',
      createdAt: new Date().toISOString(),
    },
  ];

  list() {
    return this.masters;
  }

  /**
   * Набор в памяти и при работе на базе — как у CRM и прайса, и по той же
   * причине: карточку мастера читают синхронно из лент, распределения и
   * расчёта доли, а писатель один.
   */
  constructor(
    private readonly store: StateStore,
    private readonly identity: IdentityService,
    private readonly prisma: PrismaService,
  ) {
    if (!this.prisma.enabled) {
      this.store.register(
        'masters',
        () => this.masters,
        (d) => {
          this.masters.length = 0;
          this.masters.push(...((d ?? []) as MasterRec[]));
        },
      );
    }
    // Телефон из карточки мастера даёт роль master при входе (PRD-02 §2)
    this.identity.registerRoleProvider((phone) => (this.masters.some((m) => m.phone === phone) ? ['master'] : []));
  }

  private loaded = false;

  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const rows = await this.prisma.withContext(async (tx) => tx.masterProfile.findMany());
    if (rows.length === 0 && seedingAllowed()) {
      this.loaded = true;
      for (const m of this.masters) await this.saveMaster(m);
      // eslint-disable-next-line no-console
      console.log(`[Masters] демо-карточки записаны в базу: ${this.masters.length}`);
      return;
    }
    this.masters.length = 0;
    for (const r of rows) {
      this.masters.push({
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        status: r.status as MasterRec['status'],
        skillTags: r.skillTags,
        skillExams: (r.skillExamsJson ?? []) as MasterRec['skillExams'],
        zones: r.zoneIds,
        transport: (r.transport ?? undefined) as MasterRec['transport'],
        rating: r.rating,
        grade: r.grade as MasterRec['grade'],
        taxMode: r.taxMode as MasterRec['taxMode'],
        gphContractUntil: r.contractUntil ? r.contractUntil.toISOString().slice(0, 10) : null,
        documents: (r.documentsJson ?? []) as MasterRec['documents'],
        hasVehicle: r.hasVehicle,
        cashDebtTiyin: Number(r.cashDebtTiyin),
        qrBadgeCode: r.qrBadgeCode ?? undefined,
        referrerName: r.referrerName ?? undefined,
        referrerCode: r.referrerCode ?? undefined,
        referralBonusPaidAt: r.referralBonusPaidAt?.toISOString(),
        lastGeo: (r.lastGeoJson ?? undefined) as MasterRec['lastGeo'],
        offlineQueue: (r.offlineQueueJson ?? undefined) as MasterRec['offlineQueue'],
        offboardingNote: r.offboardingNote ?? undefined,
      } as MasterRec);
    }
    this.loaded = true;
    // eslint-disable-next-line no-console
    console.log(`[Masters] карточек из базы: ${this.masters.length}`);
  }

  /** Разовый перенос карточек мастеров из state.json (deploy/import-state) */
  async importFromState(raw: unknown): Promise<number> {
    this.masters.length = 0;
    this.masters.push(...((raw ?? []) as MasterRec[]));
    for (const m of this.masters) await this.saveMaster(m);
    return this.masters.length;
  }

  private async saveMaster(m: MasterRec): Promise<void> {
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    const data = {
      phone: m.phone,
      fullName: m.fullName,
      status: m.status,
      skillTags: m.skillTags ?? [],
      zoneIds: (m.zones ?? []) as string[],
      transport: m.transport ?? null,
      rating: m.rating ?? 60,
      grade: m.grade ?? 'bronze',
      taxMode: m.taxMode ?? 'self_employed',
      contractUntil: m.gphContractUntil ? new Date(m.gphContractUntil) : null,
      hasVehicle: Boolean(m.hasVehicle),
      cashDebtTiyin: BigInt(Math.max(0, m.cashDebtTiyin ?? 0)),
      qrBadgeCode: m.qrBadgeCode ?? null,
      referrerName: m.referrerName ?? null,
      referrerCode: m.referrerCode ?? null,
      referralBonusPaidAt: m.referralBonusPaidAt ? new Date(m.referralBonusPaidAt) : null,
      offboardingNote: m.offboardingNote ?? null,
      skillExamsJson: (m.skillExams ?? []) as object,
      documentsJson: (m.documents ?? []) as object,
      lastGeoJson: (m.lastGeo ?? Prisma.DbNull) as Prisma.InputJsonValue,
      offlineQueueJson: (m.offlineQueue ?? Prisma.DbNull) as Prisma.InputJsonValue,
    };
    await this.prisma.withContext(async (tx) => {
      await tx.masterProfile.upsert({
        where: { id: m.id },
        create: { id: m.id, tenantId, ...data },
        update: data,
      });
    });
  }

  /** Запись изменения: до загрузки в памяти демо-карточки, а не данные */
  private persistMasters(): void {
    if (!this.prisma.enabled) {
      this.store.persist();
      return;
    }
    if (!this.loaded) return;
    void (async () => {
      for (const m of this.masters) await this.saveMaster(m);
    })().catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[Masters] изменение не сохранено в базу:', dbFailure(e));
    });
  }

  get(id: string): MasterRec {
    const m = this.masters.find((x) => x.id === id);
    if (!m) throw new NotFoundException({ code: 'MASTER_NOT_FOUND' });
    return m;
  }

  create(data: Pick<MasterRec, 'fullName' | 'phone' | 'skillTags' | 'taxMode' | 'hasVehicle'>): MasterRec {
    const m: MasterRec = {
      id: uuidv7(),
      ...data,
      status: 'candidate',
      skillExams: [],
      zones: [],
      transport: data.hasVehicle ? 'own_car' : 'public',
      rating: 60, // стартовый (ТЗ 7.4)
      grade: 'bronze',
      gphContractUntil: null,
      documents: [
        { name: 'Паспорт', status: 'missing' },
        { name: 'Статус Soliq / договор ГПХ', status: 'missing' },
        { name: 'Фото инструмента по ToolChecklist', status: 'missing' },
      ],
      cashDebtTiyin: 0,
      qrBadgeCode: uuidv7().replace(/-/g, '').slice(0, 12),
      createdAt: new Date().toISOString(),
    };
    this.masters.push(m);
    this.persistMasters();
    return m;
  }

  /**
   * Наличные на руках у мастера (ТЗ 8.2). Плюс — принял оплату, минус — сдал в кассу.
   * Отдельный метод, а не поле в update: долг двигают только две операции, и обе
   * должны быть видны в аудите.
   */
  adjustCashDebt(id: string, deltaTiyin: number): MasterRec {
    const m = this.get(id);
    m.cashDebtTiyin = Math.max(0, m.cashDebtTiyin + deltaTiyin);
    this.persistMasters();
    return m;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        MasterRec,
        | 'status'
        | 'rating'
        | 'grade'
        | 'skillTags'
        | 'zones'
        | 'gphContractUntil'
        | 'transport'
        | 'lastGeo'
        | 'offlineQueue'
        | 'referrerCode'
        | 'referrerName'
        | 'referralBonusPaidAt'
      >
    >,
  ): MasterRec {
    const m = this.masters.find((x) => x.id === id);
    if (!m) throw new NotFoundException({ code: 'MASTER_NOT_FOUND' });
    Object.assign(m, patch);
    this.persistMasters();
    return m;
  }
}

@Controller('admin/masters')
@UseGuards(AuthGuard)
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return this.masters.list();
  }

  /** A-12: воронка онбординга (ТЗ 17.1) */
  @Get('funnel')
  @Roles('admin', 'accountant')
  funnel() {
    const all = this.masters.list();
    const stages = ['candidate', 'checking', 'training', 'active', 'blocked'] as const;
    return stages.map((s) => ({ stage: s, count: all.filter((m) => m.status === s).length, masters: all.filter((m) => m.status === s) }));
  }

  @Post()
  @Roles('admin')
  create(@Body() body: any) {
    return this.masters.create({
      fullName: body.fullName,
      phone: body.phone,
      skillTags: body.skillTags ?? [],
      taxMode: body.taxMode ?? 'self_employed',
      hasVehicle: !!body.hasVehicle,
    });
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() patch: any) {
    return this.masters.update(id, patch);
  }

  /** Экзамен по skill-тегу: новые теги — только через экзамен (ТЗ 17.1) */
  @Post(':id/skill-exam')
  @Roles('admin')
  skillExam(@Param('id') id: string, @Body() b: { skill: string; examiner?: string }) {
    const m = this.masters.get(id);
    if (!b.skill) throw new NotFoundException({ code: 'SKILL_REQUIRED' });
    m.skillExams.push({ skill: b.skill, passedAt: new Date().toISOString().slice(0, 10), examiner: b.examiner ?? 'Админ' });
    if (!m.skillTags.includes(b.skill)) m.skillTags.push(b.skill);
    this.masters.update(id, {});
    return m;
  }

  /** Офбординг (ТЗ 8.6): снятие с линии → заморозка выплат → взаимозачёт → акт сверки */
  @Post(':id/offboard')
  @Roles('admin')
  offboard(@Param('id') id: string) {
    const m = this.masters.get(id);
    m.status = 'offboarding';
    m.offboardingNote =
      'Активные заявки — в очередь переназначения; выплаты заморожены до акта сверки; взаимозачёт наличного долга; финальная выплата/взыскание (ТЗ 8.6)';
    this.masters.update(id, {});
    return m;
  }
}

@Module({
  controllers: [MastersController],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
