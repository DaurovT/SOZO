import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../geo.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/blocks.dart';
import '../../widgets/figma_icon.dart';
import '../../widgets/order_card.dart';
import '../../widgets/photo_grid.dart';
import 'submitted_screen.dart';

/// Визард создания заявки: C-07 → C-10 → C-13 (DEV-08 §2.2).
///
/// Один модальный стек поверх таббара и один черновик на три шага: возврат
/// назад сохраняет введённое, а закрытие крестиком не теряет работу — черновик
/// переживает и убийство процесса (PRD-01 §6).
class CreateOrderFlow extends StatefulWidget {
  const CreateOrderFlow({super.key, this.emergency = false, this.category, this.repeatOrderId, this.query});

  /// Аварийный флоу: без фото и выбора времени, заявка уходит ближайшему мастеру
  final bool emergency;

  /// Категория, выбранная плиткой на C-06
  final String? category;

  /// «Повторить»: работы и адрес берутся из закрытой заявки
  final String? repeatOrderId;

  /// Запрос, введённый на главной: шаг 1 открывается сразу с результатами
  final String? query;

  @override
  State<CreateOrderFlow> createState() => _CreateOrderFlowState();
}

class _CreateOrderFlowState extends State<CreateOrderFlow> {
  final _draft = OrderDraft();
  int _step = 0;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  Map<String, dynamic>? _catalog;
  Map<String, dynamic>? _slots;
  List<Map<String, dynamic>> _addresses = [];

  /// Шагов всегда три.
  ///
  /// Раньше у аварийной заявки шаг «Где и когда» пропускался целиком, а адрес
  /// брался только из сохранённых. У нового человека сохранённых адресов нет —
  /// и самый срочный сценарий продукта уходил на сервер с пустым адресом:
  /// на экране итога он показывался пустой строкой, «Изменить» вело на шаг 1,
  /// где поля адреса нет, а отправка адрес не проверяла.
  ///
  /// Теперь шаг остаётся, но у аварии он урезан до адреса: выбирать окно
  /// приезда человеку с прорывом трубы действительно нечего.
  int get _totalSteps => 3;

  @override
  void initState() {
    super.initState();
    _draft.emergency = widget.emergency;
    _draft.category = widget.category;
    if (widget.query != null) {
      _query = widget.query!;
      _search.text = widget.query!;
    }
    _boot();
  }

