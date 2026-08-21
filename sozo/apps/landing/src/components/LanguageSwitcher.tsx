import { useEffect, useRef, useState } from 'react';
import { LOCALES, pathForLocale, useLocale, useT } from '../i18n';

/**
 * Выбор языка в шапке.
 *
 * Пунктов десять — в строку они не помещаются, поэтому пилюля показывает
 * текущий язык, а список раскрывается по нажатию. Внутри — обычные ссылки
 * `<a href>`, а не кнопки: их видит поисковик, их можно открыть в новой
 * вкладке, и они же меняют адрес, от которого зависит язык страницы.
 *
 * Название языка написано на нём самом. Человеку, которому нужен корейский,
 * слово «Корейский» кириллицей не помогает.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lang" ref={box}>
      <button
        type="button"
        className="lang-current"
        aria-label={t('nav.language')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{locale.code.toUpperCase()}</span>
        <svg className="lang-caret" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 0h8L4 5z" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <ul className="lang-menu" role="listbox" aria-label={t('nav.chooseLanguage')}>
          {LOCALES.map((l) => (
            <li key={l.code}>
              <a
                href={pathForLocale(l.code)}
                lang={l.tag}
                dir={l.dir}
                role="option"
                aria-selected={l.code === locale.code}
                className={l.code === locale.code ? 'is-current' : undefined}
              >
                {l.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
