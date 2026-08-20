/**
 * Причина отказа базы одной строкой.
 *
 * Сообщение Prisma многострочное: сверху вызов, снизу — то, что на самом деле
 * произошло. Печатать `.message` целиком в журнал нельзя (двадцать строк на
 * каждую неудачу), а первая строка у него пустая — именно поэтому неудачные
 * записи выглядели как «[Access] запись в базу не удалась:» и ничего больше.
 */
export function dbFailure(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // Настоящая причина у Prisma лежит в тексте PostgresError, а строка
  // «Error occurred during query execution» стоит перед ним и сама по себе
  // не говорит ничего
  const pg = text.match(/message: "((?:[^"\\]|\\.)*)"/);
  if (pg) return pg[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const cause = lines.find((l) => /violates|constraint|Unique|Foreign key|Inconsistent|Invalid value|denied/i.test(l));
  return cause ?? lines[lines.length - 1] ?? 'причина неизвестна';
}
