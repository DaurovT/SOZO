import { ReactNode } from 'react';
import { getUser } from '../auth';

/**
 * Показывать содержимое только тем, у кого есть роль.
 *
 * Проверка на сервере есть у каждого действия и остаётся главной: этот
 * компонент ничего не защищает, он избавляет от лишнего разговора. Бухгалтер
 * видел активные кнопки «Заблокировать», «Активировать релиз», «Расторгнуть
 * договор» и узнавал об отказе только после нажатия — интерфейс обещал то,
 * чего не давал.
 *
 * Страницы при этом не прячем: смотреть бухгалтеру можно всё, ограничены
 * именно действия. Скрывать целые разделы значило бы мешать работе.
 */
export function RoleGate({ roles, children, fallback }: { roles: string[]; children: ReactNode; fallback?: ReactNode }) {
  const user = getUser();
  const allowed = (user?.roles ?? []).some((r) => roles.includes(r));
  if (!allowed) return <>{fallback ?? null}</>;
  return <>{children}</>;
}

/** То же самое условием — когда прятать надо не узел, а элемент списка */
export function hasRole(...roles: string[]): boolean {
  const user = getUser();
  return (user?.roles ?? []).some((r) => roles.includes(r));
}
