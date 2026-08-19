/** Плашка макет-экрана: показывает фазу реализации и зависимость (инфраструктуру или договор). */
export function MockBanner({ phase, dependsOn }: { phase: string; dependsOn: string }) {
  return (
    <div className="banner banner--warning">
      <span className="semibold">Макет (данные вшиты).</span> {phase} — реализация после:{' '}
      {dependsOn}.
    </div>
  );
}
