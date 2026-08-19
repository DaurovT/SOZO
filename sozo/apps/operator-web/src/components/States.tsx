/** Три состояния экрана по DEV-06 §4.6: загрузка, пусто, ошибка. */

export function Loading({ text = 'Загружаем…' }: { text?: string }) {
  return <div className="empty-state"><div className="cap">{text}</div></div>;
}

export function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
      </svg>
      <div>{error}</div>
      <button className="btn btn--secondary" onClick={onRetry}>Повторить</button>
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <div>{text}</div>
      {action}
    </div>
  );
}
