import type { Master } from '../lib/team';

/**
 * Лента мастеров с прокруткой и «прилипанием» карточек (scroll-snap).
 * На мобильном листается пальцем, на десктопе показывает 4 карточки в ряд.
 */
export default function MasterRail(props: { masters: Master[] }) {
  return (
    <div className="masters-rail" role="list">
      {props.masters.map((m) => (
        <article className="master" key={m.id} role="listitem">
          <img
            src={m.photo}
            alt={`${m.name} — ${m.role.toLowerCase()} SOZO`}
            loading="lazy"
            decoding="async"
            width={760}
            height={950}
          />
          <div className="master-top">
            {/* Показываем то, что можем подтвердить: проверку навыков и договор.
                Рейтингов и счётчиков заявок на витрине нет — см. lib/team.ts. */}
            <span className="chip chip-grade">Проверен</span>
          </div>
          <div className="master-body">
            <span className="master-name">{m.name}</span>
            <span className="master-role">{m.role}</span>
            <div className="master-meta">
              <span>
                <strong>{m.years} лет</strong> в профессии
              </span>
              <span>{m.zone}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
