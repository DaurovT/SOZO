import { useRef, useState } from 'react';
import { request } from '../api';

/**
 * Импорт реестра помещений (U-06, DEV-15 §14.1).
 *
 * Перенос реестра — самая дорогая часть подключения дома: два-восемь часов
 * на объект, и делает их сегодня никто. Реестр у оператора лежит в Excel,
 * вёлся годами и содержит ровно то, что содержит любая такая таблица.
 *
 * Отсюда устройство экрана. Сначала — предварительный просмотр: сколько
 * помещений заведётся, сколько жителей привяжется и какие строки не прошли,
 * с номерами строк, чтобы найти их в своём файле. Только потом кнопка
 * «Загрузить». Импорт в реестр дома вслепую делают один раз, второго не
 * делают вовсе.
 */

interface Problem {
  line: number;
  code: string;
  value: string;
}

interface Report {
  willCreateUnits: number;
  willCreateResidents: number;
  alreadyExists: number;
  problems: Problem[];
  applied: boolean;
  createdUnits?: number;
  createdResidents?: number;
}

const PROBLEM: Record<string, string> = {
  NUMBER_REQUIRED: 'нет номера помещения',
  PHONE_INVALID: 'телефон не распознан',
  FLOOR_INVALID: 'этаж не число',
  ROLE_UNKNOWN: 'неизвестная роль',
  TYPE_UNKNOWN: 'неизвестный тип помещения',
  DUPLICATE_IN_FILE: 'повтор внутри файла',
  ALREADY_EXISTS: 'помещение уже заведено',
};

const TEMPLATE = [
  'Номер;Подъезд;Этаж;Тип;Стояки;Телефон;ФИО;Роль',
  '12;1;4;Квартира;R1;+998901234567;Иванов Иван;Собственник',
  '12а;1;4;Квартира;R1;;;',
  '101;2;1;Офис;R2;998907654321;ООО «Ромашка»;Арендатор',
].join('\r\n');

/**
 * Excel сохраняет CSV и в UTF-8, и в windows-1251 — в зависимости от того,
 * какой пункт меню выбрал человек. Определяем по результату: если в тексте
 * появились символы замены, читаем заново вторым способом. Спрашивать
 * кодировку у оператора бессмысленно — он не знает ответа.
 */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1251').decode(buf);
  } catch {
    return utf8;
  }
}

export function UnitImport({ buildingId, onDone }: { buildingId: string; onDone: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = async (body: unknown) => {
    setBusy(true);
    setFailed(null);
    try {
      return await request<Report>(`/buildings/${buildingId}/units/import`, { method: 'POST', body });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'не получилось');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File) => {
    const content = await readText(file);
    setFileName(file.name);
    setText(content);
    setReport(await send({ text: content }));
  };

  const apply = async () => {
    const r = await send({ text, apply: true });
    setReport(r);
    if (r?.applied) onDone();
  };

  const downloadTemplate = () => {
    // BOM обязателен: без него Excel открывает файл в своей кодировке и
    // показывает вместо кириллицы кашу — а это первое, что увидит оператор
    const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sozo-реестр-помещений.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const done = report?.applied === true;

  return (
    <div className="card" style={{ padding: 'var(--s16)' }}>
      <h2 className="h2">Загрузить реестр из файла</h2>
      <div className="dense cap" style={{ marginTop: 'var(--s4)', maxWidth: '70ch' }}>
        Файл CSV из Excel: «Сохранить как» → «CSV». Колонки узнаются по названиям —
        переименовывать шапку не нужно. Строка с ошибкой не отменяет остальные:
        мы покажем её номер, а вы поправите файл и загрузите ещё раз.
      </div>

      <div style={{ display: 'flex', gap: 'var(--s8)', marginTop: 'var(--s16)', flexWrap: 'wrap' }}>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={() => input.current?.click()} disabled={busy}>
          {fileName ? 'Выбрать другой файл' : 'Выбрать файл'}
        </button>
        <button type="button" onClick={downloadTemplate}>Скачать шаблон</button>
        {fileName && <span className="cap" style={{ alignSelf: 'center' }}>{fileName}</span>}
      </div>

      {failed && (
        <div className="dense" style={{ marginTop: 'var(--s12)', color: 'var(--error)' }}>{failed}</div>
      )}

      {report && (
        <div style={{ marginTop: 'var(--s16)' }}>
          <div className="dense">
            {done ? (
              <b>
                Загружено: {report.createdUnits} помещений, {report.createdResidents} жителей.
              </b>
            ) : (
              <b>
                Будет заведено: {report.willCreateUnits} помещений, {report.willCreateResidents} жителей.
              </b>
            )}
            {report.alreadyExists > 0 && (
              <span className="cap"> · {report.alreadyExists} уже заведены и пропущены</span>
            )}
          </div>

          {report.problems.length > 0 && (
            <div style={{ marginTop: 'var(--s12)', maxHeight: 260, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Строка</th><th>Что не так</th><th>Значение</th></tr>
                </thead>
                <tbody>
                  {report.problems.map((p) => (
                    <tr key={`${p.line}-${p.code}`}>
                      <td className="num">{p.line}</td>
                      <td>{PROBLEM[p.code] ?? p.code}</td>
                      <td className="cap">{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!done && report.willCreateUnits > 0 && (
            <button type="button" onClick={() => void apply()} disabled={busy} style={{ marginTop: 'var(--s16)' }}>
              Загрузить {report.willCreateUnits} помещений
            </button>
          )}
          {!done && report.willCreateUnits === 0 && (
            <div className="dense cap" style={{ marginTop: 'var(--s12)' }}>
              Загружать нечего: ни одна строка файла не прошла проверку.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