  Future<void> _boot() async {
    try {
      final catalog = await session.api.catalog();
      final addresses = await session.api.addresses();
      OrderDraft? restored;
      if (widget.category == null && !widget.emergency && widget.repeatOrderId == null) {
        restored = await OrderDraft.restore();
      }
      if (widget.repeatOrderId != null) {
        final source = await session.api.order(widget.repeatOrderId!);
        _applyRepeat(source);
      }
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _addresses = ((addresses['addresses'] as List?) ?? const []).cast<Map<String, dynamic>>();
        if (restored != null) _restore(restored);
        // Чистим после восстановления И после повтора: оба кладут в черновик
        // идентификаторы позиций, которые мог унести новый релиз прайса
        _dropUnknownItems(catalog);
        // Основной адрес подставляется в новую заявку по умолчанию (C-29)
        if (_draft.address.isEmpty) {
          final primary = _addresses.where((a) => a['primary'] == true).firstOrNull ?? _addresses.firstOrNull;
          if (primary != null) {
            _draft.address = (primary['street'] as String?) ?? '';
            _draft.addressId = primary['id'] as String?;
            _draft.lat = (primary['lat'] as num?)?.toDouble();
            _draft.lng = (primary['lng'] as num?)?.toDouble();
          }
        }
        _loading = false;
      });
      unawaited(session.api.track('order_step_view', {'step': 1}));
    } on ApiError catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  /// Выбрасывает из черновика позиции, которых больше нет в каталоге.
  ///
  /// Черновик и повтор заявки хранят идентификаторы позиций прайса, а прайс
  /// живёт релизами: вышел новый — старые идентификаторы перестали существовать.
  /// Без этой чистки такой черновик доходил до отправки и падал на сервере,
  /// причём человек не понимал, какую именно работу у него не приняли.
  void _dropUnknownItems(Map<String, dynamic> catalog) {
    final known = <String>{};
    for (final c in ((catalog['categories'] as List?) ?? const []).cast<Map<String, dynamic>>()) {
      for (final i in ((c['items'] as List?) ?? const []).cast<Map<String, dynamic>>()) {
        final id = i['id'];
        if (id is String) known.add(id);
      }
    }
    _draft.items.removeWhere((id, _) => !known.contains(id));
  }

  /// Перенос лежит в самом черновике (`OrderDraft.copyFrom`), а не здесь.
  ///
  /// Здесь он был списком присваиваний, который отставал от `toJson` на семь
  /// полей и никак об этом не сообщал. Рядом с полями — единственное место,
  /// где расхождение видно глазом, и его же проверяет тест.
  void _restore(OrderDraft d) => _draft.copyFrom(d);

  void _applyRepeat(Map<String, dynamic> source) {
    for (final line in ((source['lines'] as List?) ?? const []).cast<Map<String, dynamic>>()) {
      final id = line['priceItemId'] as String?;
      if (id != null) _draft.items[id] = (line['qty'] as num?)?.toInt() ?? 1;
    }
    _draft.address = (source['address'] as String?) ?? '';
    _draft.description = (source['description'] as String?) ?? '';
  }

  List<Map<String, dynamic>> get _categories =>
      (((_catalog?['categories'] as List?) ?? const []).cast<Map<String, dynamic>>());

  List<Map<String, dynamic>> get _allItems =>
      _categories.expand((c) => ((c['items'] as List?) ?? const []).cast<Map<String, dynamic>>()).toList();

  Map<String, dynamic>? _itemById(String id) => _allItems.where((i) => i['id'] == id).firstOrNull;

  /// Цена выезда и диагностики — из того же прайса, откуда её берёт карточка
  /// первого запуска на главной. Сервер отдаёт её отдельным полем каталога,
  /// чтобы приложение не искало нужную позицию по русским словам в названии.
  int? get _visitPriceTiyin {
    final v = (_catalog?['visitPriceTiyin'] as num?)?.toInt();
    return v != null && v > 0 ? v : null;
  }

  /// Наценка «Срочно» — параметр каталога, а не зашитые 30%
  int get _urgentPercent => (_catalog?['urgentSurchargePercent'] as num?)?.toInt() ?? 30;

  /// Категория, выбранная в шаге 1, — целиком, со значком и подписью
  Map<String, dynamic>? get _selectedCategory =>
      _categories.where((c) => c['name'] == _draft.category).firstOrNull;

  /// Подытог вилки: пересчитывается на лету при каждом изменении состава
  (int from, int to) get _subtotal {
    var from = 0, to = 0;
    _draft.items.forEach((id, qty) {
      final item = _itemById(id);
      if (item == null) return;
      from += ((item['priceFromTiyin'] as num?)?.toInt() ?? 0) * qty;
      to += ((item['priceToTiyin'] as num?)?.toInt() ?? 0) * qty;
    });
    return (from, to);
  }

  /// Этаж и лифт спрашиваем на шаге 2 только там, где они нужны планировщику:
  /// парная работа и работа с оборудованием (ТЗ 17.3)
  bool get _needsFloor => _draft.items.keys.any((id) {
        final i = _itemById(id);
        return i?['isPaired'] == true || i?['requiresEquipment'] == true;
      });

  bool get _hasStaged => _draft.items.keys.any((id) => _itemById(id)?['isStaged'] == true);

  /// Категории, где работы затрагивают общие зоны дома — тогда чек-лист C-11.
  ///
  /// Опознаём по значку категории, который присылает сервер, а не по русским
  /// подстрокам в названии: подстроки держатся ровно до первого релиза прайса
  /// с другим написанием и до первого языка, на котором «сантехника» пишется
  /// иначе. Названия при этом остаются запасным признаком — новая категория
  /// приезжает без своего значка, с общим «wrench».
  bool get _needsAccessChecklist {
    const iconsWithRisers = {'droplet', 'zap', 'flame'};
    final icon = _selectedCategory?['icon'] as String?;
    if (icon != null && iconsWithRisers.contains(icon)) return true;
    final c = (_draft.category ?? '').toLowerCase();
    return c.contains('сантех') || c.contains('электр') || c.contains('отоплен');
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: SozoColors.bg,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null && _catalog == null) {
      return Scaffold(
        backgroundColor: SozoColors.bg,
        appBar: SozoAppBar(title: t('c07.title')),
        body: ErrorState(message: _error!, onRetry: _boot),
      );
    }
    // Шаг времени пропускается у аварийной заявки
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: SozoColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _wizardHeader(),
              Expanded(
                child: switch (_step) {
                  0 => _stepWhat(),
                  1 => _stepWhere(),
                  _ => _stepReview(),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Шапка визарда (223:11): закрытие, название шага, полоса прогресса.
  ///
  /// Своя, а не общий аппбар: в макете под заголовком идёт полоса, а слева
  /// круглая кнопка закрытия на белом — у аппбара этого нет
  Widget _wizardHeader() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s8),
          child: Row(
            children: [
              // На последнем шаге кнопка янтарная (231:292): она уже не
              // «выйти», а «вернуться и поправить» — единственное действие,
              // кроме отправки
              Material(
                color: _step == _totalSteps - 1 ? SozoColors.accent : SozoColors.surface,
                borderRadius: BorderRadius.circular(100),
                child: InkWell(
                  borderRadius: BorderRadius.circular(100),
                  onTap: _step == 0 ? _close : _back,
                  child: Padding(
                    padding: EdgeInsets.all(_step == _totalSteps - 1 ? 10 : SozoSpace.s8),
                    child: FigmaIcon(_step == 0 ? 'circle-x' : 'arrow-left', size: 16, color: authInk),
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  children: [
                    Text(
                      switch (_step) {
                        0 => t('c07.title'),
                        1 => _draft.emergency ? t('c10.titleEmergency') : t('c10.title'),
                        _ => t('c13.title'),
                      },
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: authInk),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      t('create.step', {'n': _step + 1, 'total': _totalSteps}),
                      style: const TextStyle(fontSize: 13, color: authHint),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 32),
            ],
          ),
        ),
        const SizedBox(height: SozoSpace.s12),
        // Полоса заполняется долей пройденных шагов (223:20)
        SizedBox(
          height: 4,
          child: Row(
            children: [
              Expanded(flex: _step + 1, child: Container(color: SozoColors.accent)),
              Expanded(flex: _totalSteps - _step - 1, child: Container(color: authCardDivider)),
            ],
          ),
        ),
      ],
    );
  }

  void _back() {
    if (_step == 0) {
      _close();
    } else {
      setState(() => _step -= 1);
      unawaited(session.api.track('order_step_view', {'step': _step + 1}));
    }
  }

  Future<void> _close() async {
    _saveTimer?.cancel();
    if (_draft.isEmpty) {
      if (mounted) Navigator.of(context).pop();
      return;
    }
    final leave = await showSozoConfirm(
      context,
      title: t('create.closeTitle'),
      text: t('create.closeText'),
      confirmLabel: t('create.closeConfirm'),
      cancelLabel: t('create.closeCancel'),
    );
    if (!leave) return;
    await _draft.save();
    unawaited(session.api.track('order_draft_abandoned', {'step': _step + 1}));
    if (mounted) Navigator.of(context).pop();
  }

  /// Сохранение черновика с задержкой.
  ///
  /// Раньше черновик писался только на переходе вперёд и на закрытии — а шаг 3
  /// последний, «вперёд» после него не бывает. Промокод, этаж и лифт человек
  /// вводил, приложение выгружали из памяти, и введённое пропадало вместе с
  /// ним. Пишем на каждое изменение, но не на каждую букву: в черновике лежат
  /// фотографии, и запись в SharedPreferences на каждый символ адреса —
  /// мегабайты на пустом месте.
  Timer? _saveTimer;

  void _saveDraftSoon() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 700), () => unawaited(_draft.save()));
  }

  Future<void> _next() async {
    _saveTimer?.cancel();
    await _draft.save();
    unawaited(session.api.track('order_step_complete', {'step': _step + 1}));
    setState(() => _step += 1);
    unawaited(session.api.track('order_step_view', {'step': _step + 1}));
    // У аварии окон не спрашиваем — незачем и грузить
    if (_step == 1 && !_draft.emergency) await _loadSlots();
    if (_step == 1) unawaited(_centerOnMeIfAllowed());
  }

  /// Открыть карту там, где человек стоит, — молча и только если он уже
  /// разрешал доступ.
  ///
  /// Системного запроса здесь нет намеренно: диалог, которого человек не
  /// просил, он закрывает не читая, а второго раза Android не даёт. Тем, кто
  /// разрешения не давал, карта по-прежнему открывается в центре Ташкента —
  /// и рядом стоит «Найти меня», где вопрос будет задан по нажатию.
  ///
  /// Адрес не подставляем: человек ещё не сказал, что он именно здесь.
  /// Карта просто показывает его двор вместо площади Независимости.
  Future<void> _centerOnMeIfAllowed() async {
    // Адрес уже выбран из сохранённых или набран — не перебиваем
    if (_draft.address.trim().isNotEmpty || _draft.addressId != null) return;
    final place = await currentPlaceIfAllowed();
    if (!mounted || !place.ok) return;
    final point = LatLng(place.latitude!, place.longitude!);
    _mapCenter = point;
    _draft.lat = point.latitude;
    _draft.lng = point.longitude;
    _moveMap(point, 17);
    if (mounted) setState(() {});
  }

  Future<void> _loadSlots() async {
    try {
      final items = _draft.items.entries.map((e) => '${e.key}:${e.value}').join(',');
      final slots = await session.api.slots(items: items);
      if (mounted) setState(() => _slots = slots);
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    }
  }

  // ==================== C-07. Шаг 1 «Что сломалось» ====================

  final _search = TextEditingController();
  final _description = TextEditingController();
  bool _dontKnow = false;
  String _query = '';

  Widget _stepWhat() {
    final selectedCategory = _draft.category;
    final items = _query.trim().isNotEmpty
        ? _allItems
            .where((i) => ((i['name'] as String?) ?? '').toLowerCase().contains(_query.toLowerCase()))
            .toList()
        : (selectedCategory == null
            ? const <Map<String, dynamic>>[]
            : ((_categories.where((c) => c['name'] == selectedCategory).firstOrNull?['items'] as List?) ?? const [])
                .cast<Map<String, dynamic>>());
    final (from, to) = _subtotal;
    final canNext = _draft.items.isNotEmpty || (_dontKnow && _description.text.trim().isNotEmpty);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              // Поиск работы: клиент чаще знает слово («смеситель»), чем категорию
              Text(
                t('c07.searchLabel').toUpperCase(),
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: authHint),
              ),
              const SizedBox(height: SozoSpace.s8),
              Container(
                height: 48,
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  borderRadius: BorderRadius.circular(14),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Row(
                  children: [
                    const FigmaIcon('search', size: 18, color: authHint),
                    const SizedBox(width: SozoSpace.s8),
                    Expanded(
                      child: TextField(
                        controller: _search,
                        onChanged: (v) => setState(() => _query = v),
                        style: const TextStyle(fontSize: 14, color: authInk),
                        // Рамку рисует контейнер снаружи: без явного
                        // отключения тема добавляет свою, вторую
                        decoration: InputDecoration(
                          isDense: true,
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                          hintText: t('c07.searchHint'),
                          hintStyle: const TextStyle(fontSize: 14, color: authHint),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),


              if (_query.trim().isEmpty && selectedCategory == null) ...[
                SectionHeading(t('c07.pickCategory')),
                const SizedBox(height: SozoSpace.s12),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: SozoSpace.s12,
                    crossAxisSpacing: SozoSpace.s12,
                    childAspectRatio: 0.95,
                  ),
                  itemCount: _categories.length,
                  itemBuilder: (context, i) {
                    final c = _categories[i];
                    // Подпись и значок — клиентские, с сервера: в прайсе
                    // категория называется «ВЫЕЗД, ДИАГНОСТИКА», а человек
                    // ищет глазами «Не знаю, что сломалось»
                    return CategoryTile(
                      name: (c['label'] as String?) ?? (c['name'] as String?) ?? '',
                      iconKey: c['name'] as String?,
                      icon: c['icon'] as String?,
                      priceFromTiyin: (c['priceFromTiyin'] as num?)?.toInt() ?? 0,
                      onTap: () => setState(() => _draft.category = c['name'] as String?),
                    );
                  },
                ),
                // Выход для того, кто не может назвать работу, — здесь же,
                // а не только после выбора категории. Раньше он показывался
                // ниже списка работ, то есть за действием, которое человек
                // как раз и не может совершить
                const SizedBox(height: SozoSpace.s16),
                Center(child: InlineLink(t('c07.dontKnow'), align: TextAlign.center, onTap: _enableDontKnow)),
              ] else ...[
                // Выбранная категория — пилюля с обводкой (223:30)
                if (selectedCategory != null && _query.trim().isEmpty)
                  Row(
                    children: [
                      Material(
                        color: SozoColors.accent.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(100),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(100),
                          onTap: () => setState(() => _draft.category = null),
                          child: Container(
                            decoration: BoxDecoration(
                              border: Border.all(color: SozoColors.accent),
                              borderRadius: BorderRadius.circular(100),
                            ),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: SozoSpace.s8),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                FigmaIcon(
                                  (_selectedCategory?['icon'] as String?) ??
                                      CategoryTile.iconFor(selectedCategory) ??
                                      'wrench',
                                  size: 16,
                                  color: authInk,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  (_selectedCategory?['label'] as String?) ?? selectedCategory,
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: authInk),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 20),
                if (items.isEmpty)
                  EmptyState(
                    icon: 'search',
                    text: t('c07.nothingFound'),
                    actionLabel: t('c07.describeInstead'),
                    onAction: _enableDontKnow,
                  ),
                for (final item in items) ...[
                  _itemRow(item),
                  const SizedBox(height: 10),
                ],
                const SizedBox(height: 10),
                // Подчёркнутая ссылка, а не кнопка (223:92): это выход для
                // того, кто не может назвать работу, а не равнозначный выбор.
                // Янтарь на белом здесь не годится — 1,75:1
                Center(child: InlineLink(t('c07.dontKnow'), align: TextAlign.center, onTap: _enableDontKnow)),
              ],

              if (!_draft.emergency) ...[
                const SizedBox(height: SozoSpace.s24),
                SectionHeading(t('c07.photosTitle'), subtitle: t('c07.photosHint')),
                const SizedBox(height: SozoSpace.s12),
                PhotoGrid(
                  photos: [for (final p in _draft.photos) PhotoRef(dataUrl: p)],
                  onAdd: _addPhoto,
                  onRemove: (i) => setState(() => _draft.photos.removeAt(i)),
                ),
              ],

              const SizedBox(height: 20),
              SozoCard(
                children: [
                  SwitchRow(
                    icon: 'alert-triangle',
                    iconColor: homeDanger,
                    iconBg: homeDebtBg,
                    title: t('c07.emergency'),
                    subtitle: t('c07.emergencyHelp'),
                    value: _draft.emergency,
                    onChanged: (v) => setState(() => _draft.emergency = v),
                  ),
                  if (_draft.emergency)
                    SozoBanner(icon: 'info', tone: BannerTone.warn, text: t('c07.emergencyNote')),
                ],
              ),
              const SizedBox(height: SozoSpace.s16),
              SozoField(
                label: _dontKnow ? t('c07.descriptionRequired') : t('c07.description'),
                controller: _description,
                hint: t('c07.descriptionHint'),
                maxLines: 4,
                error: _dontKnow && _description.text.trim().isEmpty && _touchedDescription
                    ? t('c07.descriptionError')
                    : null,
                onChanged: (v) => setState(() {
                  _draft.description = v;
                  _touchedDescription = true;
                  _saveDraftSoon();
                }),
              ),
            ],
          ),
        ),
        // Футер (223:113): итог слева, кнопка справа — цена видна в момент
        // нажатия «Далее», а не отдельной строкой над ней
        _wizardFooter(
          label: t('c07.subtotal'),
          value: _draft.items.isEmpty ? null : range(from, to),
          action: t('common.next'),
          onTap: canNext ? _next : null,
          hint: _dontKnow ? t('c07.needDescription') : t('c07.needWork'),
        ),
      ],
    );
  }

  /// Нижняя панель визарда (223:113).
  ///
  /// `hint` — причина, по которой кнопка серая. Серый прямоугольник без
  /// объяснения посреди воронки человек читает как поломку приложения:
  /// он сделал всё, что видел, а дальше не пускают и не говорят почему.
  Widget _wizardFooter({
    required String label,
    String? value,
    required String action,
    VoidCallback? onTap,
    String? hint,
  }) {
    final inset = MediaQuery.paddingOf(context).bottom;
    return Container(
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: authCardDivider)),
      ),
      padding: EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, inset < 16 ? 16 : inset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (onTap == null && hint != null) ...[
            _footerHint(hint),
            const SizedBox(height: SozoSpace.s12),
          ],
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: const TextStyle(fontSize: 14, color: authHint)),
                    const SizedBox(height: 2),
                    Text(
                      value ?? '—',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: authInk,
                        fontFeatures: moneyFeatures,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              Material(
                color: onTap == null ? authDisabledBg : SozoColors.accent,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: onTap,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                    child: Text(
                      action,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: onTap == null ? authDisabledFg : authInk,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Строка «Осталось: …» над серой кнопкой
  Widget _footerHint(String text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const FigmaIcon('info', size: 16, color: SozoColors.textSecondary),
        const SizedBox(width: SozoSpace.s8),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 14, height: 1.3, color: SozoColors.textSecondary),
          ),
        ),
      ],
    );
  }

  /// Нижняя панель с одной кнопкой во всю ширину (231:103)
  Widget _wizardWideFooter(String label, {VoidCallback? onTap, bool busy = false, String? hint}) {
    final inset = MediaQuery.paddingOf(context).bottom;
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: SozoColors.surface,
        border: Border(top: BorderSide(color: authCardDivider)),
      ),
      padding: EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, inset < 16 ? 16 : inset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (onTap == null && !busy && hint != null) ...[
            _footerHint(hint),
            const SizedBox(height: SozoSpace.s12),
          ],
          Material(
            color: onTap == null ? authDisabledBg : SozoColors.accent,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: onTap,
              child: SizedBox(
                height: SozoSize.buttonPrimary,
                width: double.infinity,
                child: Center(
                  child: busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: authInk),
                        )
                      : Text(
                          label,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: onTap == null ? authDisabledFg : authInk,
                          ),
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Индекс выбранного дня в ленте дат (231:222)
  int _dayIndex = 0;

  /// Карточка выбора времени (231:46)
  Widget _timeCard(List<Map<String, dynamic>> days) {
    final day = days[_dayIndex.clamp(0, days.length - 1)];
    final windows = ((day['windows'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Container(
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(24)),
      padding: const EdgeInsets.all(SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('c10.whenTitle'),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
          ),
          const SizedBox(height: SozoSpace.s12),
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: days.length,
              separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
              itemBuilder: (context, i) {
                final active = i == _dayIndex;
                return _pill(
                  relativeDay('${days[i]['date']}T00:00:00'),
                  active: active,
                  onTap: () => setState(() => _dayIndex = i),
                );
              },
            ),
          ),
          // Праздник вызов не запрещает, но мастеров в этот день меньше —
          // честнее сказать заранее, чем удивить потом
          if (day['holiday'] != null) ...[
            const SizedBox(height: SozoSpace.s8),
            TagChip((day['holiday'] as String?) ?? '', bg: softWarnBg, fg: softWarnFg),
          ],
          const SizedBox(height: SozoSpace.s12),
          for (var r = 0; r < (windows.length + 1) ~/ 2; r++) ...[
            Row(
              children: [
                for (var c = 0; c < 2; c++)
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(left: c == 0 ? 0 : SozoSpace.s8),
                      child: r * 2 + c < windows.length
                          ? _slotPill(day, windows[r * 2 + c])
                          : const SizedBox(height: 40),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
        ],
      ),
    );
  }

  Widget _pill(String label, {required bool active, required VoidCallback onTap}) {
    return Material(
      color: active ? SozoColors.accent : SozoColors.bg,
      borderRadius: BorderRadius.circular(100),
      child: InkWell(
        borderRadius: BorderRadius.circular(100),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: SozoSpace.s8),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: active ? FontWeight.w700 : FontWeight.w600,
              color: authInk,
            ),
          ),
        ),
      ),
    );
  }

  Widget _slotPill(Map<String, dynamic> day, Map<String, dynamic> w) {
    final id = '${day['date']}:${w['startMin']}';
    final active = _draft.timeMode == 'slot' && _draft.slotFrom == id;
    return Material(
      color: active ? SozoColors.accent : SozoColors.bg,
      borderRadius: BorderRadius.circular(100),
      child: InkWell(
        borderRadius: BorderRadius.circular(100),
        onTap: () => setState(() {
          _draft.timeMode = 'slot';
          _draft.slotFrom = id;
          _draft.slotTo = w['label'] as String?;
        }),
        child: SizedBox(
          height: 40,
          child: Center(
            child: Text(
              (w['label'] as String?) ?? '',
              style: TextStyle(
                fontSize: 13,
                fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                color: authInk,
              ),
            ),
          ),
        ),
      ),
    );
  }

  bool _touchedDescription = false;

  void _enableDontKnow() {
    setState(() {
      _dontKnow = true;
      _draft.items.clear();
      _draft.category = null;
      _query = '';
      _search.clear();
    });
  }

  Widget _itemRow(Map<String, dynamic> item) {
    final id = item['id'] as String;
    final qty = _draft.items[id];
    final selected = qty != null;
    return Container(
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        // Выбранная обведена очень светлым янтарём (223:35) — подсказка,
        // а не рамка: главный признак выбора всё же галочка
        border: selected
            ? Border.all(color: SozoColors.accent.withValues(alpha: 0.1), width: 1.5)
            : null,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.card),
        onTap: () => setState(() => selected ? _draft.items.remove(id) : _draft.items[id] = 1),
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
        Row(
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: selected ? SozoColors.accent : SozoColors.surface,
                borderRadius: BorderRadius.circular(6),
                border: selected ? null : Border.all(color: wizardCheckboxBorder, width: 1.5),
              ),
              child: selected ? const Center(child: FigmaIcon('check', size: 14, color: authInk)) : null,
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (item['name'] as String?) ?? '',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: authInk),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${item['unit']} · ${priceFrom(item['priceFromTiyin'])}',
                    style: const TextStyle(fontSize: 14, color: authHint, fontFeatures: moneyFeatures),
                  ),
                ],
              ),
            ),
            if (selected) ...[
              const SizedBox(width: SozoSpace.s12),
              QtyStepper(value: qty, onChanged: (v) => setState(() => _draft.items[id] = v)),
            ],
          ],
        ),
        if (item['isStaged'] == true || item['isPaired'] == true) ...[
          const SizedBox(height: SozoSpace.s8),
          Wrap(
            spacing: SozoSpace.s4,
            runSpacing: SozoSpace.s4,
            children: [
              if (item['isStaged'] == true) TagChip(t('c07.staged')),
              if (item['isPaired'] == true) TagChip(t('c07.paired')),
            ],
          ),
        ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _addPhoto() async {
    if (_draft.photos.length >= 5) return;
    final data = await pickPhoto(context);
    if (data != null && mounted) setState(() => _draft.photos.add(data));
  }

  // ==================== C-10. Шаг 2 «Где и когда» ====================

  final _address = TextEditingController();
  final _floor = TextEditingController();
  bool _addressTouched = false;

  /// Ответ сервера про зону покрытия последнего проверенного адреса
  Map<String, dynamic>? _coverage;
  String _coverageFor = '';

  /// Проверяем адрес не на каждую букву, а когда он стал похож на адрес.
  ///
  /// Ошибку глотаем: проверка покрытия подсказывает, но не мешает — если
  /// сервер не ответил, человек всё равно должен суметь оформить заявку.
  Future<void> _checkCoverage(String address) async {
    final a = address.trim();
    if (a.length < 6 || a == _coverageFor) return;
    _coverageFor = a;
    try {
      final res = await session.api.addressCheck(a);
      if (mounted && _coverageFor == a) setState(() => _coverage = res);
    } catch (_) {
      // подсказка не обязательна
    }
  }

  Widget _stepWhere() {
    if (_address.text.isEmpty && _draft.address.isNotEmpty) _address.text = _draft.address;
    if (_floor.text.isEmpty && _draft.floor.isNotEmpty) _floor.text = _draft.floor;

    final days = ((_slots?['days'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final urgentAvailable = _slots?['urgentAvailable'] == true;
    final hasAddress = _draft.address.trim().isNotEmpty;
    // У аварийной заявки времени нет: мастер выезжает ближайший
    final timeChosen = _draft.emergency || _draft.timeMode != 'slot' || _draft.slotFrom != null;
    final canNext = hasAddress && timeChosen;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s16),
            children: [
              // Адрес целиком — одна карточка (231:22): сохранённые адреса,
              // карта, поле, этаж и «сохранить» отвечают на один вопрос «куда»,
              // и по отдельным плиткам их разносить незачем
              SozoCard(
                radius: 24,
                gap: SozoSpace.s16,
                children: [
                  if (_addresses.isNotEmpty)
                    SizedBox(
                      height: 34,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _addresses.length,
                        separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
                        itemBuilder: (context, i) {
                          final a = _addresses[i];
                          return _pill(
                            (a['label'] as String?) ?? (a['street'] as String? ?? ''),
                            active: _draft.addressId == a['id'],
                            onTap: () => setState(() {
                              _draft.addressId = a['id'] as String?;
                              _draft.address = (a['street'] as String?) ?? '';
                              _address.text = _draft.address;
                              _draft.lat = (a['lat'] as num?)?.toDouble();
                              _draft.lng = (a['lng'] as num?)?.toDouble();
                            }),
                          );
                        },
                      ),
                    ),

                  _map(),

                  // Карта раньше только записывала координаты в черновик и с
                  // полем адреса связана не была: человек двигал её на свой
                  // дом, видел пин на своём подъезде — и «Далее» оставалась
                  // серой, потому что переход требует непустой текст.
                  //
                  // Теперь карта заполняет поле: «Найти меня» ведёт к месту
                  // человека и подставляет название, «Я здесь» — то же самое
                  // для точки, которую он навёл сам. Когда геокодер молчит
                  // (а на аппаратах без сервисов Google его нет вовсе),
                  // в поле остаются координаты: мастеру точка полезнее строки,
                  // а человек видит, что именно уйдёт с заявкой
                  Text(
                    t('c10.mapHint'),
                    style: const TextStyle(fontSize: 14, height: 1.3, color: SozoColors.textSecondary),
                  ),
                  // «Найти меня» — первым и заметнее: это короткий путь, а
                  // «Я здесь» подтверждает точку, которую человек навёл сам
                  Row(
                    children: [
                      Expanded(
                        child: SecondaryButton(
                          t('c10.findMe'),
                          icon: 'navigation',
                          busy: _locating,
                          onTap: _locating ? null : _findMe,
                        ),
                      ),
                      const SizedBox(width: SozoSpace.s8),
                      SmallButton(
                        t('c10.iAmHere'),
                        icon: 'crosshair',
                        onTap: _locating ? null : _useMapPin,
                      ),
                    ],
                  ),

                  SozoField(
                    flat: true,
                    label: t('c10.addressLabel'),
                    controller: _address,
                    hint: t('c10.addressHint'),
                    helper: _needsFloor ? t('c10.floorWhy') : t('c10.detailsLater'),
                    error: _addressTouched && _draft.address.trim().isEmpty ? t('c10.addressError') : null,
                    onChanged: (v) => setState(() {
                      _draft.address = v;
                      _draft.addressId = null;
                      _addressTouched = true;
                      _checkCoverage(v);
                      _saveDraftSoon();
                    }),
                  ),

                  // Район вне зоны покрытия: сказать сразу, а не после отмены заявки
                  if (_coverage != null && _coverage!['inZone'] == false)
                    SozoBanner(
                      icon: 'map-pin',
                      tone: BannerTone.warn,
                      text: (_coverage!['message'] as String?) ?? '',
                    ),

                  if (_needsFloor) ...[
                    SozoField(
                      flat: true,
                      label: t('c10.floor'),
                      controller: _floor,
                      keyboardType: TextInputType.number,
                      onChanged: (v) {
                        _draft.floor = v;
                        _saveDraftSoon();
                      },
                    ),
                    SwitchRow(
                      title: t('c10.lift'),
                      subtitle: t('c10.liftHelp'),
                      value: _draft.hasLift ?? false,
                      onChanged: (v) => setState(() {
                        _draft.hasLift = v;
                        _saveDraftSoon();
                      }),
                    ),
                  ],

                  SwitchRow(
                    title: t('c10.saveAddress'),
                    value: _draft.saveAddress,
                    onChanged: (v) => setState(() {
                      _draft.saveAddress = v;
                      _saveDraftSoon();
                    }),
                  ),

                  if (_needsAccessChecklist)
                    SozoBanner(
                      icon: 'info',
                      tone: BannerTone.warn,
                      text: _accessSummary(),
                      actionLabel: t('c11.open'),
                      onAction: _openAccessSheet,
                    ),
                ],
              ),

              const SizedBox(height: SozoSpace.s16),

              // У аварийной заявки выбора времени нет — только адрес.
              // Спрашивать окно приезда у человека, у которого прорвало трубу,
              // не нужно; пропускать из-за этого весь шаг — тем более
              if (_draft.emergency)
                SozoBanner(icon: 'bolt', tone: BannerTone.danger, text: t('c10.emergencyNow'))
              else ...[
                // Время в своей карточке (231:46): сначала день лентой, потом
                // его окна сеткой в две колонки. Раньше дни шли друг под другом
                // со своими наборами окон — экран уезжал на три листа вниз
                if (days.isEmpty)
                  SozoBanner(icon: 'clock', text: t('c10.noWindows'))
                else
                  _timeCard(days),
                const SizedBox(height: SozoSpace.s16),

                if (_hasStaged) ...[
                  SozoBanner(icon: 'calendar', text: t('c10.stagedNote')),
                  const SizedBox(height: SozoSpace.s12),
                ],

                // Выбор времени взаимоисключающий: окно, «Срочно» или лист ожидания
                if (urgentAvailable)
                  RadioCard(
                    icon: 'bolt',
                    iconColor: SozoColors.accent,
                    title: t('c10.urgentTitle'),
                    subtitle: t('c10.urgentText'),
                    selected: _draft.timeMode == 'urgent',
                    onTap: () => setState(() {
                      _draft.timeMode = 'urgent';
                      _draft.slotFrom = null;
                    }),
                  ),
                const SizedBox(height: SozoSpace.s12),
                RadioCard(
                  icon: 'hourglass',
                  title: t('c10.waitlistTitle'),
                  subtitle: t('c10.waitlistText'),
                  selected: _draft.timeMode == 'waitlist',
                  onTap: () => setState(() {
                    _draft.timeMode = 'waitlist';
                    _draft.slotFrom = null;
                  }),
                ),
              ],
            ],
          ),
        ),
        _wizardWideFooter(
          t('common.next'),
          onTap: canNext ? _next : null,
          hint: !hasAddress ? t('c10.needAddress') : t('c10.needTime'),
        ),
      ],
    );
  }

  /// Куда сейчас смотрит центр карты — под кнопкой «Я здесь».
  /// Обновляется и без жеста: карта могла встать по сохранённому адресу
  LatLng? _mapCenter;

  /// Управление картой: нужно, чтобы увести её к найденному месту
  final _mapCtl = MapController();

  /// Увести карту к точке.
  ///
  /// В try не для красоты: `MapController` до того, как к нему прицепится
  /// `FlutterMap`, падает на позднем поле. Место человека может приехать
  /// раньше первого кадра карты — тогда двигать нечего, и точка всё равно
  /// доедет через `initialCenter`, который читает тот же `_mapCenter`.
  void _moveMap(LatLng point, double zoom) {
    try {
      _mapCtl.move(point, zoom);
    } catch (_) {
      // карта ещё не построена — центр возьмётся из `_mapCenter`
    }
  }

  /// Идёт поиск места или названия — кнопки в это время заняты
  bool _locating = false;

  /// «Найти меня»: место человека → карта → адрес словами.
  ///
  /// Разрешение спрашивается здесь, по нажатию, а не при запуске приложения:
  /// вопрос про геолокацию, заданный на первом экране, человек отклоняет не
  /// глядя, и второго раза система не даёт.
  ///
  /// Отказ ничего не ломает: карта остаётся там, где была, поле — тоже,
  /// а человек читает строкой, что именно случилось и что делать.
  Future<void> _findMe() async {
    setState(() => _locating = true);
    final place = await currentPlace();
    if (!mounted) return;
    if (!place.ok) {
      setState(() => _locating = false);
      showSozoToast(context, geoFailureText(place.failure!));
      return;
    }
    final point = LatLng(place.latitude!, place.longitude!);
    _mapCenter = point;
    // 17 — масштаб «виден двор и подъезды»: на 13 человек не отличит свой дом
    // от соседнего и подтвердит не ту точку
    _moveMap(point, 17);
    setState(() {
      _draft.lat = point.latitude;
      _draft.lng = point.longitude;
      _draft.addressId = null;
      _addressTouched = true;
    });
    await _fillAddressFrom(point, overwrite: false);
    if (mounted) setState(() => _locating = false);
  }

  /// Отметить дом пином — тем, что сейчас в центре карты.
  ///
  /// Пин полезен и сам по себе: мастеру точка нужнее строки. Название места
  /// подставляем поверх, когда геокодер отвечает; когда молчит — в поле
  /// остаются координаты, и человек дописывает подъезд словами.
  /// Готовый адрес не затираем: человек мог сначала напечатать, потом уточнить
  Future<void> _useMapPin() async {
    final c = _mapCenter ?? LatLng(_draft.lat ?? 41.311, _draft.lng ?? 69.279);
    setState(() {
      _draft.lat = c.latitude;
      _draft.lng = c.longitude;
      _draft.addressId = null;
      _addressTouched = true;
      _locating = true;
    });
    await _fillAddressFrom(c, overwrite: false);
    if (mounted) setState(() => _locating = false);
  }

  /// Записать в поле название точки, а если его нет — координаты.
  ///
  /// `overwrite: false` — не трогаем то, что человек уже набрал руками:
  /// он мог указать «второй подъезд, домофон 12», и геокодер этого не знает.
  Future<void> _fillAddressFrom(LatLng point, {required bool overwrite}) async {
    final typed = _address.text.trim().isNotEmpty;
    if (typed && !overwrite) {
      if (mounted) showSozoToast(context, t('c10.pinSaved'));
      return;
    }
    final name = await placeName(point.latitude, point.longitude);
    if (!mounted) return;
    setState(() {
      _draft.address = name ??
          t('c10.pinAddress', {
            'lat': point.latitude.toStringAsFixed(5),
            'lng': point.longitude.toStringAsFixed(5),
          });
      _address.text = _draft.address;
      _addressTouched = true;
    });
    _saveDraftSoon();
    _checkCoverage(_draft.address);
    showSozoToast(context, name == null ? t('c10.pinSaved') : t('c10.addressFound'));
  }

  Widget _map() {
    // `_mapCenter` — то, куда карту уже увели: место человека или пин.
    // Читаем его первым, иначе карта, построенная после ответа геолокации,
    // снова открылась бы в центре Ташкента
    final center = _mapCenter ?? LatLng(_draft.lat ?? 41.311, _draft.lng ?? 69.279);
    return ClipRRect(
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: SizedBox(
        height: 200,
        child: Stack(
          children: [
            FlutterMap(
              mapController: _mapCtl,
              options: MapOptions(
                initialCenter: center,
                initialZoom: 13,
                // Пин остаётся в центре: двигается карта, а не маркер —
                // так палец не закрывает точку, которую ставишь
                onPositionChanged: (pos, hasGesture) {
                  _mapCenter = pos.center;
                  if (!hasGesture) return;
                  _draft.lat = pos.center.latitude;
                  _draft.lng = pos.center.longitude;
                },
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'uz.sozo.client',
                ),
              ],
            ),
            const Center(
              child: Padding(
                // Остриё пина смотрит в центр карты, поэтому иконку поднимаем
                padding: EdgeInsets.only(bottom: 24),
                child: FigmaIcon('map-pin', size: 32, color: SozoColors.accent),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _accessSummary() {
    if (_draft.needRiser == null && _draft.needCommonArea == null) return t('c11.intro');
    final parts = <String>[
      if (_draft.needRiser == true) t('c11.riser'),
      if (_draft.needCommonArea == true) t('c11.commonArea'),
    ];
    if (parts.isEmpty) return t('c11.nothingNeeded');
    final when = _draft.accessConfirmed == true ? t('c11.confirmedAt', {'at': _draft.accessAt ?? ''}) : t('c11.notConfirmed');
    return '${parts.join(', ')} · $when';
  }

  /// C-11. Чек-лист доступа к общим зонам — нижний лист шага 2
  Future<void> _openAccessSheet() async {
    await showSozoSheet<void>(
      context,
      title: t('c11.title'),
      child: StatefulBuilder(
        builder: (context, setSheet) {
          final anyYes = _draft.needRiser == true || _draft.needCommonArea == true;
          return SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('c11.intro'), style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                const SizedBox(height: SozoSpace.s12),
                SozoCard(
                  children: [
                    SwitchRow(
                      title: t('c11.riserQ'),
                      value: _draft.needRiser ?? false,
                      onChanged: (v) => setSheet(() => _draft.needRiser = v),
                    ),
                    const SozoDivider(),
                    SwitchRow(
                      title: t('c11.commonAreaQ'),
                      value: _draft.needCommonArea ?? false,
                      onChanged: (v) => setSheet(() => _draft.needCommonArea = v),
                    ),
                  ],
                ),
                if (anyYes) ...[
                  const SizedBox(height: SozoSpace.s12),
                  SozoBanner(icon: 'info', tone: BannerTone.warn, text: t('c11.warnEarly')),
                  const SizedBox(height: SozoSpace.s12),
                  RadioCard(
                    title: t('c11.confirmed'),
                    subtitle: _draft.accessAt ?? t('c11.pickDate'),
                    selected: _draft.accessConfirmed == true,
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        firstDate: DateTime.now(),
                        lastDate: DateTime.now().add(const Duration(days: 30)),
                        initialDate: DateTime.now().add(const Duration(days: 1)),
                      );
                      if (picked == null) return;
                      setSheet(() {
                        _draft.accessConfirmed = true;
                        _draft.accessAt = picked.toIso8601String().substring(0, 10);
                      });
                    },
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  RadioCard(
                    title: t('c11.notConfirmedTitle'),
                    subtitle: t('c11.notConfirmedText'),
                    selected: _draft.accessConfirmed == false,
                    onTap: () => setSheet(() {
                      _draft.accessConfirmed = false;
                      _draft.accessAt = null;
                    }),
                  ),
                ],
                const SizedBox(height: SozoSpace.s16),
                PrimaryButton(
                  t('common.done'),
                  onTap: anyYes && _draft.accessConfirmed == null
                      ? null
                      : () {
                          Navigator.of(context).pop();
                          setState(() {});
                        },
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // ==================== C-13. Шаг 3 «Итог» ====================

  final _promo = TextEditingController();
  bool _promoOpen = false;
  String? _promoStatus;
  bool _promoOk = false;

  Widget _stepReview() {
    final (from, to) = _subtotal;
    final urgent = _draft.timeMode == 'urgent';
    // Наценка считается от каждой границы своей, а не «тридцать процентов от
    // нижней — к обеим». Сервер (orders.service, `withUrgency`) делает именно
    // так, и человек, посчитавший по экрану итога, получал при оплате другую
    // сумму — ровно тот случай, из-за которого пишут жалобы
    final urgentAddFrom = urgent ? (from * _urgentPercent ~/ 100) : 0;
    final urgentAddTo = urgent ? (to * _urgentPercent ~/ 100) : 0;
    final discount = _draft.promoDiscountPercent;
    final discountFrom = ((from + urgentAddFrom) * discount) ~/ 100;
    final discountTo = ((to + urgentAddTo) * discount) ~/ 100;
    final totalFrom = from + urgentAddFrom - discountFrom;
    final totalTo = to + urgentAddTo - discountTo;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              _summary(
                title: t('c13.works'),
                onEdit: () => setState(() => _step = 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_draft.items.isEmpty)
                      Text(
                        _visitPriceTiyin != null
                            ? t('c13.diagnosticsPriced', {'sum': soums(_visitPriceTiyin)})
                            : t('c13.diagnostics'),
                        style: const TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
                      )
                    else
                      // Между работами — черта (231:310): без неё длинные
                      // названия в две строки сливаются в один абзац
                      for (final (i, e) in _draft.items.entries.indexed) ...[
                        if (i > 0)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: SozoSpace.s12),
                            child: SozoDivider(),
                          ),
                        MoneyRow(
                          label: (_itemById(e.key)?['name'] as String?) ?? '',
                          sub: e.value > 1 ? '${e.value} × ${soums(_itemById(e.key)?['priceFromTiyin'])}' : null,
                          amount: soums(((_itemById(e.key)?['priceFromTiyin'] as num?)?.toInt() ?? 0) * e.value),
                        ),
                      ],
                    if (_draft.description.trim().isNotEmpty) ...[
                      const SizedBox(height: SozoSpace.s8),
                      Text(
                        _draft.description,
                        style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary),
                      ),
                    ],
                  ],
                ),
              ),

              if (_draft.photos.isNotEmpty)
                _summary(
                  title: t('c13.photos'),
                  onEdit: () => setState(() => _step = 0),
                  child: PhotoGrid(photos: [for (final p in _draft.photos) PhotoRef(dataUrl: p)], columns: 4),
                ),

              _summary(
                title: t('c13.address'),
                onEdit: () => setState(() => _step = 1),
                child: _draft.address.trim().isEmpty
                    ? Text(
                        t('c13.addressMissing'),
                        style: const TextStyle(fontSize: 15, color: SozoColors.error),
                      )
                    : Text(
                        _draft.address,
                        style: const TextStyle(fontSize: 16, color: SozoColors.text),
                      ),
              ),

              if (!_draft.emergency)
                _summary(
                  title: t('c13.time'),
                  onEdit: () => setState(() => _step = 1),
                  child: Text(
                    switch (_draft.timeMode) {
                      'urgent' => t('c10.urgentTitle'),
                      'waitlist' => t('c10.waitlistTitle'),
                      _ => _draft.slotTo == null
                          ? '—'
                          : '${relativeDay('${_draft.slotFrom?.split(':').first}T00:00:00')} ${_draft.slotTo}',
                    },
                    style: const TextStyle(fontSize: 16, color: SozoColors.text),
                  ),
                ),

              // Итоговая карточка (231:197): строки счёта и «Итого» под чертой
              Container(
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  borderRadius: BorderRadius.circular(SozoRadius.card),
                ),
                padding: const EdgeInsets.all(SozoSpace.s16),
                child: Column(
                  children: [
                    // Пустой состав — не строка счёта на ноль, а объяснение:
                    // «Итого: от 0 сум» перед кнопкой «Отправить заявку»
                    // человек в панике читает как обещание, которое никто не
                    // собирается выполнять, и уходит звонить конкурентам
                    if (_draft.items.isEmpty)
                      MoneyRow(
                        label: t('c13.visitLine'),
                        amount: _visitPriceTiyin != null ? soums(_visitPriceTiyin) : t('c13.priceOnSite'),
                        bold: true,
                      )
                    else ...[
                      MoneyRow(label: t('c13.worksLine'), amount: range(from, to), labelMuted: true),
                      if (urgent)
                        MoneyRow(label: t('c13.urgentLine'), amount: '+${soums(urgentAddFrom)}', labelMuted: true),
                      if (discount > 0)
                        MoneyRow(
                          label: t('c13.promoLine', {'percent': discount}),
                          amount: '−${soums(discountFrom)}',
                          color: SozoColors.success,
                        ),
                      const SozoDivider(),
                      MoneyRow(label: t('c13.total'), amount: range(totalFrom, totalTo), bold: true),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: 14),
              if (!_promoOpen)
                Center(
                  child: InlineLink(
                    t('c13.havePromo'),
                    align: TextAlign.center,
                    onTap: () => setState(() => _promoOpen = true),
                  ),
                )
              else
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: SozoField(
                        label: t('c13.promoLabel'),
                        controller: _promo,
                        error: _promoStatus != null && !_promoOk ? _promoStatus : null,
                        helper: _promoOk ? _promoStatus : null,
                      ),
                    ),
                    const SizedBox(width: SozoSpace.s8),
                    Padding(
                      padding: const EdgeInsets.only(top: 26),
                      child: SizedBox(
                        width: 120,
                        child: SecondaryButton(t('common.apply'), onTap: _applyPromo),
                      ),
                    ),
                  ],
                ),

              if (_error != null) ...[
                const SizedBox(height: SozoSpace.s12),
                SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
              ],
              const SizedBox(height: 14),
              // Обещание про цену — последнее, что человек читает перед
              // отправкой (231:334): именно здесь возникает вопрос «а сколько
              // в итоге»
              Container(
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  borderRadius: BorderRadius.circular(SozoRadius.tile),
                ),
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const FigmaIcon('shield-check', size: 16, color: authHint),
                    const SizedBox(width: SozoSpace.s12),
                    Expanded(
                      child: Text(
                        t('c13.priceNote'),
                        style: const TextStyle(fontSize: 14, height: 1.4, color: authHint),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        _wizardWideFooter(t('c13.submit'), onTap: _sending ? null : _submit, busy: _sending),
      ],
    );
  }

  /// Карточка сводки (231:180): заголовок 16 и янтарное «Изменить» справа
  Widget _summary({required String title, required Widget child, required VoidCallback onEdit}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Container(
        decoration: BoxDecoration(
          color: SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.card),
        ),
        padding: const EdgeInsets.all(SozoSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
                ),
                InlineLink(t('common.change'), onTap: onEdit),
              ],
            ),
            const SizedBox(height: SozoSpace.s16),
            child,
          ],
        ),
      ),
    );
  }

  Future<void> _applyPromo() async {
    final code = _promo.text.trim();
    if (code.isEmpty) return;
    try {
      final r = await session.api.checkPromo(code);
      if (!mounted) return;
      setState(() {
        _promoOk = r['valid'] == true;
        _promoStatus = r['message'] as String?;
        _draft.promoCode = _promoOk ? code : null;
        _draft.promoDiscountPercent = _promoOk ? ((r['discountPercent'] as num?)?.toInt() ?? 0) : 0;
      });
      // Шаг 3 последний — если не сохранить здесь, промокод не переживёт
      // выгрузку процесса
      _saveDraftSoon();
    } on ApiError catch (e) {
      if (mounted) setState(() { _promoOk = false; _promoStatus = e.message; });
    }
  }

  Future<void> _submit() async {
    // Последний рубеж: заявка без адреса ехать не должна ни при каких
    // обстоятельствах. Проверка на шаге 2 могла не сработать — черновик
    // восстановился из прошлого запуска, человек стёр строку и вернулся
    // «Изменить», аварийный переключатель включили на шаге 1
    if (_draft.address.trim().isEmpty) {
      setState(() {
        _step = 1;
        _addressTouched = true;
        _error = null;
      });
      showSozoToast(context, t('c10.addressError'));
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      // Похожая заявка уже есть — спрашиваем, а не создаём вторую молча
      final dup = await session.api.duplicateCheck(_draft.address);
      final duplicate = dup['duplicate'] as Map<String, dynamic>?;
      if (duplicate != null && mounted) {
        final anyway = await showSozoConfirm(
          context,
          title: t('c13.duplicateTitle'),
          text: t('c13.duplicateText', {'number': duplicate['number']}),
          confirmLabel: t('c13.duplicateCreate'),
          cancelLabel: t('c13.duplicateOpen'),
        );
        if (!anyway) {
          if (mounted) Navigator.of(context).pop(duplicate['id'] as String);
          return;
        }
      }

      final slotParts = _draft.slotFrom?.split(':');
      final created = await session.api.createOrder({
        'items': [for (final e in _draft.items.entries) {'priceItemId': e.key, 'qty': e.value}],
        'description': _draft.description.trim(),
        'photos': _draft.photos,
        'address': _draft.address.trim(),
        'lat': _draft.lat,
        'lng': _draft.lng,
        'addressId': _draft.addressId,
        'saveAddress': _draft.saveAddress,
        'urgency': _draft.emergency ? 'emergency' : (_draft.timeMode == 'urgent' ? 'urgent' : 'normal'),
        'timeMode': _draft.emergency ? 'urgent' : _draft.timeMode,
        'slotDate': slotParts?.first,
        'slotStartMin': slotParts != null ? int.tryParse(slotParts.last) : null,
        'promoCode': _draft.promoCode,
        'floor': _draft.floor,
        'hasLift': _draft.hasLift,
        'needRiser': _draft.needRiser,
        'needCommonArea': _draft.needCommonArea,
        'accessConfirmed': _draft.accessConfirmed,
        'accessAt': _draft.accessAt,
        'source': widget.repeatOrderId != null
            ? 'repeat'
            : (_draft.emergency ? 'emergency' : (_query.isNotEmpty ? 'search' : 'category')),
      }, idempotencyKey: _draft.idempotencyKey);
      await OrderDraft.clear();
      // Заявка создана — следующая отправка должна считаться новой заявкой,
      // а не повтором этой
      _draft.renewIdempotencyKey();
      unawaited(session.api.track('order_submitted', {
        'source': widget.repeatOrderId != null ? 'repeat' : (_draft.emergency ? 'emergency' : 'category'),
      }));
      unawaited(session.api.track('order_step_complete', {'step': _totalSteps}));
      if (!mounted) return;
      // Подтверждение вместо тоста: отправка заявки — событие, а не мелочь
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => OrderSubmittedScreen(order: created)),
      );
      if (!mounted) return;
      Navigator.of(context).pop(created['id'] as String);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    _mapCtl.dispose();
    _search.dispose();
    _description.dispose();
    _address.dispose();
    _floor.dispose();
    _promo.dispose();
    super.dispose();
  }
}
