import { ReactNode, useMemo, useState } from 'react';
import { downloadCsv } from '../csv';

/**
 * Общая обвязка реестров: поиск, сортировка, страницы, выгрузка.
 *
 * До неё ни один список не был постраничным, поиск жил на трёх экранах из
 * шестидесяти, а выгрузка — на одном. На демо-данных это незаметно; на тысяче
 * строк страница перестаёт отвечать, потому что браузер рисует тысячу строк.
 *
 * Фильтрация и нарезка идут на клиенте: API отдаёт реестр целиком, и это
 * осознанный предел. Тысячу строк передать дёшево, а нарисовать — нет; именно
 * отрисовка и вешала страницу. На сотне тысяч записей понадобится серверная
 * постраничность, и тогда этот хук станет её оболочкой, а не заменой.
 */

export interface Column<T> {
  key: string;
  title: string;
  /** Значение для сортировки и поиска. Строки сравниваются по локали */
  value?: (row: T) => string | number | null | undefined;
  /** Как показать в ячейке. По умолчанию — то же, что value */
  render?: (row: T) => ReactNode;
  /** Числовая колонка: выравнивание вправо и табличные цифры */
  num?: boolean;
  /** Не сортировать по ней — например, колонка с кнопками */
  noSort?: boolean;
}

const PAGE_SIZE = 50;

export function useTableView<T>(rows: T[], columns: Array<Column<T>>, opts?: { initialSort?: string; desc?: boolean }) {
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState(opts?.initialSort ?? '');
  const [desc, setDesc] = useState(opts?.desc ?? false);
  const [page, setPage] = useState(0);

  const valueOf = (row: T, key: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.value?.(row) ?? '';
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    // Ищем по всем колонкам сразу: человек помнит номер или фамилию,
    // а не то, в какой колонке они лежат
    return rows.filter((row) =>
      columns.some((c) => String(c.value?.(row) ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, q, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = valueOf(a, sortKey);
      const vb = valueOf(b, sortKey);
      if (typeof va === 'number' && typeof vb === 'number') return desc ? vb - va : va - vb;
      return desc
        ? String(vb).localeCompare(String(va), 'ru')
        : String(va).localeCompare(String(vb), 'ru');
    });
    return copy;
  }, [filtered, sortKey, desc]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Отфильтровали так, что текущая страница исчезла — возвращаемся к первой,
  // иначе человек видит пустую таблицу при непустом результате
  const safePage = Math.min(page, pages - 1);
  const visible = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setDesc(!desc);
      return;
    }
    setSortKey(key);
    setDesc(false);
  };

  const exportCsv = (fileName: string) =>
    downloadCsv(
      fileName,
      columns.filter((c) => c.value).map((c) => c.title),
      // Выгружаем найденное целиком, а не текущую страницу: человек ищет,
      // отбирает и выгружает результат отбора
      sorted.map((row) => columns.filter((c) => c.value).map((c) => String(c.value?.(row) ?? ''))),
    );

  return {
    q,
    setQ: (v: string) => {
      setQ(v);
      setPage(0);
    },
    sortKey,
    desc,
    toggleSort,
    page: safePage,
    setPage,
    pages,
    total: sorted.length,
    visible,
    exportCsv,
  };
}

/** Панель над таблицей: поиск, счётчик и выгрузка */
export function TableToolbar({
  view,
  fileName,
  placeholder,
  children,
}: {
  view: ReturnType<typeof useTableView<never>> | { q: string; setQ: (v: string) => void; total: number; exportCsv: (f: string) => void };
  fileName: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <div className="form-grid" style={{ alignItems: 'end' }}>
      <div className="field">
        <label htmlFor={`tv-${fileName}`}>Поиск</label>
        <input
          id={`tv-${fileName}`}
          value={view.q}
          onChange={(e) => view.setQ(e.target.value)}
          placeholder={placeholder ?? 'по любому полю таблицы'}
        />
      </div>
      {children}
      <div className="field">
        <label>&nbsp;</label>
        <div className="actions-row">
          <span className="muted">найдено: {view.total}</span>
          <button type="button" className="btn" disabled={view.total === 0} onClick={() => view.exportCsv(fileName)}>
            Скачать CSV
          </button>
        </div>
      </div>
    </div>
  );
}

/** Заголовок сортируемой колонки */
export function SortableTh<T>({
  column,
  view,
}: {
  column: Column<T>;
  view: { sortKey: string; desc: boolean; toggleSort: (k: string) => void };
}) {
  if (column.noSort || !column.value) return <th className={column.num ? 'num' : undefined}>{column.title}</th>;
  const active = view.sortKey === column.key;
  return (
    <th className={column.num ? 'num' : undefined}>
      <button
        type="button"
        className="btn btn--link"
        style={{ padding: 0, font: 'inherit' }}
        onClick={() => view.toggleSort(column.key)}
      >
        {column.title}
        {/* Стрелка только у активной колонки: шесть стрелок в шапке — шум */}
        {active && (view.desc ? ' ↓' : ' ↑')}
      </button>
    </th>
  );
}

/** Переключатель страниц. Прячется, когда страница одна */
export function Pager({ view }: { view: { page: number; pages: number; setPage: (p: number) => void; total: number } }) {
  if (view.pages <= 1) return null;
  return (
    <div className="actions-row" style={{ justifyContent: 'space-between', marginTop: 'var(--s12)' }}>
      <span className="muted">
        Страница {view.page + 1} из {view.pages} · всего {view.total}
      </span>
      <div className="actions-row">
        <button type="button" className="btn" disabled={view.page === 0} onClick={() => view.setPage(view.page - 1)}>
          Назад
        </button>
        <button
          type="button"
          className="btn"
          disabled={view.page >= view.pages - 1}
          onClick={() => view.setPage(view.page + 1)}
        >
          Дальше
        </button>
      </div>
    </div>
  );
}
