/** L-10 — публичная карточка дома по коду с наклейки в подъезде. */
export const building = {
  'building.metaTitle': 'Дом — SOZO',
  'building.loading': 'Загружаем…',
  'building.callMaster': 'Вызвать мастера · {phone}',

  'building.emergencyTitle': 'Аварийная служба дома',
  'building.operator': 'Обслуживает {operator}',

  'building.shutdownsTitle': 'Ближайшие отключения',

  'building.appTitle': 'В приложении удобнее',
  'building.appLead':
    'Заявка в два тапа, статус мастера, оповещения об отключениях и пропуск гостю.',
  'building.appCta': 'Скачать приложение',

  // Дом не подключён — собираем спрос: житель видит, чего лишён
  'building.demandTitle': 'Этот дом ещё не подключён',
  'building.demandLead':
    'Жители подключённых домов подают заявки из приложения, заранее узнают об отключениях и выписывают пропуска гостям. Оставьте адрес — мы покажем вашей управляющей компании, сколько людей этого ждёт.',
  'building.demandAddressLabel': 'Адрес дома',
  'building.demandAddressPlaceholder': 'улица, номер дома',
  'building.demandPhoneLabel': 'Телефон, необязательно',
  'building.demandSubmit': 'Моего дома здесь нет',
  'building.demandSentTitle': 'Спасибо.',
  'building.demandSentLead':
    'Мы посчитаем ваше обращение и свяжемся с управляющей компанией дома.',

  // Подписи статусов подключения дома (PublicBuilding.connectionStatus).
  // Значение приходит от API английским ключом — переводится только подпись
  'building.statusUnmanaged': 'Дом не подключён',
  'building.statusClaimed': 'Заявка на подключение подана',
  'building.statusVerified': 'Дом подтверждён',
  'building.statusActive': 'Дом подключён',
  'building.statusDegraded': 'Подключён с ограничениями',
};
