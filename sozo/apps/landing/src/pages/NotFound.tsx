import { Link } from 'react-router-dom';
import { useT } from '../i18n';

export default function NotFound() {
  const t = useT();
  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg" style={{ textAlign: 'center' }}>
        <h1 className="h1">{t('notFound.title')}</h1>
        <p className="lead">{t('notFound.lead')}</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn">
            {t('notFound.home')}
          </Link>
        </div>
      </div>
    </section>
  );
}
