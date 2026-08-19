/**
 * Фотографии лендинга.
 *
 * ВАЖНО: сейчас это стоковые снимки-плейсхолдеры (public/photos). Перед запуском
 * маркетинг заменяет их на съёмку своих мастеров и своих объектов — пути остаются
 * теми же, поэтому подмена файла не требует правок кода.
 */

export const PHOTO = {
  heroMain: '/photos/work/hero-main.webp',
  electricPanel: '/photos/work/electric-panel.webp',
  panelClose: '/photos/work/panel-close.webp',
  panelWork: '/photos/work/panel-work.webp',
  helmetPanel: '/photos/work/helmet-panel.webp',
  plumbingSink: '/photos/work/plumbing-sink.webp',
  bathroom: '/photos/work/bathroom.webp',
  heater: '/photos/work/heater.webp',
  boiler: '/photos/work/boiler.webp',
  faucet: '/photos/work/faucet.webp',
  climate: '/photos/work/climate.webp',
  roofHvac: '/photos/work/roof-hvac.webp',
  beforeShot: '/photos/work/ba-before.webp',
  afterShot: '/photos/work/ba-after.webp',
} as const;

/**
 * Картинка для плитки категории. Категории приходят из активного релиза прайса,
 * поэтому подбираем по ключевому слову, а не по точному совпадению строки;
 * для незнакомой категории берём фото по кругу — плитка не остаётся пустой.
 */
const BY_KEYWORD: [RegExp, string][] = [
  [/сантех/i, PHOTO.plumbingSink],
  [/электр/i, PHOTO.panelClose],
  [/кондиц|вентил|климат/i, PHOTO.climate],
  [/выезд|диагност/i, PHOTO.helmetPanel],
  [/сваро/i, PHOTO.boiler],
  [/демонтаж|бурен|штробл/i, PHOTO.panelWork],
  [/быт(овая)? техник/i, PHOTO.heater],
  [/маляр|отделоч/i, PHOTO.bathroom],
  [/пол|потол/i, PHOTO.bathroom],
  [/окн|двер|балкон/i, PHOTO.roofHvac],
  [/слаботоч|интернет|безопасн/i, PHOTO.electricPanel],
  [/муж на час|универсал/i, PHOTO.faucet],
  [/сервис/i, PHOTO.helmetPanel],
];

const CYCLE = [PHOTO.electricPanel, PHOTO.plumbingSink, PHOTO.climate, PHOTO.bathroom];

export function categoryPhoto(category: string, index = 0): string {
  const hit = BY_KEYWORD.find(([re]) => re.test(category));
  return hit ? hit[1] : CYCLE[index % CYCLE.length];
}
