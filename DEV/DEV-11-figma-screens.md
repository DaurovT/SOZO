# DEV-11. Экраны макета мастера — план переноса 1:1

Файл Figma: `bkWLIGVxuERol2YJRbL47M`
Ссылка: https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled

## Правила переноса

1. **Один в один.** Ничего не придумывать, ничего не пропускать. Числа (размеры,
   отступы, скругления, кегли, цвета) берутся из `get_design_context`, а не на глаз.
2. **Экраны делаются строго по очереди**, сверху вниз по этому списку. Никаких
   параллельных агентов: каждый экран сверяется с макетом до перехода к следующему.
3. **Шапка и таббар — единые на всех экранах.** Один компонент `SozoAppBar`
   и один `MasterShell`-таббар; локальных вариантов не заводить.
4. Иконки — только выгруженные из макета SVG (`assets/icons/`). Material-иконки
   в новых экранах запрещены.
5. Цвета и радиусы — только через `design_tokens.dart`. Новый цвет из макета
   сначала попадает в токены, потом в экран.
6. После всех экранов — повторная критическая сверка каждого экрана со скриншотом
   макета глазами сеньор-дизайнера.

## Список экранов

| # | Узел | Имя фрейма в макете | Файл в приложении | Готово |
|---|------|---------------------|-------------------|--------|
| 0 | `21:5` | home-screen | `screens/today_screen.dart` | ✅ |
| 1 | `26:172` | route-map-screen | `screens/route_screen.dart` | ✅ |
| 2 | `30:4` | order-detail-screen | `screens/order_screen.dart` | ✅ |
| 3 | `36:4` | work-stages-screen | `screens/stages_helper_payment.dart` → `StagesScreen` | ✅ |
| 4 | `41:4` | client-equipment-screen | `screens/order_extras.dart` → `AssetScreen` | ✅ |
| 5 | `43:4` | purchase-code-screen | `screens/resources_screens.dart` → `PurchaseCodeScreen` | ✅ |
| 6 | `43:88` | payment-basic | `screens/stages_helper_payment.dart` → `PaymentScreen` | ✅ |
| 7 | `43:124` | payment-qr-expanded | там же, состояние с QR | ✅ |
| 8 | `43:165` | payment-cash-modal | там же, `showSozoConfirm` | ✅ |
| 9 | `43:208` | payment-with-toast | там же, тёмный тост | ✅ |
| 10 | `51:6` | wallet-screen | `screens/wallet_screen.dart` | ✅ |
| 11 | `51:109` | schedule-screen | `screens/profile_extras.dart` → `ScheduleScreen` | ✅ |
| 12 | `58:4` | schedule-date-picker | `widgets/absence_dialog.dart` | ✅ |
| 13 | `58:297` | profile-screen | `screens/profile_screen.dart` | ✅ |
| 14 | `58:571` | rating-screen | `screens/resources_screens.dart` → `RatingScreen` | ✅ |
| 15 | `58:657` | specialist-id-screen | `screens/badge_screen.dart` | ✅ |
| 16 | `58:755` | tool-inspection-screen | `screens/profile_extras.dart` → `ToolCheckScreen` | ✅ |
| 17 | `53:617` | screen-1 = «Сумка» | `screens/resources_screens.dart` → `StockScreen` | ✅ |
| 18 | `53:475` | screen-2 = лист пополнения | там же, `_refill` | ✅ |
| 19 | `53:693` | my-documents-screen | `screens/profile_screen.dart` → `DocumentsListScreen` | ✅ |
| 20 | `53:753` | my-permits-screen | `screens/profile_screen.dart` → `SkillsScreen` | ✅ |
| 21 | `74:4` | notifications-screen | `screens/notifications_screen.dart` | ✅ |
| 22 | `77:5` | login-phone-screen | `screens/login_screen.dart` | ✅ |
| 23 | `77:38` | login-sms-screen | там же, состояние с кодом | ✅ |

## Ссылки на узлы

1. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=26-172
2. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=30-4
3. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=36-4
4. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=41-4
5. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=43-4
6. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=43-88
7. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=43-124
8. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=43-165
9. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=43-208
10. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=51-6
11. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=51-109
12. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=58-4
13. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=58-297
14. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=58-571
15. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=58-657
16. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=58-755
17. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=53-617
18. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=53-475
19. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=53-693
20. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=53-753
21. https://www.figma.com/design/bkWLIGVxuERol2YJRbL47M/Untitled?node-id=74-4

## Что появилось в коде

