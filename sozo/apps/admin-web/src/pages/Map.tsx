import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { ErrorBanner, Loading } from '../components/States';
import type { MapData, MapOrder } from '../types';

/** Русские подписи статусов конвейера заявок (DEV-10 / PRD-03). */
const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  estimated: 'Оценена',
  pending_approval: 'На утверждении',
  approved: 'Утверждена',
  assigned: 'Назначена',
  master_departed: 'Мастер выехал',
  in_progress: 'В работе',
  addwork_approval: 'Доп-согласование',
  completed: 'Выполнена',
  verified: 'Проверена',
  awaiting_payment: 'Ожидает оплаты',
  dispute: 'Спор',
  closed: 'Закрыта',
  cancelled: 'Отменена',
  rated: 'Оценена клиентом',
};

/** Цвета маркеров — из дизайн-токенов (hex только в tokens.css). */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v !== '' ? v : fallback;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type LayerKey = 'locations' | 'activeOrders' | 'archivedOrders' | 'emergencies';

const LAYER_LABELS: Record<LayerKey, string> = {
  locations: 'Точки B2B',
  activeOrders: 'Заявки B2C активные',
  archivedOrders: 'Заявки закрытые/архив',
  emergencies: 'Аварийные',
};

/** Слой заявки: аварийные активные — поверх остальных отдельным слоем. */
function orderLayer(o: MapOrder): LayerKey {
  if (o.urgency === 'emergency' && o.active) return 'emergencies';
  return o.active ? 'activeOrders' : 'archivedOrders';
}

/** A-01: карта точек B2B и заявок (Leaflet + OpenStreetMap). */
export function MapPage() {
  const { data, loading, error, reload } = useFetch<MapData>(() =>
    api.get<MapData>('/admin/dashboard/map'),
  );
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    locations: true,
    activeOrders: true,
    archivedOrders: true,
    emergencies: true,
  });

  const mapRef = useRef<L.Map | null>(null);
  const groupsRef = useRef<Record<LayerKey, L.LayerGroup> | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Инициализация по callback-ref: карта создаётся ровно тогда, когда контейнер
  // появился в DOM. Через useEffect([]) карта не создавалась бы вовсе, если на
  // первом рендере вместо контейнера показан «Загрузка…».
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      mapRef.current?.remove();
      mapRef.current = null;
      groupsRef.current = null;
      setMapReady(false);
      return;
    }
    if (mapRef.current !== null) return;
    const map = L.map(node).setView([41.311, 69.279], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    groupsRef.current = {
      locations: L.layerGroup().addTo(map),
      activeOrders: L.layerGroup().addTo(map),
      archivedOrders: L.layerGroup().addTo(map),
      emergencies: L.layerGroup().addTo(map),
    };
    mapRef.current = map;
    setMapReady(true);
  }, []);

  // Наполнение слоёв при загрузке данных
  useEffect(() => {
    const groups = groupsRef.current;
    if (groups === null || data === null) return;
    (Object.keys(groups) as LayerKey[]).forEach((k) => groups[k].clearLayers());

    const accent = cssVar('--accent', '#C15F3C');
    const success = cssVar('--success', '#7D9B76');
    const secondary = cssVar('--text-secondary', '#6E6B63');
    const errorColor = cssVar('--error', '#B3563E');

    for (const loc of data.locations) {
      L.circleMarker([loc.lat, loc.lng], {
        radius: 10,
        color: accent,
        fillColor: accent,
        fillOpacity: 0.9,
        weight: 1,
      })
        .bindPopup(
          `<strong>${esc(loc.name)}</strong><br/>${esc(loc.organization)}<br/>${esc(loc.address)}`,
        )
        .addTo(groups.locations);
    }

    for (const o of data.orders) {
      const layer = orderLayer(o);
      const style =
        layer === 'emergencies'
          ? { radius: 9, color: errorColor, fillColor: errorColor, fillOpacity: 0.9, weight: 1 }
          : layer === 'activeOrders'
            ? { radius: 7, color: success, fillColor: success, fillOpacity: 0.9, weight: 1 }
            : {
                radius: 5,
                color: secondary,
                fillColor: secondary,
                fillOpacity: 0.5,
                opacity: 0.5,
                weight: 1,
              };
      L.circleMarker([o.lat, o.lng], style)
        .bindPopup(
          `<strong>${esc(o.number)}</strong><br/>` +
            `${esc(ORDER_STATUS_LABELS[o.status] ?? o.status)}<br/>` +
            `${esc(o.clientPhone)}<br/>${esc(o.address)}<br/>${esc(formatSoums(o.totalFromTiyin))}`,
        )
        .addTo(groups[layer]);
    }
    // Аварийные — поверх остальных
    groups.emergencies.eachLayer((l) => (l as L.CircleMarker).bringToFront());
  }, [data, mapReady]);

  // Видимость слоёв по чекбоксам
  useEffect(() => {
    const map = mapRef.current;
    const groups = groupsRef.current;
    if (map === null || groups === null) return;
    (Object.keys(groups) as LayerKey[]).forEach((k) => {
      if (visible[k] && !map.hasLayer(groups[k])) map.addLayer(groups[k]);
      if (!visible[k] && map.hasLayer(groups[k])) map.removeLayer(groups[k]);
    });
  }, [visible, data, mapReady]);

  const orders = data?.orders ?? [];
  const activeCount = orders.filter((o) => o.active).length;
  const archivedCount = orders.length - activeCount;

  const legendItems: Array<{ color: string; label: string }> = [
    { color: cssVar('--accent', '#C15F3C'), label: 'Точки B2B' },
    { color: cssVar('--success', '#7D9B76'), label: 'Активные заявки' },
    { color: cssVar('--text-secondary', '#6E6B63'), label: 'Закрытые/архив' },
    { color: cssVar('--error', '#B3563E'), label: 'Аварийные' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Карта клиентов</h1>
        <button type="button" className="btn" onClick={reload}>
          Обновить
        </button>
      </div>
      <div className="map-panel">
        {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
          <label key={k} className="map-panel__filter">
            <input
              type="checkbox"
              checked={visible[k]}
              onChange={(e) => setVisible((v) => ({ ...v, [k]: e.target.checked }))}
            />
            {LAYER_LABELS[k]}
          </label>
        ))}
        <span className="muted">
          Точек B2B: {data?.locations.length ?? 0} · Активных заявок: {activeCount} · В архиве:{' '}
          {archivedCount}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Координаты заявок — заглушка геокодера; интеграция Yandex/Google Maps — PRD-05 §12.4.
      </p>
      {error !== null && <ErrorBanner message={error} />}
      {loading && data === null && <Loading />}
      <div className="map-shell">
        <div ref={setContainer} className="map-canvas" />
        <div className="map-legend">
          {legendItems.map((item) => (
            <div key={item.label} className="map-legend__row">
              <span className="map-legend__dot" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
