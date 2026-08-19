import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { PricingService } from './pricing.service';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

@Controller('admin/price-releases')
@UseGuards(AuthGuard)
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return this.pricing.list();
  }

  @Get(':id')
  @Roles('admin', 'accountant')
  get(@Param('id') id: string) {
    return this.pricing.get(id);
  }

  @Post()
  @Roles('admin')
  createDraft(@Req() req: { auth: JwtClaims }) {
    const draft = this.pricing.createDraft();
    this.audit.write({ actorPhone: req.auth.phone, action: 'price_release.draft_created', entity: 'PriceListRelease', entityId: draft.id });
    return draft;
  }

  @Patch(':id/items/:itemId')
  @Roles('admin')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() patch: { priceFromTiyin?: number; priceToTiyin?: number; normHours?: number | null; note?: string | null },
  ) {
    return this.pricing.updateDraftItem(id, itemId, patch);
  }

  /**
   * Узбекское название — единственная правка, разрешённая в активном релизе.
   *
   * Отдельным эндпоинтом, а не полем в общем патче: тот справедливо отказывает
   * всему, что не черновик, и смешивать «поменять цену» с «дописать подпись»
   * в одной ручке — верный способ однажды пропустить первое под видом второго.
   */
  @Patch(':id/items/:itemId/name-uz')
  @Roles('admin')
  setNameUz(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() b: { nameUz?: string | null },
    @Req() req: { auth: JwtClaims },
  ) {
    const item = this.pricing.setNameUz(id, itemId, b?.nameUz ?? null);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'price_item.name_uz_set',
      entity: 'PriceListItem',
      entityId: itemId,
      payload: { num: item.num, nameUz: item.nameUz },
    });
    return item;
  }

  /** Сколько позиций ещё без узбекского названия — вход в работу для владельца */
  @Get('translation/status')
  @Roles('admin', 'accountant')
  translationStatus() {
    const a = this.pricing.untranslated();
    return {
      ...a,
      note:
        a.missing === 0
          ? 'Каталог переведён целиком'
          : 'Позиции без перевода мастер и клиент видят по-русски — это лучше машинного перевода названия, по которому выставляется счёт',
    };
  }

  @Get(':id/diff')
  @Roles('admin')
  diff(@Param('id') id: string) {
    return this.pricing.diff(id);
  }

  @Delete(':id')
  @Roles('admin')
  deleteDraft(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    this.pricing.deleteDraft(id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'price_release.draft_deleted', entity: 'PriceListRelease', entityId: id });
    return { deleted: true };
  }

  /** F-019: отчёт валидатора unit-экономики по релизу */
  @Get(':id/unit-economics')
  @Roles('admin', 'accountant')
  unitEconomics(@Param('id') id: string) {
    return this.pricing.unitEconomics(id);
  }

  /** M0-E3-S4: импорт строк прайса → всегда новый черновик + отчёт об ошибках */
  @Post('import')
  @Roles('admin')
  import(@Body() body: { rows?: Array<Record<string, unknown>> }, @Req() req: { auth: JwtClaims }) {
    const rows = body?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException({ code: 'ROWS_REQUIRED', message: 'Передайте строки прайса (CSV/Excel → JSON)' });
    }
    const res = this.pricing.importRows(rows);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'price_release.imported',
      entity: 'PriceListRelease',
      entityId: res.release.id,
      payload: { imported: res.imported, errors: res.errors.length },
    });
    return { releaseId: res.release.id, number: res.release.number, imported: res.imported, errors: res.errors, itemsTotal: res.release.items.length };
  }

  @Post(':id/activate')
  @Roles('admin')
  activate(
    @Param('id') id: string,
    @Body() body: { secondAdminConfirmed?: boolean; overrideEconomics?: boolean; overrideComment?: string },
    @Req() req: { auth: JwtClaims },
  ) {
    const release = this.pricing.activate(id, body ?? {});
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'price_release.activated',
      entity: 'PriceListRelease',
      entityId: release.id,
      payload: body?.overrideEconomics ? { economicsOverride: true, comment: body.overrideComment } : undefined,
    });
    return release;
  }
}
