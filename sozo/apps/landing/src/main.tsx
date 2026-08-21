import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider, currentLocale, loadDict } from './i18n';
import './tokens.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден #root');

/**
 * Словарь загружаем до первого рендера, а не по ходу дела.
 *
 * Иначе посетитель французской страницы увидел бы русский текст, который
 * через мгновение перерисуется — на медленной мобильной сети это заметно и
 * выглядит поломкой. Русский лежит в главном бандле, и для большинства
 * визитов `loadDict` возвращает его сразу, не выходя в сеть.
 */
const locale = currentLocale();

loadDict(locale.code).then((dict) => {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider locale={locale} dict={dict}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
});
