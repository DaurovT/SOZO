export type QA = { q: string; a: string };

/**
 * Вопросы-ответы на нативном <details>: раскрытие работает без JS,
 * поиск и скринридеры видят весь текст.
 */
export default function Faq(props: { items: QA[] }) {
  return (
    <div className="faq">
      {props.items.map((item) => (
        <details className="faq-item" key={item.q}>
          <summary>{item.q}</summary>
          <p className="faq-answer">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
