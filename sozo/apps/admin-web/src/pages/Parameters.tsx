import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { plural } from '../format';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { SystemParameter } from '../types';

const LEVEL_LABELS: Record<string, string> = {
  global: 'Глоб',
  contract: 'Договор',
  location: 'Точка',
  price: 'Прайс',
};

interface ValueCellProps {
  param: SystemParameter;
  onSave: (num: number, value: string) => Promise<void>;
}

/** Инлайн-правка документного значения (строка как есть, сохранение по blur). */
function ValueCell({ param, onSave }: ValueCellProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  if (editing) {
    return (
      <td>
        <input
          className="cell-input"
          style={{ width: 280 }}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text !== param.value) void onSave(param.num, text);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(param.value);
              setEditing(false);
            }
          }}
        />
      </td>
    );
  }

  return (
    <td
      className="cell--editable"
      onClick={() => {
        setText(param.value);
        setEditing(true);
      }}
    >
      {param.value}
    </td>
  );
}

export function ParametersPage() {
  const toast = useToast();
  const { data, loading, error, setData } = useFetch<SystemParameter[]>(() =>
    api.get<SystemParameter[]>('/admin/parameters'),
  );
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const save = async (num: number, value: string) => {
    setActionError(null);
    try {
      await api.put(`/admin/parameters/${num}`, { value });
      setData((prev) => (prev ? prev.map((p) => (p.num === num ? { ...p, value } : p)) : prev));
      toast('Сохранено');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const params = data ?? [];
  const needle = query.trim().toLowerCase();
  const filtered = needle ? params.filter((p) => p.name.toLowerCase().includes(needle)) : params;

  return (
    <>
      <div className="page-header">
        <h1>Параметры системы</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s12)' }}>
          <span className="muted">
            {needle ? `${filtered.length} из ` : ''}
            {plural(params.length, 'параметр', 'параметра', 'параметров')}
          </span>
          <input
            className="cell-input"
            style={{ width: 220 }}
            placeholder="Поиск по названию…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {actionError !== null && <ErrorBanner message={actionError} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">№</th>
              <th>Название</th>
              <th>Значение</th>
              <th>Уровни</th>
              <th>Где используется</th>
              <th>ТЗ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Ничего не найдено
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.num}>
                <td className="num muted">{p.num}</td>
                <td>{p.name}</td>
                <ValueCell param={p} onSave={save} />
                <td>
                  {p.levels.map((l) => (
                    <span
                      key={l}
                      className={l === 'global' ? 'badge badge--accent' : 'badge badge--muted'}
                      style={{ marginRight: 'var(--s4)' }}
                    >
                      {LEVEL_LABELS[l] ?? l}
                    </span>
                  ))}
                </td>
                <td
                  className="muted"
                  style={{
                    maxWidth: 320,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={p.usage}
                >
                  {p.usage}
                </td>
                <td className="muted mono">{p.tz}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
