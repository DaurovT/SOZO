import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="section-lg">
      <div className="wrap-narrow stack-lg" style={{ textAlign: 'center' }}>
        <h1 className="h1">Страница не найдена</h1>
        <p className="lead">Возможно, ссылка устарела или в адресе опечатка.</p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn">
            На главную
          </Link>
        </div>
      </div>
    </section>
  );
}
