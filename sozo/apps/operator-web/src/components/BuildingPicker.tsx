import { useSearchParams } from 'react-router-dom';
import type { Dashboard } from '../types';

/**
 * Выбор объекта в шапке экрана. Оператор с портфелем переключается здесь,
 * а не через смену контекста: смена роли ради просмотра другого дома —
 * лишний шаг (DEV-15 §10.9.5).
 */
export function BuildingPicker({ dash }: { dash: Dashboard | null }) {
  const [params, setParams] = useSearchParams();
  const objects = dash?.objects ?? [];
  const selected = params.get('building') ?? objects[0]?.buildingId ?? '';

  if (objects.length === 0) return null;
  return (
    <select
      className="input"
      style={{ width: 240, marginLeft: 'auto' }}
      value={selected}
      onChange={(e) => setParams({ building: e.target.value })}
    >
      {objects.map((o) => (
        <option key={o.buildingId} value={o.buildingId}>{o.name}</option>
      ))}
    </select>
  );
}

/** Текущий объект: из адреса либо первый в портфеле */
export function useSelectedBuilding(dash: Dashboard | null): string | null {
  const [params] = useSearchParams();
  return params.get('building') ?? dash?.objects[0]?.buildingId ?? null;
}
