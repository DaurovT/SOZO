import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { COMPANY, COMPANY_YEAR, DISPATCH_TEL_DISPLAY, DISPATCH_TEL_HREF } from '../lib/contacts';
import { useHreflang, useT } from '../i18n';
import { useReveal } from '../lib/reveal';
import { captureUtm } from '../lib/utm';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SozoLogo, SozoMark } from './Logo';

/** Разделы шапки. Подпись — ключ словаря: она переводится, адрес нет. */
const NAV = [
  { to: '/', key: 'nav.private', end: true },
  { to: '/business', key: 'nav.business', end: false },
  { to: '/operators', key: 'nav.operators', end: false },
  { to: '/masters', key: 'nav.masters', end: false },
];

/** Страницы с тёмным героем — шапка на них стартует прозрачной. */
const DARK_HERO = new Set(['/', '/business', '/operators', '/masters']);

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'is-active' : '';
}

function Header(props: { overDark: boolean }) {
  const t = useT();
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
            <Link to="/" className="logo" aria-label={t('nav.home')}>
              <SozoMark size={32} />
              <SozoLogo height={20} />
            </Link>

            <div className="header-spacer" />

            <nav className="header-nav" aria-label={t('nav.sections')}>
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                  {t(item.key)}
                </NavLink>
              ))}
            </nav>

            <div className="header-spacer" />

            <a className="header-tel" href={DISPATCH_TEL_HREF}>
              {DISPATCH_TEL_DISPLAY}
            </a>

            <Link to="/order" className="btn btn-sm btn-auto header-cta">
              {t('nav.callMaster')}
            </Link>

            <LanguageSwitcher />

            <button
              type="button"
              className="burger"
              aria-label={t('nav.menu')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span className="burger-line" />
              <span className="burger-line" />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="menu" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
          <div className="menu-top">
            <Link to="/" className="logo" style={{ color: 'var(--on-dark)' }}>
              <SozoMark size={32} />
              <SozoLogo height={20} />
            </Link>
            <button
              type="button"
              className="menu-close"
              aria-label={t('nav.close')}
              onClick={() => setMenuOpen(false)}
            >
              ×
            </button>
          </div>

          <nav className="menu-links" aria-label={t('nav.sections')}>
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>

          <div className="menu-foot">
            <Link to="/order" className="btn">
              {t('nav.callMaster')}
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
  const t = useT();
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
              {t('footer.about')}
            </p>
            <a
              href={DISPATCH_TEL_HREF}
              style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 20 }}
            >
              {DISPATCH_TEL_DISPLAY}
            </a>
            <p className="tiny">{t('footer.emergency')}</p>
          </div>

          <div>
            <p className="footer-col-title">{t('footer.privateTitle')}</p>
            <nav className="footer-links" aria-label={t('footer.privateAria')}>
              <Link to="/">{t('footer.howItWorks')}</Link>
              <Link to="/order">{t('nav.callMaster')}</Link>
              <Link to="/#services">{t('footer.whatWeFix')}</Link>
              <Link to="/#app">{t('footer.app')}</Link>
            </nav>
          </div>

          <div>
            <p className="footer-col-title">{t('footer.businessTitle')}</p>
            <nav className="footer-links" aria-label={t('footer.businessAria')}>
              <Link to="/business">{t('footer.sitesService')}</Link>
              <Link to="/operators">{t('footer.managingCompanies')}</Link>
              <Link to="/calculator">{t('footer.calcSubscription')}</Link>
              <Link to="/masters">{t('footer.masterWork')}</Link>
              <Link to="/apply">{t('footer.masterForm')}</Link>
            </nav>
          </div>

          <div>
            <p className="footer-col-title">{t('footer.docsTitle')}</p>
            <nav className="footer-links" aria-label={t('footer.docsAria')}>
              <Link to="/legal#offer">{t('footer.offer')}</Link>
              <Link to="/legal#privacy">{t('footer.privacy')}</Link>
              <Link to="/legal#contacts">{t('footer.contacts')}</Link>
            </nav>
          </div>
        </div>

        <div className="footer-bottom">
          <p>{t('footer.copyright', { year: COMPANY_YEAR, company: COMPANY })}</p>
          <p>{t('footer.priceNote')}</p>
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

  // Ссылки на языковые версии этой же страницы — переписываются на переходе
  useHreflang(pathname);

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
