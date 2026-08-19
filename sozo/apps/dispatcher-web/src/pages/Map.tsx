import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import { OrderModal } from '../components/OrderModal';
import { ErrorBanner, Loading } from '../components/States';
import { URGENCY_LABELS, graphTypeLabel, statusLabel } from '../dicts';
import { formatSoums } from '../format';
import type { MapData, MapMaster, MapOrder } from '../types';
import { useFetch } from '../useFetch';

/** Центр Ташкента и обзорный масштаб города. */
const CENTER: [number, number] = [41.311, 69.279];
const ZOOM = 12;

/** Карта смены живёт без ручного обновления: данные перезапрашиваются раз в 20 секунд. */
const REFRESH_MS = 20_000;

/** Заявка «висит» дольше часа на пути к мастеру — кандидат на звонок клиенту (ТЗ 17.3). */
const RISK_AGE_MIN = 60;
const RISK_STATUSES = new Set(['assigned', 'master_departed']);

/** Цвета маркеров — только из дизайн-токенов (hex живёт в tokens.css). */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v !== '' ? v : fallback;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type LayerKey = 'masters' | 'orders' | 'urgent' | 'emergencies' | 'locations';

const LAYER_LABELS: Record<LayerKey, string> = {
  masters: 'Мастера на визите',
  orders: 'Заявки активные',
  emergencies: 'Аварийные',
  urgent: 'Срочные',
  locations: 'Объекты B2B',
};

/** Порядок слоёв в панели: аварийные и срочные выделены отдельными переключателями. */
const LAYER_ORDER: LayerKey[] = ['masters', 'orders', 'emergencies', 'urgent', 'locations'];

/** Слой заявки: аварийные и срочные — отдельно, чтобы диспетчер мог оставить на карте только их. */
function orderLayer(o: MapOrder): LayerKey {
  if (o.urgency === 'emergency') return 'emergencies';
  if (o.urgency === 'urgent') return 'urgent';
  return 'orders';
}

/** Мастер на карте — только пока идёт визит; иначе координат нет (ТЗ 17.5). */
function isOnMap(m: MapMaster): boolean {
  return m.lat !== null && m.lng !== null;
}

function masterPopup(m: MapMaster): string {
  const order =
    m.orderNumber !== null
      ? `${esc(m.orderNumber)} · ${esc(statusLabel(m.orderStatus ?? ''))}`
      : 'нет активной заявки';
  const stale = m.stale
    ? `<br/><strong>гео не обновлялось ${m.minutesSinceMove ?? 0} мин — риск срыва</strong>`
    : '';
  return (
    `<strong>${esc(m.masterName)}</strong><br/>` +
    `Текущая заявка: ${order}<br/>` +
    `Активных заявок: ${m.ordersActive}${stale}`
  );
}

function orderPopup(o: MapOrder): string {
  return (
    `<strong>${esc(o.number)}</strong> · ${esc(statusLabel(o.status))}<br/>` +
    `${esc(graphTypeLabel(o.graphType))} · ${esc(URGENCY_LABELS[o.urgency] ?? o.urgency)}<br/>` +
    `${esc(o.address)}<br/>` +
    `${esc(o.clientPhone)}<br/>` +
    `Мастер: ${esc(o.masterName ?? 'не назначен')}<br/>` +
    `${esc(formatSoums(o.totalFromTiyin))} · ${o.ageMinutes} мин<br/>` +
    `Клик по маркеру — карточка заявки`
  );
}

