import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put, Req, UseGuards, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { PgMirror } from '../../common/pg-mirror';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * Промокоды — MVP по ТЗ 15 (решение №13): скидка применяется ПОСЛЕДНЕЙ к итогу работ,
 * долю мастера не трогает (доля всегда от базовой B2C, ТЗ 3.7).
 */

/** Код, который получает каждый новый клиент — показывается в приложении сам */
export const WELCOME_CODE = 'SOZO15';
export interface PromoCodeRec {
  id: string;
  code: string;
  discountPercent: number; // 1–50
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  comment?: string;
  createdAt: string;
  /**
   * Только на первый заказ.
   *
   * Приветственный код теряет смысл, если им пользуется постоянный клиент:
   * он оплачивает привлечение того, кто уже пришёл. Проверяем по истории
   * заявок, а не по дате регистрации — человек мог завести аккаунт год назад
   * и ни разу не вызвать мастера.
   */
  firstOrderOnly?: boolean;
  /** Один код — один раз на человека: иначе скидка становится постоянной ценой */
  usedByPhones?: string[];
}

/** Почему код не подошёл — в терминах, которые можно показать человеку */
export type PromoVerdict = {
  valid: boolean;
  discountPercent: number;
  message: string;
  firstOrderOnly: boolean;
};

@Injectable()
export class PromoService implements OnModuleInit {
  readonly codes: PromoCodeRec[] = [
    { id: uuidv7(), code: 'SALOM10', discountPercent: 10, active: true, maxUses: 100, usedCount: 0, comment: 'Промо запуска', createdAt: new Date().toISOString() },
    {
      id: uuidv7(),
      code: WELCOME_CODE,
      discountPercent: 15,
      active: true,
      maxUses: null,
      usedCount: 0,
      comment: 'Приветственный — только на первую заявку',
      createdAt: new Date().toISOString(),
      firstOrderOnly: true,
      usedByPhones: [],
    },
  ];

  private readonly mirror: PgMirror;

