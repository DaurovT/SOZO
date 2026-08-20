export function Loading() {
  return <div className="state-text">Загрузка…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="banner banner--error">{message}</div>;
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text?: string }) {
  // Текст переопределяется там, где «Пока пусто» звучит неверно: у справочника
  // пустота — это состояние настройки, а не отсутствие данных за период
  return (
    <tr>
      <td colSpan={colSpan} className="muted">
        {text ?? 'Пока пусто'}
      </td>
    </tr>
  );
}
