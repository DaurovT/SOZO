import { useState } from 'react';
import { useT } from '../i18n';
import { AppRow, AppTabbar, Phone } from './Phone';

type TabId = 'client' | 'master' | 'business';

/** Подпись таба — ключ словаря: переводится подпись, а не идентификатор. */
const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'client', labelKey: 'components.appShowcase.tabClient' },
  { id: 'master', labelKey: 'components.appShowcase.tabMaster' },
  { id: 'business', labelKey: 'components.appShowcase.tabBusiness' },
];

const COPY: Record<TabId, { titleKey: string; leadKey: string; pointKeys: string[]; noteKey: string }> = {
  client: {
    titleKey: 'components.appShowcase.client.title',
    leadKey: 'components.appShowcase.client.lead',
    pointKeys: [
      'components.appShowcase.client.point1',
      'components.appShowcase.client.point2',
      'components.appShowcase.client.point3',
      'components.appShowcase.client.point4',
      'components.appShowcase.client.point5',
    ],
    noteKey: 'components.appShowcase.client.note',
  },
  master: {
    titleKey: 'components.appShowcase.master.title',
    leadKey: 'components.appShowcase.master.lead',
    pointKeys: [
      'components.appShowcase.master.point1',
      'components.appShowcase.master.point2',
      'components.appShowcase.master.point3',
      'components.appShowcase.master.point4',
      'components.appShowcase.master.point5',
    ],
    noteKey: 'components.appShowcase.master.note',
  },
  business: {
    titleKey: 'components.appShowcase.business.title',
    leadKey: 'components.appShowcase.business.lead',
    pointKeys: [
      'components.appShowcase.business.point1',
      'components.appShowcase.business.point2',
      'components.appShowcase.business.point3',
      'components.appShowcase.business.point4',
      'components.appShowcase.business.point5',
    ],
    noteKey: 'components.appShowcase.business.note',
  },
};

function ClientScreen() {
  const t = useT();
  return (
    <>
      <AppRow
        title={t('components.appShowcase.clientScreen.orderTitle')}
        sub={t('components.appShowcase.clientScreen.orderSub')}
        badge={t('components.appShowcase.clientScreen.orderBadge')}
        badgeTone="live"
      >
        <div className="progress" aria-hidden="true">
          <span />
        </div>
        <span className="app-sub">{t('components.appShowcase.clientScreen.orderEta')}</span>
      </AppRow>
      <AppRow
        title={t('components.appShowcase.clientScreen.masterTitle')}
        sub={t('components.appShowcase.clientScreen.masterSub')}
        badge={t('components.appShowcase.clientScreen.masterBadge')}
      />
      <AppRow
        title={t('components.appShowcase.clientScreen.quoteTitle')}
        sub={t('components.appShowcase.clientScreen.quoteSub')}
        badge={t('components.appShowcase.clientScreen.quoteBadge')}
      />
      <AppRow title={t('components.appShowcase.clientScreen.photosTitle')}>
        <div className="app-photos">
          <img className="app-photo" src="/photos/work/ba-before.webp" alt="" loading="lazy" />
          <img className="app-photo" src="/photos/work/ba-after.webp" alt="" loading="lazy" />
        </div>
      </AppRow>
      <div className="app-cta">{t('components.appShowcase.clientScreen.cta')}</div>
      <AppTabbar active={0} />
    </>
  );
}