  constructor(
    private readonly store: StateStore,
    prisma: PrismaService,
  ) {
    this.store.register(
      'promo',
      () => this.codes,
      (d) => {
        this.codes.length = 0;
        this.codes.push(...(d as PromoCodeRec[]));
        this.ensureWelcome();
      },
    );
    this.mirror = new PgMirror(prisma, 'Promo', {
      load: async (tx) => {
        const rows = await tx.promoCode.findMany({ include: { uses: true } });
        if (!rows.length) return 0;
        this.codes.length = 0;
        this.codes.push(
          ...rows.map((r) => ({
            id: r.id,
            code: r.code,
            discountPercent: r.discountPercent,
            active: r.active,
            maxUses: r.maxUses,
            usedCount: r.usedCount,
            comment: r.comment ?? undefined,
            createdAt: r.createdAt.toISOString(),
            firstOrderOnly: r.firstOrderOnly,
            usedByPhones: r.uses.map((u) => u.phone),
          })),
        );
        this.ensureWelcome();
        return rows.length;
      },
      save: async (tx, tenantId) => {
        for (const c of this.codes) {
          const data = {
            code: c.code,
            discountPercent: c.discountPercent,
            active: c.active,
            maxUses: c.maxUses,
            usedCount: c.usedCount,
            comment: c.comment ?? null,
            firstOrderOnly: Boolean(c.firstOrderOnly),
          };
          await tx.promoCode.upsert({
            where: { id: c.id },
            create: { id: c.id, tenantId, createdAt: new Date(c.createdAt), ...data },
            update: data,
          });
          // Использования — своя таблица: по ним проверяется «только первый
          // заказ» и считается стоимость кампании. Уникальность (код, телефон)
          // держит база, поэтому повтор молча пропускается
          for (const phone of c.usedByPhones ?? []) {
            await tx.promoUse.upsert({
              where: { promoCodeId_phone: { promoCodeId: c.id, phone } },
              create: { id: uuidv7(), tenantId, promoCodeId: c.id, phone },
              update: {},
            });
          }
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

  /**
   * Приветственный код должен существовать и в уже сохранённой базе.
   *
   * Список кампаний грузится с диска и затирает тот, что объявлен в поле
   * класса: новый код, добавленный в код программы, до этой проверки просто
   * не существовал — приложение предлагало скидку, которой сервер не знал.
   */
  private ensureWelcome(): void {
    if (this.codes.some((c) => c.code === WELCOME_CODE)) return;
    this.codes.push({
      id: uuidv7(),
      code: WELCOME_CODE,
      discountPercent: 15,
      active: true,
      maxUses: null,
      usedCount: 0,
      comment: 'Приветственный — только на первую заявку',
      createdAt: new Date().toISOString(),
      firstOrderOnly: true,
      usedByPhones: [],
    });
    this.store.persist();
  }

  /** Возвращает скидку в процентах или бросает ошибку; учитывает лимит использований */
  /**
   * Проверка без списания — для экрана «Итог» в приложении клиента (C-13).
   * Списывает промокод только создание заявки: иначе проверка сожгла бы код,
   * а заявки бы не случилось.
   */
  peek(code: string): number {
    const p = this.find(code);
    if (!p || !p.active) return 0;
    if (p.maxUses !== null && p.usedCount >= p.maxUses) return 0;
    return p.discountPercent;
  }

  find(code: string): PromoCodeRec | undefined {
    return this.codes.find((c) => c.code.toLowerCase() === (code ?? '').trim().toLowerCase());
  }

  /**
   * Подходит ли код этому человеку прямо сейчас.
   *
   * Проверка без списания и с объяснением: «промокод не найден» на код,
   * который человек только что получил от нас же, выглядит как обман. Причина
   * отказа у каждого случая своя, и она важнее самого факта отказа.
   */
  evaluate(code: string, ctx: { phone: string; isFirstOrder: boolean }): PromoVerdict {
    const p = this.find(code);
    const no = (message: string): PromoVerdict => ({ valid: false, discountPercent: 0, message, firstOrderOnly: false });
    if (!p || !p.active) return no('Промокод не найден или истёк');
    if (p.maxUses !== null && p.usedCount >= p.maxUses) return no('Лимит использований промокода исчерпан');
    if ((p.usedByPhones ?? []).includes(ctx.phone)) return no('Этот промокод вы уже использовали');
    if (p.firstOrderOnly && !ctx.isFirstOrder) return no('Промокод только для первой заявки');
    return {
      valid: true,
      discountPercent: p.discountPercent,
      message: `Скидка ${p.discountPercent}%`,
      firstOrderOnly: p.firstOrderOnly === true,
    };
  }

  /** Списание с привязкой к человеку: код сгорает лично у него, а не вообще */
  redeemFor(code: string, phone: string, isFirstOrder: boolean): number {
    const verdict = this.evaluate(code, { phone, isFirstOrder });
    if (!verdict.valid) throw new BadRequestException({ code: 'PROMO_INVALID', message: verdict.message });
    const p = this.find(code)!;
    p.usedCount += 1;
    p.usedByPhones = [...(p.usedByPhones ?? []), phone];
    this.store.persist();
    return p.discountPercent;
  }

  redeem(code: string): number {
    const p = this.find(code);
    if (!p || !p.active) throw new BadRequestException({ code: 'PROMO_INVALID', message: 'Промокод не найден или отключён' });
    if (p.maxUses !== null && p.usedCount >= p.maxUses) {
      throw new BadRequestException({ code: 'PROMO_EXHAUSTED', message: 'Лимит использований промокода исчерпан' });
    }
    p.usedCount += 1;
    this.store.persist();
    return p.discountPercent;
  }

  touch(): void {
    this.store.persist();
  }
}

@Controller('admin/promo-codes')
@UseGuards(AuthGuard)
export class PromoController {
  constructor(
    private readonly promo: PromoService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return this.promo.codes;
  }

  @Post()
  @Roles('admin')
  create(@Body() b: { code: string; discountPercent: number; maxUses?: number | null; comment?: string }, @Req() req: { auth: JwtClaims }) {
    if (!b.code?.trim()) throw new BadRequestException({ code: 'CODE_REQUIRED' });
    if (!b.discountPercent || b.discountPercent < 1 || b.discountPercent > 50) {
      throw new BadRequestException({ code: 'DISCOUNT_RANGE', message: 'Скидка 1–50%' });
    }
    if (this.promo.codes.some((c) => c.code.toLowerCase() === b.code.trim().toLowerCase())) {
      throw new BadRequestException({ code: 'CODE_EXISTS' });
    }
    const rec: PromoCodeRec = {
      id: uuidv7(),
      code: b.code.trim().toUpperCase(),
      discountPercent: b.discountPercent,
      active: true,
      maxUses: b.maxUses ?? null,
      usedCount: 0,
      comment: b.comment,
      createdAt: new Date().toISOString(),
    };
    this.promo.codes.push(rec);
    this.promo.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: 'promo.created', entity: 'PromoCode', entityId: rec.id, payload: { code: rec.code } });
    return rec;
  }

  @Put(':id')
  @Roles('admin')
  toggle(@Param('id') id: string, @Body() b: { active?: boolean }, @Req() req: { auth: JwtClaims }) {
    const rec = this.promo.codes.find((c) => c.id === id);
    if (!rec) throw new NotFoundException({ code: 'PROMO_NOT_FOUND' });
    if (typeof b.active === 'boolean') rec.active = b.active;
    this.promo.touch();
    this.audit.write({ actorPhone: req.auth.phone, action: 'promo.toggled', entity: 'PromoCode', entityId: id, payload: { active: rec.active } });
    return rec;
  }
}

@Module({
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
