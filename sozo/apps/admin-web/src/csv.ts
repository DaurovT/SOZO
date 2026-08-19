/** Клиентская генерация CSV (разделитель «;» — совместим с Excel ru/uz) и скачивание blob. */
export function downloadCsv(
  filename: string,
  header: string[],
  rows: Array<Array<string | number>>,
): void {
  const esc = (v: string | number): string => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM в начале — чтобы Excel открывал UTF-8 корректно
  const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