function MasterScreen() {
  const t = useT();
  return (
    <>
      <AppRow
        title={t('components.appShowcase.masterScreen.earnTitle')}
        sub={t('components.appShowcase.masterScreen.earnSub')}
        badge={t('components.appShowcase.masterScreen.earnBadge')}
      />
      <AppRow
        title={t('components.appShowcase.masterScreen.newTitle')}
        sub={t('components.appShowcase.masterScreen.newSub')}
        badge={t('components.appShowcase.masterScreen.newBadge')}
        badgeTone="live"
      >
        <span className="app-sub">{t('components.appShowcase.masterScreen.newShare')}</span>
      </AppRow>
      <AppRow
        title={t('components.appShowcase.masterScreen.todayTitle')}
        sub={t('components.appShowcase.masterScreen.todaySub')}
        badge="14:20"
      />
      <AppRow
        title={t('components.appShowcase.masterScreen.photosTitle')}
        badge={t('components.appShowcase.masterScreen.photosBadge')}
        badgeTone="ok"
      >
        <div className="app-photos">
          <img className="app-photo" src="/photos/work/panel-close.webp" alt="" loading="lazy" />
          <img className="app-photo" src="/photos/work/electric-panel.webp" alt="" loading="lazy" />
        </div>
      </AppRow>
      <div className="app-cta">{t('components.appShowcase.masterScreen.cta')}</div>
      <AppTabbar active={1} />
    </>
  );
}

function BusinessScreen() {
  const t = useT();
  return (
    <>
      <AppRow
        title={t('components.appShowcase.businessScreen.incidentTitle')}
        sub={t('components.appShowcase.businessScreen.incidentSub')}
        badge={t('components.appShowcase.businessScreen.incidentBadge')}
        badgeTone="live"
      >
        <div className="progress" aria-hidden="true">
          <span />
        </div>
      </AppRow>
      <AppRow
        title={t('components.appShowcase.businessScreen.spendTitle')}
        sub={t('components.appShowcase.businessScreen.spendSub')}
      >
        <div className="bars" aria-hidden="true">
          {[38, 52, 30, 64, 44, 72, 50, 58].map((h, i) => (
            <i
              key={i}
              className={i === 5 ? 'on' : ''}
              style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </AppRow>
      <AppRow
        title={t('components.appShowcase.businessScreen.balanceTitle')}
        sub={t('components.appShowcase.businessScreen.balanceSub')}
        badge={t('components.appShowcase.businessScreen.balanceBadge')}
      />
      <AppRow
        title={t('components.appShowcase.businessScreen.actsTitle')}
        sub={t('components.appShowcase.businessScreen.actsSub')}
        badge={t('components.appShowcase.businessScreen.actsBadge')}
        badgeTone="ok"
      />
      <div className="app-cta">{t('components.appShowcase.businessScreen.cta')}</div>
      <AppTabbar active={2} />
    </>
  );
}

const SCREENS: Record<TabId, () => JSX.Element> = {
  client: ClientScreen,
  master: MasterScreen,
  business: BusinessScreen,
};

/**
 * Рассказ о трёх приложениях SOZO одним блоком: клиент, мастер, бизнес.
 * Табы переключают и текст, и макет телефона — без перезагрузки секции.
 */
export default function AppShowcase() {
  const t = useT();
  const [tab, setTab] = useState<TabId>('client');
  const copy = COPY[tab];
  const Screen = SCREENS[tab];
  const title = t(copy.titleKey);

  return (
    <div className="stack-lg">
      <div className="tabs" role="tablist" aria-label={t('components.appShowcase.tabsAria')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            className="tab"
            aria-selected={tab === item.id}
            aria-controls={`app-panel-${item.id}`}
            id={`app-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div
        className="grid-2 tabpanel"
        role="tabpanel"
        id={`app-panel-${tab}`}
        aria-labelledby={`app-tab-${tab}`}
        key={tab}
        style={{ alignItems: 'center' }}
      >
        <div className="stack-lg">
          <div className="stack-sm">
            <h3 className="h2">{title}</h3>
            <p className="lead">{t(copy.leadKey)}</p>
          </div>
          <ul className="stack-sm">
            {copy.pointKeys.map((key) => (
              <li className="tick" key={key}>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">{t(copy.noteKey)}</p>
        </div>

        <Phone label={title}>
          <Screen />
        </Phone>
      </div>
    </div>
  );
}
