import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Где деньги и что не сходится.
 *
 * Балансы счетов были и раньше, но читать их надо было планом счетов:
 * «clearing 4 200 000» ничего не говорит тому, кто не бухгалтер. Здесь то же
 * самое собрано по смыслу — где лежит, кому должны, что прошло.
 *
 * Проверка целостности справочников рядом намеренно: и то и другое смотрят
 * утром, чтобы понять, чем сегодня заниматься.
 */

interface Line {
  code: string;
  title: string;
  amountTiyin: number;
  note?: string;
}

interface MoneyFlow {
  where: Line[];
  owed: Line[];
  flows: Line[];
  balanceCheck: { ok: boolean; note?: string; diffTiyin?: number };
  note: string;
}

interface IntegrityCheck {
  code: string;
  title: string;
  note: string;
  count: number;
  items: string[];
}

function Block({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="table-wrap">
        <table>
          <tbody>
            {lines.map((l) => (
              <tr key={l.code}>
                <td>
                  {l.title}
                  {l.note !== undefined && <div className="muted">{l.note}</div>}
                </td>
                <td className="num total">{formatSoums(l.amountTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function MoneyFlowPage() {
  const money = useFetch<MoneyFlow>(() => api.get<MoneyFlow>('/admin/billing/money-flow'), []);
  const integrity = useFetch<{ checks: IntegrityCheck[]; problems: number; note: string }>(
    () => api.get('/admin/dashboard/integrity'),
    [],
  );

  return (
    <>
      <div className="page-header">
        <h1>Где деньги</h1>
      </div>

      {money.error !== null && <ErrorBanner message={money.error} />}
      {money.loading && !money.data && <Loading />}

      {money.data && (
        <>
          <div className="banner">{money.data.note}</div>
          {!money.data.balanceCheck.ok && (
            <div className="banner banner--warning">
              Баланс-чекер нашёл расхождение{' '}
              {money.data.balanceCheck.diffTiyin !== undefined &&
                `на ${formatSoums(money.data.balanceCheck.diffTiyin)}`}
              . Это ошибка в проводках, и до её разбора цифрам ниже верить нельзя
            </div>
          )}

          <Block title="Где лежат сейчас" lines={money.data.where} />
          <Block title="Кому должны" lines={money.data.owed} />
          <Block title="Что прошло за всё время" lines={money.data.flows} />
        </>
      )}

      <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
        <h1 style={{ fontSize: 16 }}>Целостность справочников</h1>
        {integrity.data && (
          <span className="muted">
            {integrity.data.problems === 0 ? 'дырок нет' : `проблем: ${integrity.data.problems}`}
          </span>
        )}
      </div>

      {integrity.error !== null && <ErrorBanner message={integrity.error} />}
      {integrity.data && (
        <>
          <div className="banner">{integrity.data.note}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Проверка</th>
                  <th className="num">Найдено</th>
                  <th>Что это значит</th>
                  <th>Примеры</th>
                </tr>
              </thead>
              <tbody>
                {integrity.data.checks.length === 0 && <EmptyRow colSpan={4} />}
                {integrity.data.checks.map((c) => (
                  <tr key={c.code} className={c.count > 0 ? 'row--warning' : undefined}>
                    <td>{c.title}</td>
                    <td className="num">{c.count}</td>
                    <td className="muted">{c.note}</td>
                    <td className="muted">
                      {c.count === 0 ? '—' : c.items.slice(0, 5).join('; ')}
                      {c.count > 5 && ` … ещё ${c.count - 5}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
