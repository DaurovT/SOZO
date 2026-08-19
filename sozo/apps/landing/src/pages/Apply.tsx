import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MASTERS } from '../lib/team';
import {
  CheckItem,
  ConsentCheckbox,
  Done,
  Field,
  Honeypot,
  PhoneField,
  RadioGroup,
  SubmitError,
} from '../components/form';
import { SKILLS, ZONES } from '../lib/catalog';
import { formatSla } from '../lib/format';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useLeadSubmit } from '../lib/useLeadSubmit';

type Experience = '<1' | '1-3' | '3-5' | '5+';
type Transport = 'own_car' | 'public' | 'none';

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: '<1', label: 'Меньше 1 года' },
  { value: '1-3', label: '1–3 года' },
  { value: '3-5', label: '3–5 лет' },
  { value: '5+', label: 'Больше 5 лет' },
];

const TRANSPORT: { value: Transport; label: string }[] = [
  { value: 'own_car', label: 'Свой автомобиль' },
  { value: 'public', label: 'Общественный транспорт' },
  { value: 'none', label: 'Нет транспорта' },
];

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export default function Apply() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  const { pending, error, result, submit } = useLeadSubmit();

  const canSubmit =
    isPhoneValid(phone) &&
    consent &&
    name.trim() !== '' &&
    skills.length > 0 &&
    experience !== null &&
    transport !== null &&
    !pending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || experience === null || transport === null) return;
    await submit(
      {
        kind: 'master',
        phone: toE164(phone),
        consent: true,
        name: name.trim(),
        skills,
        experience,
        transport,
        zones,
      },
      honeypot,
    );
  }

  if (result) {
    return (
      <Done
        title="Анкета принята"
        lead={`Свяжемся в течение ${formatSla(result.slaMinutes, '2 рабочих дней')}, чтобы обсудить условия и назначить практический экзамен.`}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/masters" className="btn btn-secondary">
            Вернуться к условиям
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
              <p className="eyebrow">Работа в SOZO</p>
              <h1 className="h2">Анкета мастера</h1>
              <p className="lead">
                Расскажите о себе — рекрутер свяжется и назначит проверку навыков.
              </p>
            </div>

            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <Honeypot value={honeypot} onChange={setHoneypot} />

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

              <fieldset>
                <legend>
                  Что умеете <span className="field-req">*</span>
                </legend>
                <div className="check-grid">
                  {SKILLS.map((s) => (
                    <CheckItem
                      key={s}
                      name="skills"
                      label={s}
                      checked={skills.includes(s)}
                      onChange={() => setSkills((prev) => toggle(prev, s))}
                    />
                  ))}
                </div>
              </fieldset>

              <RadioGroup
                name="experience"
                legend="Опыт работы *"
                value={experience}
                options={EXPERIENCE}
                onChange={setExperience}
              />

              <RadioGroup
                name="transport"
                legend="Транспорт *"
                value={transport}
                options={TRANSPORT}
                onChange={setTransport}
              />

              <fieldset>
                <legend>Районы Ташкента, где готовы работать</legend>
                <div className="check-grid">
                  {ZONES.map((z) => (
                    <CheckItem
                      key={z}
                      name="zones"
                      label={z}
                      checked={zones.includes(z)}
                      onChange={() => setZones((prev) => toggle(prev, z))}
                    />
                  ))}
                </div>
              </fieldset>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <SubmitError message={error} />

              <button type="submit" className="btn btn-block" disabled={!canSubmit}>
                {pending ? 'Отправляем…' : 'Отправить анкету'}
              </button>
            </form>
          </div>

          <aside className="form-aside">
            <div className="aside-card stack">
              <h2 className="h3">Что будет после анкеты</h2>
              <ol className="stack-sm">
                <li className="tick">
                  <span>Рекрутер позвонит за 2 рабочих дня и ответит на вопросы</span>
                </li>
                <li className="tick">
                  <span>Назначим проверку навыков по вашей специальности</span>
                </li>
                <li className="tick">
                  <span>Выдадим бейдж и доступ в приложение</span>
                </li>
                <li className="tick">
                  <span>Выйдете на линию и начнёте брать заявки</span>
                </li>
              </ol>
              <div className="aside-faces">
                <div className="faces" aria-hidden="true">
                  {MASTERS.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.photo} alt="" loading="lazy" />
                  ))}
                </div>
                <p className="small muted">С нами уже работают мастера по 6 специальностям</p>
              </div>
            </div>

            <div className="aside-card aside-dark stack-sm">
              <p className="small muted">Коротко об условиях</p>
              <p style={{ fontWeight: 700 }}>Доля до 57% · выплаты каждую неделю · график свой</p>
              <Link to="/masters" className="link-action" style={{ color: 'var(--on-dark)' }}>
                Подробные условия →
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
