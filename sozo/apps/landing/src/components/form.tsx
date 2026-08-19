import type { ReactNode } from 'react';
import { extractDigits, formatPhone } from '../lib/phone';

/* ---------- Обёртка поля ---------- */

export function Field(props: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const { id, label, required, hint, error, children } = props;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="field-req"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Honeypot ---------- */

/**
 * Скрытое поле-приманка. Человек его не видит и не сфокусирует;
 * если бот заполнил — форма показывает «успех», но лид не отправляется.
 */
export function Honeypot(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="hp" aria-hidden="true">
      <label htmlFor="company_website">Не заполняйте это поле</label>
      <input
        id="company_website"
        name="company_website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/* ---------- Телефон +998 ---------- */

export function PhoneField(props: {
  id?: string;
  digits: string;
  onChange: (digits: string) => void;
  error?: string | null;
}) {
  const id = props.id ?? 'phone';
  return (
    <Field id={id} label="Телефон" required error={props.error} hint="Например, +998 90 123-45-67">
      <input
        id={id}
        name="phone"
        className={`input${props.error ? ' input-invalid' : ''}`}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={formatPhone(props.digits)}
        onChange={(e) => props.onChange(extractDigits(e.target.value))}
      />
    </Field>
  );
}

/* ---------- Согласие ЗРУ-547 ---------- */

export function ConsentCheckbox(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check check-box">
      <input
        type="checkbox"
        name="consent"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>
        Согласен на обработку персональных данных (ЗРУ-547)
        <span className="field-req"> *</span>
      </span>
    </label>
  );
}

/* ---------- Чекбокс / радио в рамке ---------- */

export function CheckItem(props: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check check-box">
      <input
        type="checkbox"
        name={props.name}
        value={props.label}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function RadioGroup<T extends string>(props: {
  name: string;
  legend: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend>{props.legend}</legend>
      <div className="check-grid">
        {props.options.map((opt) => (
          <label className="check check-box" key={opt.value}>
            <input
              type="radio"
              name={props.name}
              value={opt.value}
              checked={props.value === opt.value}
              onChange={() => props.onChange(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ---------- Степпер ---------- */

export function Stepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const { label, value, min, max, onChange, suffix } = props;
  return (
    <div className="field">
      <span className="field-label" id={`${label}-label`}>
        {label}
      </span>
      <div className="stepper">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label="Уменьшить"
        >
          −
        </button>
        <output className="stepper-value" aria-live="polite">
          {value}
          {suffix ? ` ${suffix}` : ''}
        </output>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label="Увеличить"
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ---------- Ошибка отправки ---------- */

export function SubmitError(props: { message: string | null }) {
  if (!props.message) return null;
  return (
    <p className="field-error" role="alert">
      {props.message}
    </p>
  );
}

/* ---------- Экран успеха ---------- */

export function Done(props: {
  title: string;
  lead: string;
  ticket?: string;
  children?: ReactNode;
}) {
  return (
    <section className="section-lg">
      <div className="wrap-narrow">
        <div className="done stack-lg">
          <div className="done-mark" />
          <h1 className="h2">{props.title}</h1>
          <p className="lead">{props.lead}</p>
          {props.ticket && (
            <div className="stack-sm">
              <p className="small muted">Номер обращения</p>
              <div className="ticket">{props.ticket}</div>
            </div>
          )}
          {props.children}
        </div>
      </div>
    </section>
  );
}
