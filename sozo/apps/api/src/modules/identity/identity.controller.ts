import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { AuthGuard, Roles } from './auth.guard';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('request-otp')
  requestOtp(@Body() body: { phone?: string }) {
    if (!body?.phone?.match(/^\+998\d{9}$/)) {
      throw new BadRequestException({ code: 'PHONE_INVALID', message: 'Формат: +998XXXXXXXXX' });
    }
    return this.identity.requestOtp(body.phone);
  }

  @Post('verify')
  verify(@Body() body: { phone?: string; code?: string }) {
    if (!body?.phone || !body?.code) throw new BadRequestException({ code: 'FIELDS_REQUIRED' });
    return this.identity.verify(body.phone, body.code);
  }
}

/** A-10: пользователи и роли (read-only до RBAC-редактора) */
@Controller('admin/users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  list() {
    return this.identity.list();
  }

  /**
   * Журнал входов.
   *
   * Объявлен до `:id`, иначе Nest примет «login-log» за идентификатор.
   * Неудачные попытки важнее удачных: серия отказов по одному номеру —
   * это подбор, а не забывчивость.
   */
  @Get('login-log')
  @Roles('admin')
  loginLog() {
    const events = this.identity.loginLog();
    return {
      events,
      failed: events.filter((e) => !e.ok).length,
      note: 'Хранятся последние 2000 событий: это оперативный журнал, а не архив',
    };
  }

  /** A-10: назначение ролей (матрица прав ТЗ 2.3) */
  @Put(':id/roles')
  @Roles('admin')
  setRoles(@Param('id') id: string, @Body() body: { roles?: string[] }, @Req() req: { auth: JwtClaims }) {
    const user = this.identity.setRoles(id, body?.roles ?? []);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'user.roles_changed',
      entity: 'User',
      entityId: id,
      payload: { roles: user.roles },
    });
    return user;
  }

  /**
   * Закрыть доступ сотруднику или вернуть его.
   *
   * Учётная запись не удаляется: её след остаётся в аудите, и человек,
   * чьи действия там записаны, должен оставаться опознаваемым.
   */
  @Post(':id/block')
  @Roles('admin')
  block(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: { auth: JwtClaims }) {
    const user = this.identity.setBlocked(id, true, body?.reason);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'user.blocked',
      entity: 'User',
      entityId: id,
      payload: { phone: user.phone, reason: user.blockedReason },
    });
    return user;
  }

  @Post(':id/unblock')
  @Roles('admin')
  unblock(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const user = this.identity.setBlocked(id, false);
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'user.unblocked',
      entity: 'User',
      entityId: id,
      payload: { phone: user.phone },
    });
    return user;
  }
}