/** D-03: карта города — активные заявки, мастера на визите и объекты B2B (PRD-03). */
export function MapPage() {
  const { data, loading, error, reload } = useFetch<MapData>(() => api.get<MapData>('/dispatch/map'));
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    masters: true,
    orders: true,
    urgent: true,
    emergencies: true,
    locations: true,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupsRef = useRef<Record<LayerKey, L.LayerGroup> | null>(null);

  // Карта создаётся один раз: автообновление меняет только содержимое слоёв, без мигания.
  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) return;
    const map = L.map(containerRef.current).setView(CENTER, ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);
    groupsRef.current = {
      masters: L.layerGroup().addTo(map),
      orders: L.layerGroup().addTo(map),
      urgent: L.layerGroup().addTo(map),
      emergencies: L.layerGroup().addTo(map),
      locations: L.layerGroup().addTo(map),
    };
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      groupsRef.current = null;
    };
  }, []);

  // Наполнение слоёв: только circleMarker, дефолтные иконки Leaflet не используются.
  useEffect(() => {
    const groups = groupsRef.current;
    if (groups === null || data === null) return;
    (Object.keys(groups) as LayerKey[]).forEach((k) => groups[k].clearLayers());

    const accent = cssVar('--accent', '#C15F3C');
    const success = cssVar('--success', '#7D9B76');
    const warning = cssVar('--warning', '#D4A27F');
    const errorColor = cssVar('--error', '#B3563E');
    const secondary = cssVar('--text-secondary', '#6E6B63');

    for (const loc of data.locations) {
      L.circleMarker([loc.lat, loc.lng], {
        radius: 6,
        color: secondary,
        fillColor: secondary,
        fillOpacity: 0.8,
        weight: 1,
      })
        .bindPopup(
          `<strong>${esc(loc.name)}</strong><br/>${esc(loc.organization)}<br/>${esc(loc.address)}`,
        )
        .addTo(groups.locations);
    }

    for (const m of data.masters) {
      if (!isOnMap(m)) continue;
      // Просроченное гео — красный маркер: это триггер протокола замены (ТЗ 17.3).
      const color = m.stale ? errorColor : accent;
      L.circleMarker([m.lat as number, m.lng as number], {
        radius: 9,
        color,
        fillColor: color,
        fillOpacity: 0.9,
        weight: 1,
      })
        .bindPopup(masterPopup(m))
        .addTo(groups.masters);
    }

    for (const o of data.orders) {
      const layer = orderLayer(o);
      const style =
        layer === 'emergencies'
          ? { radius: 10, color: errorColor, fillColor: errorColor }
          : layer === 'urgent'
            ? { radius: 8, color: warning, fillColor: warning }
            : { radius: 7, color: success, fillColor: success };
      const marker = L.circleMarker([o.lat, o.lng], { ...style, fillOpacity: 0.9, weight: 1 })
        .bindPopup(orderPopup(o))
        .addTo(groups[layer]);
      // Попап показывается наведением, клик открывает карточку заявки поверх карты (D-06).
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());
      marker.on('click', () => {
        marker.closePopup();
        setOpenId(o.id);
      });
    }

    // Аварийные — поверх всех остальных маркеров.
    groups.emergencies.eachLayer((l) => (l as L.CircleMarker).bringToFront());
  }, [data]);

  // Видимость слоёв по чекбоксам.
  useEffect(() => {
    const map = mapRef.current;
    const groups = groupsRef.current;
    if (map === null || groups === null) return;
    (Object.keys(groups) as LayerKey[]).forEach((k) => {
      if (visible[k] && !map.hasLayer(groups[k])) map.addLayer(groups[k]);
      if (!visible[k] && map.hasLayer(groups[k])) map.removeLayer(groups[k]);
    });
  }, [visible, data]);

  // Автообновление: данные подменяются в тех же слоях, карта не пересоздаётся.
  useEffect(() => {
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const orders = data?.orders ?? [];
  const masters = data?.masters ?? [];
  const onMap = masters.filter(isOnMap);
  const offMap = masters.filter((m) => !isOnMap(m));
  // Мастера без визита помечены stale по умолчанию — в риски идут только те, кто на карте.
  const staleMasters = onMap.filter((m) => m.stale);
  const riskOrders = orders.filter(
    (o) => o.ageMinutes > RISK_AGE_MIN && RISK_STATUSES.has(o.status),
  );

  const legendItems: { color: string; label: string }[] = [
    { color: cssVar('--accent', '#C15F3C'), label: 'Мастер на визите' },
    { color: cssVar('--error', '#B3563E'), label: 'Авария / гео устарело' },
    { color: cssVar('--warning', '#D4A27F'), label: 'Срочная заявка' },
    { color: cssVar('--success', '#7D9B76'), label: 'Активная заявка' },
    { color: cssVar('--text-secondary', '#6E6B63'), label: 'Объект B2B' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Карта города</h1>
        <button type="button" className="btn" onClick={reload}>
          Обновить
        </button>
      </div>

      <div className="banner banner--warning">
        Гео мастера доступно только на время активной заявки — постоянной слежки нет (ТЗ 17.5).
        Позиция берётся с адреса текущего визита; точное гео появится с приложением мастера.
      </div>

      <div className="map-panel">
        {LAYER_ORDER.map((k) => (
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
          Заявок: {orders.length} · Мастеров на карте: {onMap.length} · Объектов B2B:{' '}
          {data?.locations.length ?? 0} · обновление каждые {REFRESH_MS / 1000} сек
        </span>
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && data === null && <Loading />}

      <div className="map-layout">
        <div className="map-shell">
          <div ref={containerRef} className="map-canvas" />
          <div className="map-legend">
            {legendItems.map((item) => (
              <div key={item.label} className="map-legend__row">
                <span className="map-legend__dot" style={{ background: item.color }} />
                {item.label}
              </div>
            ))}
          </div>
        </div>

        <div className="map-side">
          <div className="card">
            <div className="section-title">Мастера вне карты</div>
            {offMap.length === 0 && <div className="muted">Все активные мастера на визитах</div>}
            {offMap.map((m) => (
              <div key={m.masterId} className="map-side__row">
                <div className="map-side__title">{m.masterName}</div>
                <div className="map-side__note">
                  Активных заявок: {m.ordersActive} · нет активного визита — гео недоступно (ТЗ 17.5)
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="section-title">Риски</div>
            {riskOrders.length === 0 && staleMasters.length === 0 && (
              <div className="muted">Просроченных заявок и зависшего гео нет</div>
            )}
            {riskOrders.map((o) => (
              <div key={o.id} className="map-side__row map-side__row--warning">
                <div className="map-side__title">{o.number}</div>
                <div className="map-side__note">
                  {statusLabel(o.status)} · {o.ageMinutes} мин с создания
                </div>
                <button type="button" className="btn btn--link" onClick={() => setOpenId(o.id)}>
                  Открыть
                </button>
              </div>
            ))}
            {staleMasters.map((m) => (
              <div key={m.masterId} className="map-side__row map-side__row--error">
                <div className="map-side__title">{m.masterName}</div>
                <div className="map-side__note">
                  гео не обновлялось {m.minutesSinceMove ?? 0} мин — риск срыва
                  {m.orderNumber !== null ? ` · ${m.orderNumber}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {openId !== null && (
        <OrderModal orderId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}
