/**
 * Строки, зашитые внутри переиспользуемых компонентов: витрина приложений,
 * обвязка форм, слайдер «до/после», лента мастеров, кнопки магазинов.
 *
 * Подписи, которые компонент получает пропсом, сюда не попадают: их переводит
 * та страница, которая компонент вызывает.
 */
export const components = {
  // ---------- Рамка телефона (Phone) ----------
  'components.phone.screenAria': 'Экран приложения SOZO',

  // ---------- Слайдер «до / после» (BeforeAfter) ----------
  'components.beforeAfter.before': 'До',
  'components.beforeAfter.after': 'После',
  'components.beforeAfter.sliderAria': '{alt}: сравнение до и после',
  'components.beforeAfter.altBefore': '{alt} — до работы',
  'components.beforeAfter.altAfter': '{alt} — после работы',

  // ---------- Лента мастеров (MasterRail) ----------
  'components.masterRail.photoAlt': '{name} — {role} SOZO',
  'components.masterRail.verified': 'Проверен',

  // ---------- Обвязка форм (form.tsx) ----------
  'components.form.honeypot': 'Не заполняйте это поле',
  'components.form.phoneLabel': 'Телефон',
  'components.form.phoneHint': 'Например, +998 90 123-45-67',
  'components.form.consent': 'Согласен на обработку персональных данных (ЗРУ-547)',
  'components.form.stepperDecrease': 'Уменьшить',
  'components.form.stepperIncrease': 'Увеличить',
  'components.form.ticketLabel': 'Номер обращения',

};
