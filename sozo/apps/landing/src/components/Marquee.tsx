/**
 * Бегущая строка фактов. Список дублируется один раз — за счёт этого
 * translateX(-50%) даёт бесшовную петлю без JS и без пересчёта ширины.
 */
export default function Marquee(props: { items: string[] }) {
  const doubled = [...props.items, ...props.items];
  return (
    <div className="marquee" aria-label={props.items.join('. ')}>
      <div className="marquee-track" aria-hidden="true">
        {doubled.map((item, i) => (
          <span className="marquee-item" key={`${item}-${i}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
