import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider, currentLocale, loadDict } from './i18n';
import './tokens.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден #root');

/**
 * Разрешение прятать блоки до их появления при скролле.
 *
 * Ставим до первого рендера и из скрипта, а не в самой разметке: правило
 * `opacity: 0` в styles.css написано под класс `js-reveal`, и пока класса
 * нет, страница видна целиком. Значит, упавший бандл, отключённый JS или
 * старый браузер дают читаемую страницу, а не белые прямоугольники — это
 * ровно тот случай, который однажды и случился.
 *
 * Здесь, а не в эффекте `useReveal`: эффект выполняется после первой
 * отрисовки, и класс успел бы спрятать уже показанное — текст мигнул бы.
 */
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('js-reveal');
}

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
