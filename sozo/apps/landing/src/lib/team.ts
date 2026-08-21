/**
 * Витрина мастеров для лендинга.
 *
 * ВАЖНО: сейчас это демо-состав с фотостоковыми снимками (public/photos/masters).
 * Перед публичным запуском маркетинг заменяет фото и имена на реальных мастеров
 * с их письменного согласия на использование изображения.
 *
 * Сознательно НЕ показываем рейтинги и число закрытых заявок: на старте таких данных
 * нет, а выдуманная точность («★4.9, 1240 работ») бьёт по доверию сильнее, чем помогает.
 * Оценки из системы можно будет вывести, когда они появятся (фаза 2).
 */

/**
 * Имя, специальность и район — подписи, и потому лежат ключами словаря, а не
 * строками. Имя тоже: «Ильхом» на французской странице пишется «Ilhom», а на
 * корейской — «일홈». Кириллица посреди корейской витрины читается как сбой.
 */
export type Master = {
  id: string;
  /** Ключ словаря: masters.<id>.name */
  nameKey: string;
  /** Ключ словаря: masters.<id>.role */
  roleKey: string;
  photo: string;
  years: number;
  /** Русское название района — подпись берётся через `zoneLabel` */
  zone: string;
};

export const MASTERS: Master[] = [
  {
    id: 'ilhom',
    nameKey: 'masters.ilhom.name',
    roleKey: 'masters.ilhom.role',
    photo: '/photos/masters/ilhom.webp',
    years: 12,
    zone: 'Юнусабад',
  },
  {
    id: 'bekzod',
    nameKey: 'masters.bekzod.name',
    roleKey: 'masters.bekzod.role',
    photo: '/photos/masters/bekzod.webp',
    years: 9,
    zone: 'Мирабад',
  },
  {
    id: 'rustam',
    nameKey: 'masters.rustam.name',
    roleKey: 'masters.rustam.role',
    photo: '/photos/masters/rustam.webp',
    years: 7,
    zone: 'Чиланзар',
  },
  {
    id: 'otabek',
    nameKey: 'masters.otabek.name',
    roleKey: 'masters.otabek.role',
    photo: '/photos/masters/otabek.webp',
    years: 6,
    zone: 'Сергели',
  },
  {
    id: 'sardor',
    nameKey: 'masters.sardor.name',
    roleKey: 'masters.sardor.role',
    photo: '/photos/masters/sardor.webp',
    years: 4,
    zone: 'Яккасарай',
  },
  {
    id: 'shuhrat',
    nameKey: 'masters.shuhrat.name',
    roleKey: 'masters.shuhrat.role',
    photo: '/photos/masters/shuhrat.webp',
    years: 18,
    zone: 'Мирзо-Улугбек',
  },
];
