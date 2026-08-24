/**
 * Маленькая схема интерфейса в карточке аудитории.
 *
 * Четыре карточки — «Клиентам / Мастерам / Бизнесу / Управляющим» — на первом
 * взгляде были четырьмя одинаковыми белыми прямоугольниками с текстом, и
 * различить сценарии глаз успевал только прочитав. Схема даёт узнавание за
 * секунду: заявка со статусом, лента с кнопкой «взять», список объектов с
 * суммами, дом с обращениями.
 *
 * Рисуем фигурами, а не текстом. Два довода. Первый: цифры и подписи внутри
 * превью — это выдуманные данные, а их мы на страницу не выносим. Второй:
 * текст в SVG пришлось бы переводить на десять языков ради декоративной
 * детали, которую никто не читает.
 *
 * Цвета — только токены: акцент означает действие или деньги, серые полосы —
 * содержимое. Тот же язык, что на всей странице.
 */

const W = 240;
const H = 120;

function Frame(props: { children: React.ReactNode }) {
  return (
    <svg
      className="aud-preview"
      viewBox={`0 0 ${W} ${H}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width={W} height={H} rx="12" fill="var(--bg-soft)" />
      {props.children}
    </svg>
  );
}

/** Полоса-заглушка текста */
function Bar(props: { x: number; y: number; w: number; h?: number; tone?: 'strong' | 'soft' }) {
  const { x, y, w, h = 6, tone = 'soft' } = props;
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={h / 2}
      fill={tone === 'strong' ? 'var(--text)' : 'var(--border-strong)'}
    />
  );
}

/** Клиенту — заявка со статусом и полосой хода работ */
function ClientPreview() {
  return (
    <Frame>
      <rect x="16" y="16" width={W - 32} height={H - 32} rx="10" fill="var(--surface)" />
      <Bar x={28} y={30} w={64} tone="strong" />
      <rect x={W - 96} y={26} width="68" height="16" rx="8" fill="var(--accent)" />
      <Bar x={28} y={52} w={120} />
      <rect x={28} y={72} width={W - 56} height="6" rx="3" fill="var(--bg-soft)" />
      <rect x={28} y={72} width={(W - 56) * 0.62} height="6" rx="3" fill="var(--accent)" />
      <Bar x={28} y={90} w={88} />
    </Frame>
  );
}

/** Мастеру — лента заявок рядом, у верхней кнопка «взять» */
function MasterPreview() {
  return (
    <Frame>
      <rect x="16" y="14" width={W - 32} height="40" rx="10" fill="var(--surface)" />
      <circle cx="36" cy="34" r="7" fill="var(--accent)" />
      <Bar x={52} y={26} w={78} tone="strong" />
      <Bar x={52} y={38} w={54} />
      <rect x={W - 74} y={24} width="52" height="20" rx="10" fill="var(--accent)" />

      <rect x="16" y="62" width={W - 32} height="40" rx="10" fill="var(--surface)" />
      <circle cx="36" cy="82" r="7" fill="var(--border-strong)" />
      <Bar x={52} y={74} w={64} tone="strong" />
      <Bar x={52} y={86} w={40} />
      <rect x={W - 74} y={72} width="52" height="20" rx="10" fill="var(--bg-soft)" />
    </Frame>
  );
}

/** Бизнесу — список точек с суммами справа */
function BusinessPreview() {
  const rows = [0, 1, 2];
  return (
    <Frame>
      <rect x="16" y="16" width={W - 32} height={H - 32} rx="10" fill="var(--surface)" />
      <Bar x={28} y={28} w={70} tone="strong" />
      {rows.map((i) => {
        const y = 50 + i * 20;
        return (
          <g key={i}>
            <rect x={28} y={y} width="8" height="8" rx="2" fill="var(--border-strong)" />
            <Bar x={44} y={y + 1} w={86 - i * 14} />
            <rect
              x={W - 78}
              y={y}
              width={50 - i * 8}
              height="8"
              rx="4"
              fill={i === 0 ? 'var(--accent)' : 'var(--border-strong)'}
            />
          </g>
        );
      })}
    </Frame>
  );
}

/** Управляющим — дом и очередь обращений от жителей */
function OperatorPreview() {
  return (
    <Frame>
      {/* Дом: корпус и окна */}
      <rect x="18" y="26" width="64" height={H - 52} rx="8" fill="var(--surface)" />
      {[0, 1, 2].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`${r}-${c}`}
            x={30 + c * 22}
            y={38 + r * 18}
            width="14"
            height="10"
            rx="2"
            fill={r === 0 && c === 1 ? 'var(--accent)' : 'var(--border-strong)'}
          />
        )),
      )}

      {/* Обращения жителей: три строки со статусами */}
      {[0, 1, 2].map((i) => {
        const y = 28 + i * 22;
        return (
          <g key={i}>
            <rect x="94" y={y} width={W - 112} height="18" rx="9" fill="var(--surface)" />
            <circle
              cx="106"
              cy={y + 9}
              r="4"
              fill={i === 0 ? 'var(--accent)' : 'var(--border-strong)'}
            />
            <Bar x={116} y={y + 6} w={78 - i * 16} />
          </g>
        );
      })}
    </Frame>
  );
}

const BY_KIND = {
  client: ClientPreview,
  master: MasterPreview,
  business: BusinessPreview,
  operator: OperatorPreview,
};

export type AudienceKind = keyof typeof BY_KIND;

export default function AudiencePreview(props: { kind: AudienceKind }) {
  const View = BY_KIND[props.kind];
  return <View />;
}
