export function Loading() {
  return <div className="state-text">Загрузка…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="banner banner--error">{message}</div>;
}

export function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="muted">
        Пока пусто
      </td>
    </tr>
  );
}
