import type { ReactNode } from 'react';

/** Рамка телефона. Внутри — обычная вёрстка на тех же токенах, что и приложение. */
export function Phone(props: { children: ReactNode; label?: string }) {
  return (
    <div className="phone" role="img" aria-label={props.label ?? 'Экран приложения SOZO'}>
      <div className="phone-notch" aria-hidden="true" />
      <div className="phone-screen">{props.children}</div>
    </div>
  );
}

/** Строка-карточка внутри экрана приложения. */
export function AppRow(props: {
  title: string;
  sub?: string;
  badge?: string;
  badgeTone?: 'live' | 'ok' | 'soft';
  children?: ReactNode;
}) {
  const tone =
    props.badgeTone === 'live'
      ? ' app-badge--live'
      : props.badgeTone === 'ok'
        ? ' app-badge--ok'
        : '';
  return (
    <div className="app-row">
      <div className="app-row-top">
        <span className="app-title">{props.title}</span>
        {props.badge && <span className={`app-badge${tone}`}>{props.badge}</span>}
      </div>
      {props.sub && <span className="app-sub">{props.sub}</span>}
      {props.children}
    </div>
  );
}

/** Нижний таббар-заглушка: показывает, что это приложение, а не веб-страница. */
export function AppTabbar(props: { active?: number }) {
  const active = props.active ?? 0;
  return (
    <div className="app-tabbar" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`app-tab${i === active ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}
