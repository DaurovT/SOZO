/** Страница «Анкета мастера» (L-06): форма кандидата и экран успеха. */
export const apply = {
  'apply.eyebrow': 'Работа в SOZO',
  'apply.title': 'Анкета мастера',
  'apply.lead': 'Расскажите о себе — рекрутер свяжется и назначит проверку навыков.',

  'apply.nameLabel': 'Имя',
  'apply.skillsLegend': 'Что умеете',
  'apply.experienceLegend': 'Опыт работы *',
  'apply.transportLegend': 'Транспорт *',
  'apply.zonesLegend': 'Районы Ташкента, где готовы работать',

  // Опыт и транспорт: в API уезжает код ('<1', 'own_car'), переводится подпись
  'apply.experienceUnder1': 'Меньше 1 года',
  'apply.experience1to3': '1–3 года',
  'apply.experience3to5': '3–5 лет',
  'apply.experienceOver5': 'Больше 5 лет',
  'apply.transportOwnCar': 'Свой автомобиль',
  'apply.transportPublic': 'Общественный транспорт',
  'apply.transportNone': 'Нет транспорта',

  'apply.submit': 'Отправить анкету',
  'apply.submitting': 'Отправляем…',

  // Боковая колонка
  'apply.nextTitle': 'Что будет после анкеты',
  'apply.step1': 'Рекрутер позвонит за 2 рабочих дня и ответит на вопросы',
  'apply.step2': 'Назначим проверку навыков по вашей специальности',
  'apply.step3': 'Выдадим бейдж и доступ в приложение',
  'apply.step4': 'Выйдете на линию и начнёте брать заявки',
  'apply.mastersNote': 'С нами уже работают мастера по 6 специальностям',
  'apply.termsTitle': 'Коротко об условиях',
  'apply.termsSummary': 'Доля до 57% · выплаты каждую неделю · график свой',
  'apply.termsLink': 'Подробные условия →',

  // Экран успеха. {sla} — срок ответа словами, его даёт useSla()
  'apply.successTitle': 'Анкета принята',
  'apply.successLead':
    'Свяжемся в течение {sla}, чтобы обсудить условия и назначить практический экзамен.',
  'apply.backToTerms': 'Вернуться к условиям',
};
