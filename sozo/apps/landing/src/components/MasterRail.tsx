import { useT, useTn } from '../i18n';
import { zoneLabel } from '../lib/catalog';
import type { Master } from '../lib/team';

/**
 * Лента мастеров с прокруткой и «прилипанием» карточек (scroll-snap).
 * На мобильном листается пальцем, на десктопе показывает 4 карточки в ряд.
 */
/**
 * «12 лет опыта», где само число выделено.
 *
 * Строку целиком отдаёт словарь, а не JSX: раньше число стояло в разметке, а
 * слово подставлялось через пробел — и этот пробел ехал во все языки. По-
 * корейски и по-китайски перед единицей его не ставят, по-арабски четыре года
 * и двенадцать лет требуют разных форм слова, а где стоит число, вообще решает
 * язык. Поэтому здесь мы только находим число в готовой фразе и оборачиваем
 * его в `<strong>`; если язык его не показывает, вернётся фраза без выделения.
 */
function yearsWithBold(phrase: string, years: number) {
  const at = phrase.indexOf(String(years));
  if (at < 0) return phrase;
  return (
    <>
      {phrase.slice(0, at)}
      <strong>{years}</strong>
      {phrase.slice(at + String(years).length)}
    </>
  );
}

export default function MasterRail(props: { masters: Master[] }) {
  const t = useT();
  const tn = useTn();
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
                <span>{yearsWithBold(tn('unit.years', m.years), m.years)}</span>
                <span>{zoneLabel(m.zone, t)}</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
