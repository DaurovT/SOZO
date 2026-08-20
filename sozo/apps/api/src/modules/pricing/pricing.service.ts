import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@sozo/kernel';
import catalog from '../../seed/price-catalog.json';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { seedingAllowed } from '../../common/seeding';
import { currentDbContext, systemContext } from '../../common/db-context';
import { registerCatalogNames } from '../../common/locale';

export interface PriceItemRec {
  id: string;
  num: number;
  category: string;
  name: string;
  /**
   * Название для узбекского интерфейса.
   *
   * Ведёт владелец в админке: перевести каталог услуг разработчик не может —
   * это не строки интерфейса, а содержимое бизнеса, и меняется оно вместе с
   * прайсом. Пусто — мастер увидит русское название, и это лучше, чем
   * машинный перевод названия, по которому выставляется счёт.
   */
  nameUz: string | null;
  unit: string;
  priceFromTiyin: number;
  priceToTiyin: number;
  normHours: number | null; // заполняет владелец (DEV-05 п.17) — без них не работает планировщик
  requiredSkills: string[]; // позиция доступна только мастерам с тегом (ТЗ 3.7)
  requiresEquipment: boolean; // фильтр распределения «требует оборудование»
  isPaired: boolean; // цена включает второго исполнителя (ТЗ 4.5)
  isStaged: boolean; // этапная: план этапов с паузами (ТЗ 4.1)
  note: string | null;
}

export interface ReleaseRec {
  id: string;
  number: number;
  status: 'draft' | 'scheduled' | 'active' | 'archived';
  coeffs: Record<string, unknown>;
  items: PriceItemRec[];
  createdAt: string;
  activatedAt?: string;
}

/**
 * pricing (DEV-07 §2 п.5): релизная модель прайса (ТЗ 3.7, A-02…A-05).
 * Боевой прайс нередактируем — правки только в черновике; активация делает снапшот
 * неизменяемым; заявки хранят копии цен, активация ничего не пересчитывает.
 */
@Injectable()
export class PricingService implements OnModuleInit {
  private readonly releases: ReleaseRec[] = [];

  /**
   * Рабочий набор держится в памяти и при работе на базе.
   *
   * Это следует из инварианта самой схемы: активный релиз и его позиции
   * неизменяемы, правки возможны только в черновике. То есть снимок,
   * который читает расчёт заявки, не может устареть по определению —
   * а `active()` зовут синхронно из шести мест в глубине обработки запроса,
   * и переводить их на async ради данных, которые не меняются, значит
   * тронуть заявки, планировщик и клиентские контроллеры без выигрыша.
   *
   * Запись идёт насквозь: каждая мутация сохраняет релиз целиком.
   */
  constructor(
    private readonly store: StateStore,
    private readonly prisma: PrismaService,
  ) {
    // Релиз №1 — импорт из «Каталог_услуг_и_прайсы_v33.xlsx» (M0-E3-S4)
    this.releases.push({
      id: uuidv7(),
      number: 1,
      status: 'active',
      coeffs: catalog.coeffs as Record<string, unknown>,
      items: (catalog.items as Array<{ num: number; category: string; name: string; unit: string; priceFromTiyin: number; priceToTiyin: number; note: string | null }>).map((i) => ({
        ...i,
        id: uuidv7(),
        nameUz: null,
        normHours: null,
        requiredSkills: [],
        requiresEquipment: false,
        isPaired: false,
        isStaged: false,
      })),
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
    });
    this.syncCatalogNames();
    if (!this.prisma.enabled) {
      this.store.register(
        'pricing',
        () => this.releases,
        (d) => {
          this.releases.length = 0;
          // Позиции, заведённые до появления колонки, приходят без неё
          this.releases.push(
            ...((d ?? []) as ReleaseRec[]).map((r) => ({
              ...r,
              items: r.items.map((i) => ({ ...i, nameUz: i.nameUz ?? null })),
            })),
          );
          this.syncCatalogNames();
        },
      );
    }
  }

