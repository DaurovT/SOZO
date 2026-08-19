import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchPrices } from '../api';
import {
  ConsentCheckbox,
  Done,
  Field,
  Honeypot,
  PhoneField,
  SubmitError,
} from '../components/form';
import { displayCategory, FALLBACK_CATEGORIES } from '../lib/catalog';
import { DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { MASTERS } from '../lib/team';
import { formatSla } from '../lib/format';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useLeadSubmit } from '../lib/useLeadSubmit';
import { useResource } from '../lib/useResource';

/** Если клиент не выбрал категорию — заявка идёт как выезд с диагностикой. */
const DEFAULT_CATEGORY = 'ВЫЕЗД И ДИАГНОСТИКА';

export default function Order() {
  const [params] = useSearchParams();
  const prices = useResource(fetchPrices, []);

  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const { pending, error, result, submit } = useLeadSubmit();

  const categories =
    prices.status === 'ready' ? prices.data.categories.map((c) => c.category) : FALLBACK_CATEGORIES;

  const canSubmit = isPhoneValid(phone) && consent && !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await submit(
      {
        kind: 'b2c',
        phone: toE164(phone),
        consent: true,
        category: category || DEFAULT_CATEGORY,
        description: description.trim() || undefined,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title="Заявка принята"
        lead={`Перезвоним в течение ${formatSla(result.slaMinutes, '10 минут')}, чтобы уточнить детали и согласовать время приезда.`}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/" className="btn btn-secondary">
            На главную
          </Link>
        </div>
      </Done>
    );
  }

  return (
    <section className="section-lg">
      <div className="wrap">
        <div className="form-layout">
          <div className="stack-lg">
            <div className="section-head">
              <p className="eyebrow">Заявка</p>
              <h1 className="h2">Вызвать мастера</h1>
              <p className="lead">
                Оставьте телефон — диспетчер перезвонит, уточнит задачу и согласует время приезда.
              </p>
            </div>

            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <Honeypot value={honeypot} onChange={setHoneypot} />

              <PhoneField digits={phone} onChange={setPhone} />

              <Field id="category" label="Категория работ">
                <select
                  id="category"
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Не знаю — определит диспетчер</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {displayCategory(c)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id="description"
                label="Что случилось"
                hint="Необязательно. Пара слов помогает подобрать мастера и запчасти."
              >
                <textarea
                  id="description"
                  className="textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  placeholder="Например: течёт смеситель на кухне, капает под мойку"
                />
              </Field>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <SubmitError message={error} />

              <button type="submit" className="btn btn-block" disabled={!canSubmit}>
                {pending ? 'Отправляем…' : 'Отправить'}
              </button>

              <p className="small muted">
                Нажимая «Отправить», вы соглашаетесь с{' '}
                <Link to="/legal#offer">условиями публичной оферты</Link>.
              </p>
            </form>
          </div>

          <aside className="form-aside">
            <div className="aside-card stack">
              <h2 className="h3">Что будет дальше</h2>
              <ol className="stack-sm">
                <li className="tick">
                  <span>Перезвоним за 10 минут и уточним, что случилось</span>
                </li>
                <li className="tick">
                  <span>Подберём мастера и согласуем удобное время приезда</span>
                </li>
                <li className="tick">
                  <span>Мастер назовёт цену до начала работ — вы решаете, делать или нет</span>
                </li>
                <li className="tick">
                  <span>Пришлём фото до и после и акт с гарантией на 30 дней</span>
                </li>
              </ol>
              <div className="aside-faces">
                <div className="faces" aria-hidden="true">
                  {MASTERS.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.photo} alt="" loading="lazy" />
                  ))}
                </div>
                <p className="small muted">Работают проверенные мастера с бейджем и договором</p>
              </div>
            </div>

            <div className="aside-card aside-dark stack-sm">
              <p className="small muted">Не терпит — течёт, искрит, нет света?</p>
              <a className="aside-tel" href={DISPATCH_TEL_HREF}>
                {DISPATCH_TEL_DISPLAY}
              </a>
              <p className="small muted">Аварийные заявки принимаем круглосуточно.</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