Шапка и таббар: `widgets/app_chrome.dart` — `SozoAppBar` (60, кнопка «назад»
36 с янтарным кругом 30 и стрелкой 20, заголовок 17/bold по центру, правый слот
36), `SozoTabHeader` (та же шапка без «назад»), `SozoTabBar` (вкладка 70,
активная пилюля 48×32/r16, иконка home 20, остальные 22).

Блоки макета: `widgets/figma_blocks.dart` — FigmaCard, CardTitle, AmberAction,
FigmaDivider, NoteBox, InfoBanner, WarningBanner, AdminNote, ActionTile,
IconBadge, FigmaNavRow, RowGroup, StepMarker, BigButton, DarkButton,
DangerTextButton, OutlineAmberButton, OutlineIconButton, ChoicePill, CheckboxRow,
SmallChipButton, ScreenHeading, StickyFooter, TagChip, OutlinedCard,
StatusListRow, DoneBadge, FigmaStatusChip, showSozoConfirm.

Календарь-диапазон: `widgets/absence_dialog.dart`.

Иконки: 45 SVG в `assets/icons/`, все выгружены из макета.

## Иконки

Набор закрыт: **77 SVG в `assets/icons/`, все из макета**. Системных иконок
Material в приложении не осталось ни одной — `Icons.` и `IconData` больше
нигде не встречаются.

Последние 16 (узлы `97:2`…`112:2`): `bolt` 14, `clock` 18, `hourglass` 18,
`search` 20, `camera-off` 20, `cloud-off` 18, `car` 20, `pen` 20, `face` 20,
`user-x` 20, `keypad` 20, `play` 18, `rotate-ccw` 20, `book` 20,
`graduation-cap` 20, `upload` 20.

**Требования к новым файлам:** SVG, квадратный `viewBox` по размеру, только
обводка (`stroke`), толщина 2, `stroke-linecap="round"`, без заливки, цвет
`#8E939F` (перекрашивается в коде). Имя слоя в Figma становится именем файла.

Счётчики «+» и «−» — не иконки, а текст в кружке 28 (`QtyStepper`), как
нарисовано в макете (узел 53:556).

Не задействованы пока две: `camera-off` (пригодится, когда появится экран
отказа камеры) и `star-20` (дубль `star` под размер 20).

## Проверка экранов

`test/screens_smoke_test.dart` строит **все 43 экрана** приложения на
заполненных данных. Сервер подменён заглушкой `HttpOverrides`, которая на
любой запрос отдаёт объединённый ответ со всеми полями, какие читают экраны:
31 день в календаре, две заявки, разбивка рейтинга, коды закупки, вопросы
экзамена. Тест падает на любом исключении во время построения.

Пустого состояния для такой проверки мало: календарь графика падал только на
непустом месяце, а экзамен — только на пустом списке вопросов. Оба случая
теперь в тесте.

Что тест поймал при первом прогоне:

1. **График был пустым экраном.** Последний ряд календаря добивался пустыми
   клетками через `List.cast`, а в приведённый список `null` не добавить —
   падало на любом месяце, где число дней не делится на 9.
2. **Экзамен падал**, если сервер вернул пустой список вопросов.
3. **Пустое состояние резалось полосой** в узких местах — не помещалось
   по высоте.
4. **Переключатель «Срочно»** в смете стоял на цветной панели и не давал
   отклика на нажатие (Material-ассерт).

Отдельно, глазами: иконка «Главная» в таббаре была невидимой — выгружена из
активного состояния макета с белой обводкой. Цвет иконок таббара теперь
задаётся в коде, а не берётся из файла.

## Журнал сверки

**Адаптации (сделаны сознательно, каждая — с причиной):**

1. **Карта маршрута** — реальные тайлы OSM вместо нарисованного в макете
   стилизованного плана города. Из макета взяты пины (36, белая обводка 3,
   тень 0 4 4), карточка маршрута и шапка.
2. **Таббар на вложенных экранах.** В макете таббар нарисован и на карте
   маршрута, хотя она открывается из «Главной». Экран открывается поверх —
   таббар там не рисуем, иначе вкладки на нём не работали бы.
3. **Высота шапки.** В макете 45 / 48 / 56 / 60 / 64 / 65 / 68. Взяли 60
   (самый частый вариант, он же у большинства экранов) — иначе шапка «прыгает»
   при переходах.
4. **Серый текст.** В макете три близких оттенка: `#8E939F`, `#7E7E82`,
   `#8E95A5`. Свели к `#8E939F`. Разница неразличима, а три токена на одно
   и то же — источник расхождений в будущем.
