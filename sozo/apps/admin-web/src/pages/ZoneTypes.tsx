import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * A-41. Справочник типов общих зон и маппинг допусков.
 *
 * Два флага здесь несут разный смысл и путать их нельзя:
 * критичная — авто-согласие молчанием запрещено, наряд ждёт человека;
 * лицензируемая — наряд мастеру платформы не выдаётся вообще (ТЗ 17.8).
 *
 * Флаги редактирует только админ платформы. Оператор вправе ужесточить
 * критичность на своём объекте, ослабить — нет.
 *
 * Читается из API: раньше копия списка жила здесь, а флаги и подписи — ещё в
 * трёх местах на сервере, и подписи уже разъехались.
 */

interface ZoneType {
  code: string;
  label: string;
  critical: boolean;
  licensed: boolean;
  qualification: string | null;
}

export function ZoneTypesPage() {
  const { data, loading, error } = useFetch<ZoneType[]>(
    () => api.get<ZoneType[]>('/buildings/zone-types'),
    [],
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const zones = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Типы зон и допуски</h1>
      </div>

      <div className="banner" style={{ marginBottom: 12 }}>
        <b>Критичная</b> — авто-согласие молчанием запрещено, наряд ждёт решения человека.{' '}
        <b>Лицензируемая</b> — наряд мастеру платформы не выдаётся вообще: работы выполняет
        служба оператора или лицензиат (ТЗ 17.8).
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Зона</th><th>Код</th><th>Критичная</th><th>Лицензируемая</th><th>Требуемая квалификация</th></tr>
          </thead>
          <tbody>
            {zones.length === 0 && <EmptyRow colSpan={5} text="Справочник пуст" />}
            {zones.map((z) => (
              <tr key={z.code}>
                <td>{z.label}</td>
                <td className="muted">{z.code}</td>
                <td>{z.critical ? <span className="tone--warn">да</span> : '—'}</td>
                <td>{z.licensed ? <span className="tone--error">да</span> : '—'}</td>
                <td className="muted">{z.qualification ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
