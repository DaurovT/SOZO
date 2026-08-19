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

export type Master = {
  id: string;
  name: string;
  role: string;
  photo: string;
  years: number;
  zone: string;
};

export const MASTERS: Master[] = [
  {
    id: 'ilhom',
    name: 'Ильхом',
    role: 'Сантехник',
    photo: '/photos/masters/ilhom.webp',
    years: 12,
    zone: 'Юнусабад',
  },
  {
    id: 'bekzod',
    name: 'Бекзод',
    role: 'Электрик',
    photo: '/photos/masters/bekzod.webp',
    years: 9,
    zone: 'Мирабад',
  },
  {
    id: 'rustam',
    name: 'Рустам',
    role: 'Кондиционеры',
    photo: '/photos/masters/rustam.webp',
    years: 7,
    zone: 'Чиланзар',
  },
  {
    id: 'otabek',
    name: 'Отабек',
    role: 'Муж на час',
    photo: '/photos/masters/otabek.webp',
    years: 6,
    zone: 'Сергели',
  },
  {
    id: 'sardor',
    name: 'Сардор',
    role: 'Слаботочка',
    photo: '/photos/masters/sardor.webp',
    years: 4,
    zone: 'Яккасарай',
  },
  {
    id: 'shuhrat',
    name: 'Шухрат',
    role: 'Отделка и мебель',
    photo: '/photos/masters/shuhrat.webp',
    years: 18,
    zone: 'Мирзо-Улугбек',
  },
];