5. **Отступ под таббаром.** В макете 20 px; на устройстве берём системный
   отступ, но не меньше 20 — иначе подписи упираются в индикатор «домой».
6. **Тоггл «Сегодня / Завтра»** на главной оставлен растягивающимся вместо
   жёстких 294 px: на узком экране фиксированная ширина вылезала бы за край.
7. **Кнопки без иконок.** В макете у кнопок нет иконок, кроме специально
   нарисованных (зонтик, галочка, буфер, мегафон, треугольник). Параметр
   `icon` у `PrimaryButton` / `SecondaryButton` убран совсем.
8. **Экран входа: скругления 14 → по лестнице.** В макете поле и кнопка входа
   со скруглением 14 — четвёртое значение поверх уже сведённых 12 / 16 / 20.
   Взяли поле 12, кнопку 16. Разница в 2 px незаметна, а лестница осталась одна.
9. **Экран входа: высота кнопки 52 → 56** — по тому же правилу, что и везде.
10. **Адрес сервера на экране входа** в макете не нарисован, но оставлен:
    браузер ходит на localhost, телефон — на IP в Wi-Fi, боевой аппарат — на
    домен. Без переключателя в тестовый контур не войти. Спрятан в строку
    внизу, при тапе разворачивается в поле.

**Расхождения внутри самого макета — сведены к одному правилу:**

- **Скругления.** В макете 12 (кошелёк), 16 (сумка, заявки графика), 20
  (большинство), 24 (профиль, рейтинг, инструмент, документы, модалки).
  Свели к лестнице: карточка и модалка 20 → кнопка и плитка 16 → поле и
  плашка 12 → бейдж 8. Соседние экраны больше не выглядят собранными из
  разных приложений.
- **Тени карточек убраны совсем.** В макете их нет у большинства экранов, а
  у кошелька, сумки, графика и уведомлений — четыре разной силы. На светло-сером
  фоне белая карточка и без тени читается слоем. Тени остались там, где несут
  смысл: карточка над картой, пин на карте, удостоверение на тёмном фоне.
- **Уведомления** переведены с эмодзи на иконки набора: на остальных двадцати
  экранах иконки, эмодзи выбивался и по стилю, и по толщине штриха.
- **Высота кнопок.** В макете внутренний отступ давал ~47. Вернули нижнюю
  границу 56 (DEV-09 §5 п.1): на объекте в мороз, в перчатке, 47 мало.

---

## Реестр экранов контура «Дом» (M7/M8)

Макетов в Figma на момент версии **нет** — экраны проектируются с нуля по DEV-08 §3.N, DEV-09 §N и PRD-07. Столбец «Узел» заполняется по мере отрисовки. **Работа дизайна обязана опережать разработку на спринт** (DEV-15 §10.8.4): без макетов Flutter-разработчик встанет на первом же экране.

| Приложение | Экраны | Источник спецификации | Макет |
|---|---|---|---|
| Клиент | C-51…C-54, C-56, C-57 | PRD-01 §3.N, DEV-08 §3.N | ⬜ нет |
| Клиент | C-55 (голосования) | — | ⬜ фаза 2 |
| Мастер | M-43…M-45 | PRD-02 §3.N, DEV-09 §N | ⬜ нет |
| Мастер | M-46…M-50 | там же | ⬜ нет (M8) |
| Диспетчерская | D-21…D-23 | PRD-03 §3.21–3.23 | ⬜ нет |
| Админка | A-39…A-44 | PRD-04 | ⬜ нет |
| **Кабинет оператора** | U-01…U-16 | **PRD-07** | ⬜ нет |
| Лендинги | L-09, L-10 | PRD-06 §3.9, §3.11 | ⬜ нет |
| Веб-карточка | W-06 | PRD-06 §3.12 | ⬜ нет |

**Изменяемые существующие экраны** (макеты есть, требуется правка): C-05, C-10, **C-11 (переработан по смыслу)**, C-13, C-14, C-24, C-25, C-29, C-30; M-06, M-07, M-11, **M-14 (переработан)**, M-34; D-02, D-06, D-07, D-08, D-12, D-13, **D-16 (расщеплён)**; A-05, A-09, A-11, A-33.

**Отдельно по простому режиму (C-57):** это не экран, а **тема поверх существующих** — макет нужен на набор токенов §4.M DEV-06 и на три состояния главного экрана, а не на каждый экран приложения.
