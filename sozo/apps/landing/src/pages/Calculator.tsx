import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { fetchObjectTypeRates, type ObjectTypeRate } from '../api';
import {
  ConsentCheckbox,
  Done,
  Field,
  Honeypot,
  PhoneField,
  Stepper,
  SubmitError,
} from '../components/form';
import { FALLBACK_OBJECT_TYPES } from '../lib/catalog';
import { formatSla, formatSum, formatTiyin, plural } from '../lib/format';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useLeadSubmit } from '../lib/useLeadSubmit';
import { useResource } from '../lib/useResource';

/** Итог округляем вверх до 100 000 сум = 10 000 000 тийин. */
const ROUND_STEP_TIYIN = 100_000 * 100;

function monthlyTiyin(rate: ObjectTypeRate, points: number): number {
  const raw = rate.ratePerM2Tiyin * rate.typicalAreaM2 * points;
  return Math.ceil(raw / ROUND_STEP_TIYIN) * ROUND_STEP_TIYIN;
}

export default function Calculator() {
  const rates = useResource(fetchObjectTypeRates, []);

  const [points, setPoints] = useState(1);
  const [objectType, setObjectType] = useState('');

  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const { pending, error, result, submit } = useLeadSubmit();

  const rateList = rates.status === 'ready' ? rates.data : [];
  const typeNames =
    rates.status === 'ready' ? rateList.map((r) => r.objectType) : FALLBACK_OBJECT_TYPES;
  const selected = rateList.find((r) => r.objectType === objectType) ?? null;
  const total = selected ? monthlyTiyin(selected, points) : null;

  const canSubmit =
    isPhoneValid(phone) && consent && company.trim() !== '' && name.trim() !== '' && !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await submit(
      {
        kind: 'b2b',
        phone: toE164(phone),
        consent: true,
        name: name.trim(),
        company: company.trim(),
        pointsCount: points,
        objectType: objectType || typeNames[0],
        email: email.trim() || undefined,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title="Заявка на КП принята"
        lead={`Свяжемся в течение ${formatSla(result.slaMinutes, '4 рабочих часов')}, чтобы согласовать аудит объектов и подготовить коммерческое предложение.`}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/business" className="btn btn-secondary">
            Вернуться к описанию
          </Link>
        </div>
      </Done>
    );
  }

  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg">
        <div className="section-head">
          <h1 className="h2">Калькулятор абонентки</h1>
          <p className="lead">
            Прикиньте ежемесячный бюджет на обслуживание сети. Расчёт ориентировочный.
          </p>
        </div>

        <div className="card stack-lg">
          <Stepper
            label="Число точек"
            value={points}
            min={1}
            max={50}
            onChange={setPoints}
            suffix={plural(points, 'точка', 'точки', 'точек')}
          />

          <Field id="objectType" label="Тип объекта">
            <select
              id="objectType"
              className="select"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
            >
              <option value="">Выберите тип объекта</option>
              {typeNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {total !== null && selected && (
          <div className="result stack">
            <div className="stack-sm">
              <p className="muted">Ориентировочно</p>
              <p className="result-value">{formatTiyin(total)}/мес</p>
            </div>
            <dl className="result-rows">
              <div className="result-row">
                <span>Ставка</span>
                <span>{formatSum(selected.ratePerM2Tiyin / 100)} сум/м²</span>
              </div>
              <div className="result-row">
                <span>Типовая площадь</span>
                <span>{selected.typicalAreaM2} м²</span>
              </div>
              <div className="result-row">
                <span>Точек</span>
                <span>{points}</span>
              </div>
            </dl>
            <p className="small muted">Точный расчёт — в КП после аудита объекта.</p>
          </div>
        )}

        {rates.status === 'error' && (
          <p className="stub-note">
            Справочник ставок сейчас недоступен, поэтому сумма не рассчитывается. Оставьте заявку —
            посчитаем вручную и пришлём КП.
          </p>
        )}

        {rates.status === 'ready' && (
          <p className="small muted">
            Ставки и типовые площади — из справочника ставок A-29 (публичный API
            <code> /v1/public/object-type-rates</code>). Итог округляется вверх до 100 000 сум.
          </p>
        )}

        <div className="section-head">
          <h2 className="h2">Получить коммерческое предложение</h2>
          <p className="lead">Подготовим КП по вашим объектам после короткого аудита.</p>
        </div>

        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <Honeypot value={honeypot} onChange={setHoneypot} />

          <Field id="company" label="Компания" required>
            <input
              id="company"
              className="input"
              type="text"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
            />
          </Field>

          <Field id="name" label="Имя" required>
            <input
              id="name"
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>

          <PhoneField digits={phone} onChange={setPhone} />

          <Field id="email" label="Email" hint="Необязательно. Пришлём КП на почту.">
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </Field>

          <ConsentCheckbox checked={consent} onChange={setConsent} />

          <SubmitError message={error} />

          <button type="submit" className="btn btn-block" disabled={!canSubmit}>
            {pending ? 'Отправляем…' : 'Получить КП'}
          </button>
        </form>
      </div>
    </section>
  );
}
