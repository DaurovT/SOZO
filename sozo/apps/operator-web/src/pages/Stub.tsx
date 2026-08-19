import { Empty } from '../components/States';

/**
 * Экраны, у которых API готов, а интерфейс делается следующим по порядку сборки
 * (DEV-15 §14): U-04 → U-13 → U-06 → U-07 → U-10. Заглушка честно говорит, что
 * функция есть на бэкенде, а не притворяется пустым состоянием.
 */
export function Stub({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h1 className="h1">{title}</h1>
      <div className="card" style={{ padding: 'var(--s24)' }}>
        <Empty text={note} />
      </div>
    </>
  );
}
