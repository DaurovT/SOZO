import { Link } from 'react-router-dom';
import { useFetch } from '../useFetch';

/**
 * Мастер первичной настройки объекта (U-13, DEV-15 §14.1).
 *
 * Чек-лист готовности на этом экране был и раньше, но он только называл
 * пробел: «не заполнен реестр помещений». Куда идти и что нажимать —
 * человек искал сам, по семнадцати пунктам меню. Для внедренца это
 * секунды, для управляющего, который открыл кабинет впервые, — причина
 * закрыть вкладку.
 *
 * Поэтому здесь каждый шаг ведёт прямо к своему экрану и объясняет
 * последствие, а не требование. «Не указан аварийный телефон» — это
 * запрет; «жителю некуда позвонить ночью при аварии» — это причина.
 *
 * Два шага не блокируют активацию и всё равно показаны: стояки и зоны
 * общего имущества. Без стояков не считается зона влияния отключения — и
 * объект активируется, а жители предупреждения не получат. Такие вещи
 * обнаруживаются в первую же аварию, если о них не сказать заранее.
 */

interface Summary {
  unitsTotal: number;
  units: Array<{ riserIds: string[] }>;
}

interface Staff {
  id: string;
  fullName: string;
  staffRole: string;
  isBackup: boolean;
}

interface Zone {
  id: string;
  zoneType: string;
}

interface Step {
  done: boolean;
  blocking: boolean;
  title: string;
  why: string;
  to: string;
  action: string;
}

export function SetupWizard({
  buildingId,
  emergencyPhone,
  isActive,
}: {
  buildingId: string;
  emergencyPhone: string | null;
  isActive: boolean;
}) {
  const summary = useFetch<Summary>(`/buildings/${buildingId}/residents-summary`, [buildingId]);
  const staff = useFetch<Staff[]>(`/buildings/${buildingId}/staff`, [buildingId]);
  const zones = useFetch<Zone[]>(`/buildings/${buildingId}/zones`, [buildingId]);

  // Пока грузится — не мигаем пустым чек-листом: он читается как «ничего не
  // сделано» и пугает ровно того, кто уже всё сделал
  if (summary.loading || staff.loading || zones.loading) return null;

  const units = summary.data?.unitsTotal ?? 0;
  const withoutRiser = (summary.data?.units ?? []).filter((u) => u.riserIds.length === 0).length;
  const approvers = (staff.data ?? []).filter((s) => s.staffRole === 'approver');
  const zoneCount = zones.data?.length ?? 0;

  const steps: Step[] = [
    {
      done: units > 0,
      blocking: true,
      title: units > 0 ? `Реестр помещений — ${units}` : 'Заполнить реестр помещений',
      why: 'Без реестра заявка не привязывается к квартире, а отключение не знает, кого касается. Загружается файлом из Excel — по одному вводить не нужно.',
      to: '/units',
      action: units > 0 ? 'Дополнить' : 'Загрузить из файла',
    },
    {
      done: units > 0 && withoutRiser === 0,
      blocking: false,
      title: withoutRiser > 0 ? `У ${withoutRiser} помещений не указан стояк` : 'Стояки указаны',
      why: 'По стояку считается зона влияния отключения. Без него объект активируется, но жители таких помещений предупреждения не получат — и узнают об отключении воды по факту.',
      to: '/units',
      action: 'Открыть реестр',
    },
    {
      done: zoneCount > 0,
      blocking: false,
      title: zoneCount > 0 ? `Зоны общего имущества — ${zoneCount}` : 'Завести зоны общего имущества',
      why: 'Наряд-допуск выписывается на зону: подвал, кровля, стояк. Пока зон нет, подрядчику некуда выписать допуск.',
      to: '/passport',
      action: 'Открыть паспорт дома',
    },
    {
      done: approvers.length > 0,
      blocking: true,
      title: approvers.length > 0 ? `Согласующий доступ — ${approvers[0].fullName}` : 'Назначить согласующего доступ',
      why: 'Это человек, которому придёт SMS со ссылкой, когда мастеру нужно попасть в подвал или на кровлю. Без него работы на общем имуществе не согласовать.',
      to: '/people',
      action: 'Назначить',
    },
    {
      done: approvers.some((a) => a.isBackup),
      blocking: true,
      title: approvers.some((a) => a.isBackup) ? 'Резервный согласующий назначен' : 'Назначить резервного согласующего',
      why: 'Основной согласующий бывает в отпуске и вне связи. Резервный — единственное, что отличает «подождём до понедельника» от прорыва стояка в выходные.',
      to: '/people',
      action: 'Назначить',
    },
    {
      done: Boolean(emergencyPhone),
      blocking: true,
      title: emergencyPhone ? `Аварийный телефон — ${emergencyPhone}` : 'Указать круглосуточный аварийный телефон',
      why: 'Этот номер житель видит первым на странице дома и в приложении. Ночью при аварии звонят по нему.',
      to: '/settings',
      action: 'Указать',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const blockers = steps.filter((s) => s.blocking && !s.done);
  if (isActive && !blockers.length && doneCount === steps.length) return null;

  return (
    <div className="card" style={{ padding: 'var(--s16)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s12)' }}>
        <h2 className="h2" style={{ fontSize: 17 }}>Настройка объекта</h2>
        <span className="cap">
          {doneCount} из {steps.length}
          {blockers.length > 0 && ` · до активации осталось ${blockers.length}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s12)', marginTop: 'var(--s16)' }}>
        {steps.map((s) => (
          <div
            key={s.title}
            style={{
              display: 'flex',
              gap: 'var(--s12)',
              padding: 'var(--s12)',
              borderRadius: 8,
              background: s.done ? 'transparent' : 'rgba(240,140,30,.05)',
              border: `1px solid ${s.done ? 'var(--border)' : 'rgba(240,140,30,.3)'}`,
            }}
          >
            <span
              aria-hidden
              style={{ color: s.done ? 'var(--success)' : 'var(--warning)', fontWeight: 700, lineHeight: '1.4' }}
            >
              {s.done ? '✓' : s.blocking ? '!' : '·'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              {/* Причина показывается только там, где шаг не сделан: у
                  сделанного она уже не нужна и превращает список в стену */}
              {!s.done && <div className="dense cap" style={{ marginTop: 'var(--s4)' }}>{s.why}</div>}
            </div>
            {!s.done && (
              <Link to={s.to} style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                {s.action} →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
