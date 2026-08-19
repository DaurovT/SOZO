import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { COMPANY, COMPANY_YEAR, DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { useReveal } from '../lib/reveal';
import { captureUtm } from '../lib/utm';
import { SozoLogo, SozoMark } from './Logo';

const NAV = [
  { to: '/', label: 'Частным', end: true },
  { to: '/business', label: 'Бизнесу', end: false },
  { to: '/masters', label: 'Мастерам', end: false },
];

/** Страницы с тёмным героем — шапка на них стартует прозрачной. */
const DARK_HERO = new Set(['/', '/business', '/masters']);

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'is-active' : '';
}

function Header(props: { overDark: boolean }) {
  // Переключатель RU/UZ — заглушка: полного перевода нет, показываем уведомление.
  const [lang, setLang] = useState<'ru' | 'uz'>('ru');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Меню закрывается при переходе и не даёт скроллить фон, пока открыто.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const cls = ['header', scrolled ? 'is-scrolled' : '', props.overDark ? 'is-over-dark' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <header className={cls}>
        <div className="wrap">
          <div className="header-bar">
            <Link to="/" className="logo" aria-label="SOZO — на главную">
              <SozoMark size={32} />
              <SozoLogo height={20} />
            </Link>

            <div className="header-spacer" />

            <nav className="header-nav" aria-label="Разделы">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="header-spacer" />

            <a className="header-tel" href={DISPATCH_TEL_HREF}>
              {DISPATCH_TEL_DISPLAY}
            </a>

            <Link to="/order" className="btn btn-sm btn-auto header-cta">
              Вызвать мастера
            </Link>

            <div className="lang" role="group" aria-label="Язык">
              <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>
                RU
              </button>
              <button type="button" aria-pressed={lang === 'uz'} onClick={() => setLang('uz')}>
                UZ
              </button>
            </div>

            <button
              type="button"
              className="burger"
              aria-label="Меню"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span className="burger-line" />
              <span className="burger-line" />
            </button>
          </div>
        </div>

        {lang === 'uz' && (
          <p className="lang-note" role="status">
            UZ-версия готовится. Пока доступна русская версия сайта.
          </p>
        )}
      </header>

      {menuOpen && (
        <div className="menu" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="menu-top">
            <Link to="/" className="logo" style={{ color: 'var(--on-dark)' }}>
              <SozoMark size={32} />
              <SozoLogo height={20} />
            </Link>
            <button
              type="button"
              className="menu-close"
              aria-label="Закрыть"
              onClick={() => setMenuOpen(false)}
            >
              ×
            </button>
          </div>

          <nav className="menu-links" aria-label="Разделы">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="menu-foot">
            <Link to="/order" className="btn">
              Вызвать мастера
            </Link>
            <a href={DISPATCH_TEL_HREF} className="btn btn-ghost">
              {DISPATCH_TEL_DISPLAY}
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="stack">
            <div className="logo" style={{ color: 'var(--on-dark)' }}>
              <SozoMark size={32} />
              <SozoLogo height={20} />
            </div>
            <p className="small" style={{ color: 'var(--on-dark-secondary)', maxWidth: '34ch' }}>
              Технический сервис для дома и бизнеса в Ташкенте. Сантехника, электрика, кондиционеры,
              мелкий ремонт.
            </p>
            <a
              href={DISPATCH_TEL_HREF}
              style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 20 }}
            >
              {DISPATCH_TEL_DISPLAY}
            </a>
            <p className="tiny">Аварийные заявки принимаем круглосуточно.</p>
          </div>

          <div>
            <p className="footer-col-title">Частным</p>
            <nav className="footer-links" aria-label="Частным клиентам">
              <Link to="/">Как это работает</Link>
              <Link to="/order">Вызвать мастера</Link>
              <Link to="/#services">Что чиним</Link>
              <Link to="/#app">Приложение</Link>
            </nav>
          </div>

          <div>
            <p className="footer-col-title">Бизнесу и мастерам</p>
            <nav className="footer-links" aria-label="Бизнесу и мастерам">
              <Link to="/business">Обслуживание точек</Link>
              <Link to="/calculator">Рассчитать абонентку</Link>
              <Link to="/masters">Работа мастером</Link>
              <Link to="/apply">Анкета мастера</Link>
            </nav>
          </div>

          <div>
            <p className="footer-col-title">Документы</p>
            <nav className="footer-links" aria-label="Служебные страницы">
              <Link to="/legal#offer">Публичная оферта</Link>
              <Link to="/legal#privacy">Обработка персональных данных</Link>
              <Link to="/legal#contacts">Контакты</Link>
            </nav>
          </div>
        </div>

        <div className="footer-bottom">
          <p>
            © {COMPANY_YEAR} {COMPANY}. Ташкент.
          </p>
          <p>Цены на сайте — ориентир, не оферта. Точную сумму называем до начала работ.</p>
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    captureUtm(search);
    // UTM снимаем один раз за сессию, на первом заходе.
  }, [search]);

  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  // Появление блоков при скролле — пересобираем наблюдение на каждой странице.
  useReveal([pathname]);

  return (
    <div className="page">
      <Header overDark={DARK_HERO.has(pathname)} />
      <main className="page-body">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
