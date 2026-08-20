import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { ParametersService } from './parameters.service';
import { AuditService } from './audit.service';
import type { JwtClaims } from '../../common/jwt';

@Controller('admin')
@UseGuards(AuthGuard)
export class PlatformController {
  constructor(
    private readonly parameters: ParametersService,
    private readonly audit: AuditService,
  ) {}

  /** A-05: сводная таблица параметров (PRD-04 §5) */
  @Get('parameters')
  @Roles('admin', 'accountant')
  list() {
    return this.parameters.list();
  }

  @Put('parameters/:num')
  @Roles('admin') // бухгалтер параметры не редактирует (PRD-04 §6)
  async update(@Param('num') num: string, @Body() body: { value: string }, @Req() req: { auth: JwtClaims }) {
    // Аудит пишется после успешной записи: строка «параметр изменён» при
    // неудавшемся изменении хуже, чем её отсутствие
    const updated = await this.parameters.update(Number(num), String(body.value));
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'parameter.updated',
      entity: 'SystemParameter',
      entityId: num,
      payload: { value: body.value },
    });
    return updated;
  }

  /**
   * A-33: аудит-лог с фильтрами.
   *
   * Без них журнал бесполезен ровно тогда, когда нужен: разбор всегда начинается
   * с «что происходило по этой заявке» или «что делал этот человек», а сотня
   * последних записей отвечает на другой вопрос.
   *
   * `q` ищет сразу по телефону, действию и идентификатору: разбирающий редко
   * знает заранее, в каком поле лежит то, что он помнит.
   */
  @Get('audit')
  @Roles('admin', 'accountant')
  auditLog(
    @Query('limit') limit?: string,
    @Query('actor') actor?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('q') q?: string,
  ) {
    return this.audit.search({
      limit: limit ? Number(limit) : 100,
      actor,
      entity,
      entityId,
      action,
      q,
    });
  }

  /** Из чего строить выпадающие фильтры — берём то, что реально встречалось */
  @Get('audit/facets')
  @Roles('admin', 'accountant')
  auditFacets() {
    return this.audit.facets();
  }
}
