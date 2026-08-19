import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { COMPANY, DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';

const OFFER_SECTIONS = [
  'Предмет договора и порядок акцепта оферты',
  'Порядок оформления заявки и согласования окна приезда',
  'Стоимость работ, прайс-лист и порядок расчётов',
  'Гарантия на выполненные работы (30 дней) и порядок обращения по гарантии',
  'Права и обязанности сторон',
  'Ответственность и порядок возмещения ущерба',
  'Порядок разрешения споров',
  'Реквизиты исполнителя',
];

export default function Legal() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg">
        <h1 className="h2">Документы и контакты</h1>

        <article id="offer" className="card stack">
          <h2 className="h3">Публичная оферта</h2>
          <p className="stub-note">
            Текст готовится юристом. Ниже — состав документа, который будет опубликован до запуска
            приёма оплат.
          </p>
          <ol className="stack-sm">
            {OFFER_SECTIONS.map((s, i) => (
              <li key={s} className="step">
                <span className="usp-num">{String(i + 1).padStart(2, '0')}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </article>

        <article id="privacy" className="card stack">
          <h2 className="h3">Политика обработки персональных данных</h2>
          <p className="stub-note">Финальная редакция готовится юристом.</p>
          <p className="muted">
            Обработка персональных данных ведётся в соответствии с Законом Республики Узбекистан «О
            персональных данных» (ЗРУ-547). Оставляя заявку, вы даёте согласие на обработку
            указанных вами данных.
          </p>
          <div className="stack-sm">
            <p>
              <strong>Какие данные собираем:</strong> имя, номер телефона, адрес объекта, email (для
              корпоративных клиентов), содержание обращения.
            </p>
            <p>
              <strong>Зачем:</strong> приём и выполнение заявок, связь с клиентом, гарантийное
              обслуживание, ведение расчётов.
            </p>
            <p>
              <strong>Где храним:</strong> базы данных и резервные копии размещаются на серверах,
              расположенных на территории Республики Узбекистан.
            </p>
            <p>
              <strong>Отзыв согласия:</strong> по телефону диспетчерской службы. После отзыва данные
              удаляются, кроме сведений, которые компания обязана хранить по закону.
            </p>
          </div>
        </article>

        <article id="contacts" className="card stack">
          <h2 className="h3">Контакты</h2>
          <dl>
            <div className="kv">
              <dt>Диспетчерская</dt>
              <dd>
                <a href={DISPATCH_TEL_HREF}>{DISPATCH_TEL_DISPLAY}</a>
              </dd>
            </div>
            <div className="kv">
              <dt>Режим работы</dt>
              <dd>Ежедневно, аварийные заявки — круглосуточно</dd>
            </div>
            <div className="kv">
              <dt>Адрес</dt>
              <dd>г. Ташкент (адрес офиса уточняется)</dd>
            </div>
            <div className="kv">
              <dt>Компания</dt>
              <dd>{COMPANY}</dd>
            </div>
          </dl>
          <p className="stub-note">
            Юридический адрес, ИНН и банковские реквизиты будут указаны после регистрации
            юридического лица.
          </p>
        </article>
      </div>
    </section>
  );
}
