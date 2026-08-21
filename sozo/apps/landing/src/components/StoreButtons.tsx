import { useT } from '../i18n';

/**
 * Кнопки магазинов. Ссылок пока нет — приложение готовится к публикации,
 * поэтому кнопки намеренно неактивны (disabled), а не ведут в никуда.
 */

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 2.9-.7s1.7.7 2.9.7c1.2 0 2-1.1 2.7-2.2.9-1.2 1.2-2.5 1.3-2.5 0 0-2.1-.8-2.1-3.6zM14.2 5.9c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.2z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">
      <path d="M4 3.2v17.6c0 .5.5.8.9.6l9.3-5.3-2.7-2.7L4 3.2zm12.4 7.2L6.9 5l6.6 6.6 2.9-1.2zm1.4.8 2.7 1.5c.6.3.6 1.1 0 1.4l-2.7 1.5-3-3 3-1.4zM6.9 19l9.5-5.4-2.9-1.2L6.9 19z" />
    </svg>
  );
}

export default function StoreButtons() {
  const t = useT();
  return (
    <div className="btn-row">
      <button
        type="button"
        className="store-btn"
        disabled
        aria-label={t('components.store.appStoreAria')}
      >
        <span className="store-mark" aria-hidden="true">
          <AppleGlyph />
        </span>
        <span className="store-copy">
          <strong>App Store</strong>
          <small>{t('components.store.soon')}</small>
        </span>
      </button>
      <button
        type="button"
        className="store-btn"
        disabled
        aria-label={t('components.store.googlePlayAria')}
      >
        <span className="store-mark" aria-hidden="true">
          <PlayGlyph />
        </span>
        <span className="store-copy">
          <strong>Google Play</strong>
          <small>{t('components.store.soon')}</small>
        </span>
      </button>
    </div>
  );
}
