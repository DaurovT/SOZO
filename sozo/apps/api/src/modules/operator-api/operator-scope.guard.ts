import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtClaims } from '../../common/jwt';
import { EventBus } from '../../common/event-bus';

/**
 * Скоуп кабинета оператора: `orgId` из адреса должен принадлежать тому, кто
 * пришёл с этим токеном.
 *
 * Комментарий в контроллере обещал, что скоуп проверяется здесь, — а на деле
 * `orgId` не сверялся ни с чем. `GET /operator/<любой orgId>/people` отдавал
 * весь персонал чужого оператора: телефоны, имена, роли на объектах. Хуже
 * того, `POST /operator/<любой orgId>/masters` заводил карточку мастера и тут
 * же переводил её в active — то есть любой валидный токен превращался в
 * доступ ко всему контуру `/v1/master/*` через MasterGuard, который пускает
 * по совпадению телефона и статусу.
 *
 * Принадлежность считается по штату объектов: человек в этом контуре
 * существует как роль на объекте, отдельного реестра пользователей оператора
 * нет (см. U-14). Админ и диспетчер платформы видят все кабинеты — это их
 * работа.
 */
@Injectable()
export class OperatorScopeGuard implements CanActivate {
  /**
   * Принадлежность спрашивается справкой через шину, а не импортом модуля
   * объектов: этот guard стоит и на кабинете оператора, и на его подписке, а
   * модуль подписок объекты импортировать не может — объекты импортируют его
   * (DEV-07 §3 п.8), и вышел бы цикл.
   */
  constructor(private readonly bus: EventBus) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ params: Record<string, string>; auth?: JwtClaims }>();
    const orgId = req.params?.orgId;
    if (!orgId) return true; // маршрут без кабинета — проверять нечего
    const claims = req.auth;
    if (!claims) throw new ForbiddenException({ code: 'TOKEN_INVALID' });
    if (claims.roles?.some((r) => r === 'admin' || r === 'dispatcher')) return true;
    const answers = this.bus.probe<{ phone: string; operatorOrgId: string }, boolean>('buildings.is_operator_staff', {
      phone: claims.phone,
      operatorOrgId: orgId,
    });
    if (answers.some(Boolean)) return true;
    throw new ForbiddenException({
      code: 'OPERATOR_FORBIDDEN',
      message: 'Кабинет принадлежит другой эксплуатирующей организации',
    });
  }
}
