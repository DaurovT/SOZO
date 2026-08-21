import { useT } from '../i18n';
import { zoneLabel } from '../lib/catalog';
import type { Master } from '../lib/team';

/**
 * Лента мастеров с прокруткой и «прилипанием» карточек (scroll-snap).
 * На мобильном листается пальцем, на десктопе показывает 4 карточки в ряд.
 */
export default function MasterRail(props: { masters: Master[] }) {
  const t = useT();
  return (
    <div className="masters-rail" role="list">
      {props.masters.map((m) => {
        const name = t(m.nameKey);
        const role = t(m.roleKey);
        return (
          <article className="master" key={m.id} role="listitem">
            <img
              src={m.photo}
              alt={t('components.masterRail.photoAlt', { name, role: role.toLowerCase() })}
              loading="lazy"
              decoding="async"
              width={760}
              height={950}
            />
            <div className="master-top">
              {/* Показываем то, что можем подтвердить: проверку навыков и договор.
                  Рейтингов и счётчиков заявок на витрине нет — см. lib/team.ts. */}
              <span className="chip chip-grade">{t('components.masterRail.verified')}</span>
            </div>
            <div className="master-body">
              <span className="master-name">{name}</span>
              <span className="master-role">{role}</span>
              <div className="master-meta">
                <span>
                  <strong>{m.years}</strong> {t('unit.years')}
                </span>
                <span>{zoneLabel(m.zone, t)}</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