  /** До первой загрузки в памяти лежит сид из конструктора, а не данные базы */
  private loaded = false;

  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) {
      this.loaded = true;
      return;
    }
    const rows = await this.prisma.withContext(async (tx) =>
      tx.priceListRelease.findMany({ include: { items: true }, orderBy: { number: 'asc' } }),
    );
    if (rows.length === 0 && seedingAllowed()) {
      // Базы ещё нет — записываем стартовый релиз, собранный в конструкторе
      this.loaded = true;
      for (const r of this.releases) await this.saveRelease(r);
      // eslint-disable-next-line no-console
      console.log(`[Pricing] стартовый релиз записан в базу: позиций ${this.releases[0]?.items.length ?? 0}`);
      return;
    }
    this.releases.length = 0;
    for (const r of rows) {
      this.releases.push({
        id: r.id,
        number: r.number,
        status: r.status as ReleaseRec['status'],
        coeffs: (r.coeffsJson ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
        activatedAt: r.activatedAt?.toISOString(),
        items: r.items
          .map((i): PriceItemRec => ({
            id: i.id,
            num: i.num,
            category: i.category,
            name: i.name,
            nameUz: i.nameUz,
            unit: i.unit,
            priceFromTiyin: Number(i.priceFromTiyin),
            priceToTiyin: Number(i.priceToTiyin),
            normHours: i.normHours === null ? null : Number(i.normHours),
            requiredSkills: i.requiredSkills,
            requiresEquipment: i.requiresEquip,
            isPaired: i.isPaired,
            isStaged: i.isStaged,
            note: i.note,
          }))
          .sort((a, b) => a.num - b.num),
      });
    }
    this.loaded = true;
    this.syncCatalogNames();
    // eslint-disable-next-line no-console
    console.log(`[Pricing] релизов из базы: ${this.releases.length}`);
  }

  /**
   * Разовый перенос релизов прайса из state.json (deploy/import-state).
   *
   * Пишется через тот же saveRelease, что и обычная правка: отдельный путь
   * записи для переноса означал бы, что в базу единожды легло не то, что
   * туда кладёт приложение.
   */
  async importFromState(raw: unknown): Promise<number> {
    const list = (raw ?? []) as ReleaseRec[];
    this.releases.length = 0;
    this.releases.push(...list.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, nameUz: i.nameUz ?? null })) })));
    this.syncCatalogNames();
    for (const r of this.releases) await this.saveRelease(r);
    return this.releases.length;
  }

  /**
   * Сохранение релиза целиком. Позиции переписываются, а не сравниваются:
   * правки бывают только в черновике, черновик редактирует один человек, и
   * вычисление разницы здесь — лишний код там, где ошибка означает
   * потерянную или задвоенную строку прайса.
   */
  private async saveRelease(r: ReleaseRec): Promise<void> {
    const tenantId = (currentDbContext() ?? systemContext()).tenantId;
    await this.prisma.withContext(async (tx) => {
      await tx.priceListRelease.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          tenantId,
          number: r.number,
          status: r.status as never,
          coeffsJson: r.coeffs as object,
          activatedAt: r.activatedAt ? new Date(r.activatedAt) : null,
        },
        update: {
          status: r.status as never,
          coeffsJson: r.coeffs as object,
          activatedAt: r.activatedAt ? new Date(r.activatedAt) : null,
        },
      });
      await tx.priceItem.deleteMany({ where: { releaseId: r.id } });
      for (const i of r.items) {
        await tx.priceItem.create({
          data: {
            id: i.id,
            tenantId,
            releaseId: r.id,
            num: i.num,
            category: i.category,
            name: i.name,
            nameUz: i.nameUz,
            unit: i.unit,
            priceFromTiyin: BigInt(i.priceFromTiyin),
            priceToTiyin: BigInt(i.priceToTiyin),
            normHours: i.normHours,
            requiredSkills: i.requiredSkills,
            requiresEquip: i.requiresEquipment,
            isPaired: i.isPaired,
            isStaged: i.isStaged,
            note: i.note,
          },
        });
      }
    });
  }

  /**
   * Запись изменения. На файле — прежний дебаунс, на базе — запись релиза
   * насквозь; ошибку не проглатываем, но и не роняем ею вызывающего:
   * прайс уже изменён в памяти, и молчаливое расхождение с базой хуже
   * строки в журнале.
   */
  /** Удаление черновика: в файле достаточно снимка, в базе нужна явная строка */
  private dropRelease(r: ReleaseRec): void {
    if (!this.prisma.enabled) {
      this.store.persist();
      return;
    }
    if (!this.loaded) return;
    void this.prisma
      .withContext(async (tx) => {
        await tx.priceItem.deleteMany({ where: { releaseId: r.id } });
        await tx.priceListRelease.delete({ where: { id: r.id } });
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[Pricing] черновик не удалён из базы:', (e as Error).message, r.id);
      });
  }

  private persistRelease(r: ReleaseRec | undefined): void {
    if (!this.prisma.enabled) {
      this.store.persist();
      return;
    }
    if (!r || !this.loaded) return;
    void this.saveRelease(r).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[Pricing] релиз не сохранён в базу:', (e as Error).message, r.id);
    });
  }

  list() {
    return this.releases.map(({ items, ...r }) => ({ ...r, itemsCount: items.length }));
  }

  get(id: string): ReleaseRec {
    const r = this.releases.find((x) => x.id === id);
    if (!r) throw new NotFoundException({ code: 'RELEASE_NOT_FOUND' });
    return r;
  }

  active(): ReleaseRec {
    const r = this.releases.find((x) => x.status === 'active');
    if (!r) throw new NotFoundException({ code: 'NO_ACTIVE_RELEASE' });
    return r;
  }

  /** Новый черновик — всегда копия активного релиза (включая откат, ТЗ 3.7) */
  createDraft(): ReleaseRec {
    if (this.releases.some((r) => r.status === 'draft')) {
      throw new BadRequestException({ code: 'DRAFT_EXISTS', message: 'Черновик уже существует — активируйте или удалите его' });
    }
    const src = this.active();
    const draft: ReleaseRec = {
      id: uuidv7(),
      number: Math.max(...this.releases.map((r) => r.number)) + 1,
      status: 'draft',
      coeffs: { ...src.coeffs },
      items: src.items.map((i) => ({ ...i, id: uuidv7() })),
      createdAt: new Date().toISOString(),
    };
    this.releases.push(draft);
    this.persistRelease(draft);
    return draft;
  }

  /**
   * M0-E3-S4: импорт прайса из Excel-выгрузки. Импорт ВСЕГДА создаёт черновик
   * (защита от «цены ×10» на боевом прайсе, ТЗ 3.7); кривые строки — в отчёт, не в базу.
   */
  importRows(rows: Array<Record<string, unknown>>): { release: ReleaseRec; imported: number; errors: Array<{ row: number; reason: string }> } {
    const draft = this.createDraft();
    const errors: Array<{ row: number; reason: string }> = [];
    let imported = 0;
    rows.forEach((raw, idx) => {
      const num = Number(raw.num ?? raw['№']);
      const name = String(raw.name ?? raw['Услуга'] ?? '').trim();
      const from = Number(raw.priceFromSoums ?? raw['B2C от'] ?? raw['B2C от (сум)']);
      const to = Number(raw.priceToSoums ?? raw['B2C до'] ?? raw['B2C до (сум)'] ?? from);
      const normHours = raw.normHours == null || raw.normHours === '' ? null : Number(raw.normHours);
      if (!name) {
        errors.push({ row: idx + 1, reason: 'пустое наименование' });
        return;
      }
      if (!Number.isFinite(from) || from <= 0) {
        errors.push({ row: idx + 1, reason: `цена «от» некорректна: ${String(raw.priceFromSoums ?? raw['B2C от'])}` });
        return;
      }
      if (Number.isFinite(to) && to < from) {
        errors.push({ row: idx + 1, reason: 'цена «до» меньше цены «от»' });
        return;
      }
      const existing = Number.isFinite(num) ? draft.items.find((i) => i.num === num) : draft.items.find((i) => i.name === name);
      if (existing) {
        existing.priceFromTiyin = Math.round(from * 100);
        existing.priceToTiyin = Math.round((Number.isFinite(to) ? to : from) * 100);
        if (normHours !== null && Number.isFinite(normHours)) existing.normHours = normHours;
        if (raw.category) existing.category = String(raw.category);
      } else {
        draft.items.push({
          id: uuidv7(),
          num: Number.isFinite(num) ? num : draft.items.length + 1,
          category: String(raw.category ?? raw['Категория'] ?? 'ИМПОРТ'),
          name,
          // Импорт из Excel перевода не приносит: колонки для него в выгрузке
          // нет, а придумывать её за владельца — значит подсунуть пустую строку
          // вместо честного «не переведено»
          nameUz: raw.nameUz ? String(raw.nameUz).trim() : null,
          unit: String(raw.unit ?? raw['Ед. изм.'] ?? 'шт'),
          priceFromTiyin: Math.round(from * 100),
          priceToTiyin: Math.round((Number.isFinite(to) ? to : from) * 100),
          normHours: normHours !== null && Number.isFinite(normHours) ? normHours : null,
          requiredSkills: [],
          requiresEquipment: false,
          isPaired: false,
          isStaged: false,
          note: raw.note ? String(raw.note) : null,
        });
      }
      imported += 1;
    });
    this.persistRelease(draft);
    return { release: draft, imported, errors };
  }

  updateDraftItem(releaseId: string, itemId: string, patch: Partial<Pick<PriceItemRec, 'priceFromTiyin' | 'priceToTiyin' | 'normHours' | 'note' | 'requiredSkills' | 'requiresEquipment' | 'isPaired' | 'isStaged'>>): PriceItemRec {
    const r = this.get(releaseId);
    if (r.status !== 'draft') throw new BadRequestException({ code: 'RELEASE_IMMUTABLE', message: 'Правки только в черновике (ТЗ 3.7)' });
    const item = r.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND' });
    Object.assign(item, patch);
    this.persistRelease(r);
    return item;
  }

  /**
   * Узбекское название правится и в активном релизе — в отличие от всего
   * остального.
   *
   * Боевой прайс нередактируем, потому что по нему выставлены счета: цена,
   * состав работ, нормо-часы менять задним числом нельзя. Подпись на другом
   * языке ничего из этого не меняет — она не участвует ни в деньгах, ни в
   * планировании. Держать перевод в заложниках у релиза значило бы, что до
   * ближайшей смены цен узбекский мастер читает каталог по-русски.
   */
  setNameUz(releaseId: string, itemId: string, nameUz: string | null): PriceItemRec {
    const r = this.get(releaseId);
    const item = r.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND' });
    item.nameUz = nameUz?.trim() ? nameUz.trim() : null;
    this.persistRelease(r);
    this.syncCatalogNames();
    return item;
  }

  /** Отдаём переводы активного релиза слою локализации */
  syncCatalogNames(): void {
    const act = this.releases.find((r) => r.status === 'active');
    registerCatalogNames((act?.items ?? []).filter((i) => !!i.nameUz).map((i) => [i.name, i.nameUz!] as [string, string]));
  }

  /** Сколько позиций ещё без перевода — показываем владельцу, а не молчим */
  untranslated(releaseId?: string): { total: number; missing: number; items: Array<{ id: string; num: number; category: string; name: string }> } {
    const r = releaseId ? this.get(releaseId) : this.active();
    const items = r.items.filter((i) => !i.nameUz);
    return {
      total: r.items.length,
      missing: items.length,
      items: items.map((i) => ({ id: i.id, num: i.num, category: i.category, name: i.name })),
    };
  }

  /** Diff черновика с активным — обязательный шаг перед активацией (A-03) */
  diff(releaseId: string) {
    const draft = this.get(releaseId);
    const act = this.active();
    const byNum = new Map(act.items.map((i) => [i.num, i]));
    const changes = draft.items
      .map((d) => {
        const prev = byNum.get(d.num);
        if (!prev) return { num: d.num, name: d.name, kind: 'added' as const };
        if (prev.priceFromTiyin !== d.priceFromTiyin || prev.priceToTiyin !== d.priceToTiyin) {
          return {
            num: d.num,
            name: d.name,
            kind: 'price_changed' as const,
            from: [prev.priceFromTiyin, prev.priceToTiyin],
            to: [d.priceFromTiyin, d.priceToTiyin],
            growth: prev.priceFromTiyin ? d.priceFromTiyin / prev.priceFromTiyin - 1 : null,
          };
        }
        return null;
      })
      .filter(Boolean);
    return { changedShare: changes.length / Math.max(act.items.length, 1), changes };
  }

  /** Удаление черновика (боевые релизы неизменяемы — только архивируются) */
  deleteDraft(releaseId: string): void {
    const r = this.get(releaseId);
    if (r.status !== 'draft') {
      throw new BadRequestException({ code: 'ONLY_DRAFT_DELETABLE', message: 'Удалить можно только черновик; откат боевого — новым релизом (ТЗ 3.7)' });
    }
    this.releases.splice(this.releases.indexOf(r), 1);
    this.dropRelease(r);
  }

  /**
   * F-019: валидатор unit-экономики (A-05). Маржа подписки =
   * канальный коэффициент − доля мастера − резервный фонд − норматив комиссий.
   * Позиции с маржой ниже порога блокируют активацию — «работа в минус» невозможна.
   */
  unitEconomics(releaseId: string) {
    const r = this.get(releaseId);
    const c = r.coeffs as Record<string, number>;
    const subscriptionK = (1 + (c.b2bOneOffMarkup ?? 0.3)) * (1 - (c.subscriptionDiscount ?? 0.1)); // ≈1.17
    const masterShare = (c.masterSharePermille ?? 550) / 1000; // 0.55
    const reserveRate = 0.015; // резервный фонд (ТЗ 17.7)
    const providerFee = 0.02; // норматив комиссий провайдеров
    const marginRate = subscriptionK - masterShare - reserveRate - providerFee;
    const minMargin = 0.15; // порог маржи (параметр)
    const minCheck = c.minCheckB2cTiyin ?? 10_000_000;

    const problems = r.items
      .filter((i) => i.priceFromTiyin > 0)
      .map((i) => {
        const revenue = i.priceFromTiyin * subscriptionK;
        const costs = i.priceFromTiyin * masterShare + revenue * (reserveRate + providerFee);
        const margin = revenue - costs;
        const marginPercent = revenue > 0 ? margin / revenue : 0;
        const issues: string[] = [];
        if (marginPercent < minMargin) issues.push(`маржа ${(marginPercent * 100).toFixed(1)}% ниже порога ${(minMargin * 100).toFixed(0)}%`);
        if (i.priceFromTiyin < minCheck && !/выезд|диагностик|минимальн/i.test(i.name)) {
          issues.push(`цена ниже минимального чека ${Math.round(minCheck / 100)} сум — добивается позицией «Минимальный заказ»`);
        }
        if (i.priceToTiyin < i.priceFromTiyin) issues.push('верхняя граница вилки меньше нижней');
        return issues.length ? { num: i.num, name: i.name, marginPercent, issues } : null;
      })
      .filter(Boolean) as Array<{ num: number; name: string; marginPercent: number; issues: string[] }>;

    const blocking = problems.filter((p) => p.issues.some((t) => t.startsWith('маржа') || t.startsWith('верхняя')));
    return {
      subscriptionK: Number(subscriptionK.toFixed(4)),
      masterShare,
      reserveRate,
      providerFee,
      marginRate: Number(marginRate.toFixed(4)),
      minMargin,
      itemsChecked: r.items.length,
      problems,
      blockingCount: blocking.length,
      ok: blocking.length === 0,
    };
  }

  /**
   * Активация: diff → валидатор unit-экономики → архив старого. Крупный релиз
   * (>20% позиций или цена >30%) требует второго админа (ТЗ 3.7) — передаётся флагом.
   */
  activate(releaseId: string, opts: { secondAdminConfirmed?: boolean; overrideEconomics?: boolean; overrideComment?: string }) {
    const draft = this.get(releaseId);
    if (draft.status !== 'draft') throw new BadRequestException({ code: 'NOT_A_DRAFT', message: 'Менять можно только черновик релиза: действующий прайс нередактируем' });

    // Блокирующий валидатор: сохранение «в минус» — только с комментарием в аудит (A-05)
    const econ = this.unitEconomics(releaseId);
    if (!econ.ok && !opts.overrideEconomics) {
      throw new BadRequestException({
        code: 'UNIT_ECONOMICS_FAILED',
        message: `Валидатор unit-экономики: ${econ.blockingCount} позиций работают в минус или с маржой ниже ${(econ.minMargin * 100).toFixed(0)}%. Активация заблокирована (F-019).`,
        problems: econ.problems.slice(0, 10),
      });
    }
    if (!econ.ok && opts.overrideEconomics && !opts.overrideComment) {
      throw new BadRequestException({ code: 'OVERRIDE_COMMENT_REQUIRED', message: 'Обход валидатора требует комментария (уходит в аудит)' });
    }

    const d = this.diff(releaseId);
    const bigGrowth = d.changes.some((c) => c && c.kind === 'price_changed' && (c.growth ?? 0) > 0.3);
    if ((d.changedShare > 0.2 || bigGrowth) && !opts.secondAdminConfirmed) {
      throw new BadRequestException({
        code: 'SECOND_ADMIN_REQUIRED',
        message: 'Крупный релиз (>20% позиций или рост цены >30%): требуется подтверждение второго админа',
      });
    }
    const prev = this.active();
    prev.status = 'archived';
    draft.status = 'active';
    draft.activatedAt = new Date().toISOString();
    // Оба релиза меняются одной операцией: прежний уходит в архив, новый
    // становится боевым — записывать надо оба, иначе после рестарта окажется
    // два активных или ни одного
    this.persistRelease(prev);
    this.persistRelease(draft);
    this.syncCatalogNames(); // активным стал другой релиз — переводы едут с ним
    // side-effects M2+: событие pricelist.release_activated → инвалидация кешей, уведомления за 7/10 дней.
    // Проводок и пересчётов НЕ порождает (железное правило владельца, PRD-05 §4.4 п.20)
    return draft;
  }
}
