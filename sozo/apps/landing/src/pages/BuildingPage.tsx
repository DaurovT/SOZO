import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { useT } from '../i18n';
import { fetchBuilding, submitDemand, type PublicBuilding } from '../api';

/**
 * L-10. Публичная страница объекта (PRD-06 §3.11).
 *
 * Два назначения сразу. Для человека, пришедшего по QR с наклейки в подъезде,
 * первым экраном — кнопка звонка: он хочет вызвать мастера, а не читать.
 * Для неподключённого дома — сбор спроса: житель видит, чего лишён, и это
 * дешевле холодных звонков в его УК.
 *
 * Персональные данные жителей и заявки здесь не публикуются никогда.
 */

export default function BuildingPage() {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<PublicBuilding | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    // Страница неподключённого объекта не должна попадать в поиск:
    // иначе мы засорим выдачу пустыми карточками чужих домов
    document.title = t('building.metaTitle');
    fetchBuilding(code ?? '')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [code, t]);

  // Имя обработчика намеренно отличается от submitDemand из api: одноимённая
  // локальная функция перекрывала импорт и вызывала саму себя — форма уходила
  // в бесконечную рекурсию вместо запроса
  async function onDemandSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Ошибку сети не показываем: человек уже нажал, повторять ему нечего,
    // а спрос — не заявка, чтобы ради него городить экран отказа
    await submitDemand(address, phone).catch(() => undefined);
    setSent(true);
  }

  if (loading) return <section className="section"><div className="wrap"><p className="muted">{t('building.loading')}</p></div></section>;

  const connected = data?.connectionStatus === 'active';

  return (
    <>
      <section className="hero">
        <div className="wrap stack-lg">
          <div className="stack">
            {/* Первым экраном — звонок: пришедший по QR хочет вызвать мастера */}
            <a className="btn" href={DISPATCH_TEL_HREF} style={{ fontSize: 20, padding: '18px 28px' }}>
              {t('building.callMaster', { phone: DISPATCH_TEL_DISPLAY })}
            </a>
            {data && (
              <>
                <h1 className="h2">{data.name}</h1>
                <p className="muted">{data.address}</p>
              </>
            )}
          </div>
        </div>
      </section>

      {connected && data && (
        <>
          {data.emergencyPhone && (
            <section className="section section-alt">
              <div className="wrap stack">
                <h2 className="h3">{t('building.emergencyTitle')}</h2>
                <a className="btn btn-secondary" href={`tel:${data.emergencyPhone}`}>{data.emergencyPhone}</a>
                {data.operatorName && (
                  <p className="small muted">
                    {t('building.operator', { operator: data.operatorName })}
                  </p>
                )}
              </div>
            </section>
          )}

          {data.shutdowns.length > 0 && (
            <section className="section">
              <div className="wrap stack">
                <h2 className="h3">{t('building.shutdownsTitle')}</h2>
                {data.shutdowns.map((s, i) => (
                  <article className="card stack-sm" key={i}>
                    <b>{s.resourceLabel}</b>
                    <p className="muted">{s.windowText}</p>
                    <p className="small muted">{s.reason}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="section section-alt">
            <div className="wrap stack">
              <h2 className="h3">{t('building.appTitle')}</h2>
              <p className="lead">{t('building.appLead')}</p>
              <Link className="btn" to="/">{t('building.appCta')}</Link>
            </div>
          </section>
        </>
      )}

      {!connected && (
        <section className="section section-alt">
          <div className="wrap stack">
            <h2 className="h3">{t('building.demandTitle')}</h2>
            <p className="lead">{t('building.demandLead')}</p>

            {sent ? (
              <div className="card">
                <b>{t('building.demandSentTitle')}</b>
                <p className="muted">{t('building.demandSentLead')}</p>
              </div>
            ) : (
              <form className="stack" onSubmit={onDemandSubmit}>
                <div className="field">
                  <label className="field-label" htmlFor="addr">{t('building.demandAddressLabel')}</label>
                  <input
                    id="addr"
                    className="input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t('building.demandAddressPlaceholder')}
                    required
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="ph">{t('building.demandPhoneLabel')}</label>
                  <input
                    id="ph"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+998"
                  />
                </div>
                <button className="btn" type="submit">{t('building.demandSubmit')}</button>
              </form>
            )}
          </div>
        </section>
      )}
    </>
  );
}
