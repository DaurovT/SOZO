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
import { useT } from '../i18n';
import { SKILLS, skillLabel, ZONES, zoneLabel } from '../lib/catalog';
import { useSla } from '../lib/sla';
import { isPhoneValid, toE164 } from '../lib/phone';
import { useLeadSubmit } from '../lib/useLeadSubmit';

type Experience = '<1' | '1-3' | '3-5' | '5+';
type Transport = 'own_car' | 'public' | 'none';

/** Значение уезжает в API как есть, подпись — ключ словаря. */
const EXPERIENCE: { value: Experience; key: string }[] = [
  { value: '<1', key: 'apply.experienceUnder1' },
  { value: '1-3', key: 'apply.experience1to3' },
  { value: '3-5', key: 'apply.experience3to5' },
  { value: '5+', key: 'apply.experienceOver5' },
];

const TRANSPORT: { value: Transport; key: string }[] = [
  { value: 'own_car', key: 'apply.transportOwnCar' },
  { value: 'public', key: 'apply.transportPublic' },
  { value: 'none', key: 'apply.transportNone' },
];

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export default function Apply() {
  const t = useT();
  const sla = useSla();
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
        title={t('apply.successTitle')}
        lead={t('apply.successLead', { sla: sla(result.slaMinutes, 2880) })}
        ticket={result.ticket}
      >
        <div className="btn-row">
          <Link to="/masters" className="btn btn-secondary">
            {t('apply.backToTerms')}
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
              <p className="eyebrow">{t('apply.eyebrow')}</p>
              <h1 className="h2">{t('apply.title')}</h1>
              <p className="lead">{t('apply.lead')}</p>
            </div>

            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <Honeypot value={honeypot} onChange={setHoneypot} />

              <Field id="name" label={t('apply.nameLabel')} required>
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
                  {t('apply.skillsLegend')} <span className="field-req">*</span>
                </legend>
                <div className="check-grid">
                  {SKILLS.map((s) => (
                    <CheckItem
                      key={s}
                      name="skills"
                      label={skillLabel(s, t)}
                      checked={skills.includes(s)}
                      onChange={() => setSkills((prev) => toggle(prev, s))}
                    />
                  ))}
                </div>
              </fieldset>

              <RadioGroup
                name="experience"
                legend={t('apply.experienceLegend')}
                value={experience}
                options={EXPERIENCE.map((o) => ({ value: o.value, label: t(o.key) }))}
                onChange={setExperience}
              />

              <RadioGroup
                name="transport"
                legend={t('apply.transportLegend')}
                value={transport}
                options={TRANSPORT.map((o) => ({ value: o.value, label: t(o.key) }))}
                onChange={setTransport}
              />

              <fieldset>
                <legend>{t('apply.zonesLegend')}</legend>
                <div className="check-grid">
                  {ZONES.map((z) => (
                    <CheckItem
                      key={z}
                      name="zones"
                      label={zoneLabel(z, t)}
                      checked={zones.includes(z)}
                      onChange={() => setZones((prev) => toggle(prev, z))}
                    />
                  ))}
                </div>
              </fieldset>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <SubmitError message={error} />

              <button type="submit" className="btn btn-block" disabled={!canSubmit}>
                {pending ? t('apply.submitting') : t('apply.submit')}
              </button>
            </form>
          </div>

          <aside className="form-aside">
            <div className="aside-card stack">
              <h2 className="h3">{t('apply.nextTitle')}</h2>
              <ol className="stack-sm">
                <li className="tick">
                  <span>{t('apply.step1')}</span>
                </li>
                <li className="tick">
                  <span>{t('apply.step2')}</span>
                </li>
                <li className="tick">
                  <span>{t('apply.step3')}</span>
                </li>
                <li className="tick">
                  <span>{t('apply.step4')}</span>
                </li>
              </ol>
              <div className="aside-faces">
                <div className="faces" aria-hidden="true">
                  {MASTERS.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.photo} alt="" loading="lazy" />
                  ))}
                </div>
                <p className="small muted">{t('apply.mastersNote')}</p>
              </div>
            </div>

            <div className="aside-card aside-dark stack-sm">
              <p className="small muted">{t('apply.termsTitle')}</p>
              <p style={{ fontWeight: 700 }}>{t('apply.termsSummary')}</p>
              <Link to="/masters" className="link-action" style={{ color: 'var(--on-dark)' }}>
                {t('apply.termsLink')}
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
