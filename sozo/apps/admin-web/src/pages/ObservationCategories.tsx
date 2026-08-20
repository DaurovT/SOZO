import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * A-44. Справочник категорий замечаний (DEV-15 §7.7.2).
 *
 * Справочник намеренно шире каталога дефектов: грязь во дворе, перегоревший
 * фонарь и граффити не являются дефектами оборудования, но терять их нельзя.
 * Тащить их в DEFECT неправильно — техдолг перестал бы означать состояние
 * здания и превратился бы в свалку.
 *
 * Читается из API, а не дублируется здесь: по этим же категориям сервер
 * подставляет серьёзность и предлагает маршрут, и разъехавшиеся списки
 * означали бы, что админ видит одно, а мастер на обходе нажимает другое.
 */

interface Category {
  id: string;
  label: string;
  defaultSeverity: 'emergency' | 'work_required' | 'housekeeping' | 'info';
  defaultRoute: 'task' | 'defect' | 'order' | 'contractor' | 'journal';
  icon: string;
}

const SEVERITY_WORDS: Record<Category['defaultSeverity'], string> = {
  emergency: 'аварийное',
  work_required: 'требует работ',
  housekeeping: 'содержание',
  info: 'информация',
};

const ROUTE_WORDS: Record<Category['defaultRoute'], string> = {
  task: 'задача сотруднику',
  defect: 'техдолг объекта',
  order: 'заявка мастеру',
  contractor: 'претензия подрядчику',
  journal: 'только журнал',
};

export function ObservationCategoriesPage() {
  const { data, loading, error } = useFetch<Category[]>(
    () => api.get<Category[]>('/buildings/observation-categories'),
    [],
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const rows = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Категории замечаний</h1>
      </div>

      <div className="banner" style={{ marginBottom: 12 }}>
        Порядок строк — это порядок плиток на экране быстрой фиксации: мастер на
        обходе бьёт по ним не глядя, поэтому сверху то, что встречается чаще.
        Серьёзность и маршрут — <b>умолчания</b>: указанные на месте важнее.
        Категория с серьёзностью «аварийное» создаёт заявку сама, минуя решение.
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Категория</th>
              <th>Код</th>
              <th>Серьёзность по умолчанию</th>
              <th>Маршрут по умолчанию</th>
              <th>Иконка</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} text="Справочник пуст" />}
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="muted">{c.id}</td>
                <td>
                  {c.defaultSeverity === 'emergency' ? (
                    <span className="tone--error">{SEVERITY_WORDS[c.defaultSeverity]}</span>
                  ) : (
                    SEVERITY_WORDS[c.defaultSeverity]
                  )}
                </td>
                <td className="muted">{ROUTE_WORDS[c.defaultRoute]}</td>
                <td className="muted">{c.icon}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
