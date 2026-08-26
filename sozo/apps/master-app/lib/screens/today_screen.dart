import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/home_blocks.dart';
import 'notifications_screen.dart';
import 'offer_sheet.dart';
import 'order_screen.dart';
import 'route_screen.dart';
import '../i18n.dart';

/// «Сегодня» — стартовый экран (M-01, M-02).
///
/// Заявка в работе всегда первой: мастер открывает приложение, чтобы
/// продолжить её, а не изучать список.
///
/// Смена открывается прямо отсюда: без открытой смены заявки не приходят
/// вовсе, и пустое состояние, которое только советует её начать, оставляло
/// мастера без единственного нужного действия.
///
/// Опрос — раз в 25 секунд и только на активном экране. Пять секунд круглые
/// сутки — это полный запрос «сегодня» каждые пять секунд на дешёвом Android
/// и платном мобильном трафике; о новых заявках в фоне сообщает push.
class TodayScreen extends StatefulWidget {
  const TodayScreen({super.key, this.onOpenWallet});

  /// Тап по заработку ведёт в кошелёк — переключением вкладки, а не новым экраном
  final VoidCallback? onOpenWallet;

  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> with WidgetsBindingObserver {
  /// Шаг опроса ленты. Держим редким намеренно: оффер приходит push-ом,
  /// а опрос — страховка на случай, когда push не дошёл
  static const _pollPeriod = Duration(seconds: 25);

  Map<String, dynamic>? _data;
  Map<String, dynamic>? _tomorrow;
  String? _error;
  Timer? _poll;
  bool _offerOpen = false;
  bool _shiftBusy = false;

  /// Оффер пришёл, когда мастер был не на ленте: карточку на весь экран
  /// поверх подписи клиента не показываем — вместо неё баннер
  bool _offerBanner = false;
  int _tab = 0; // 0 — сегодня, 1 — завтра
  int _filter = 0; // 0 — активные заявки, 1 — требуют внимания

  Future<void> _loadTomorrow() async {
    try {
      final r = await session.api.tomorrow();
      if (mounted) setState(() => _tomorrow = r);
    } on ApiError {
      // черновик завтрашнего дня не критичен — покажем пусто
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _startPoll();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  /// В фоне опрос останавливаем целиком: приложение свёрнуто, экран погашен,
  /// а трафик и батарея тратятся. Возврат на экран — сразу свежая лента
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startPoll();
      _load();
    } else {
      _poll?.cancel();
      _poll = null;
    }
  }

  void _startPoll() {
    _poll?.cancel();
    _poll = Timer.periodic(_pollPeriod, (_) => _tick());
  }

  Future<void> _toggleShift(bool value) async {
    setState(() => _shiftBusy = true);
    try {
      await session.setOnline(value);
      if (mounted) await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _shiftBusy = false);
    }
  }

  Future<void> _load() async {
    try {
      final j = await session.api.today();
      if (!mounted) return;
      setState(() {
        _data = j;
        _error = null;
      });
      session.outbox.markOnline(true);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.isOffline) session.outbox.markOnline(false);
      setState(() => _error = e.message);
    }
  }

  /// Тик: подтягиваем офферы и заодно пытаемся выгрузить очередь
  Future<void> _tick() async {
    if (!mounted || _offerOpen) return;
    // Блокировку по заявке очередь считает сама: одна застрявшая операция
    // больше не останавливает отправку по остальным заявкам
    if (session.outbox.depth > 0) await session.outbox.flush();
    await _load();
    if (!mounted) return;
    final pending = (_data?['offersPending'] as num?)?.toInt() ?? 0;
    if (pending == 0 || session.profile?.online != true) {
      if (_offerBanner) setState(() => _offerBanner = false);
      return;
    }
    // Поверх ленты открыт другой экран — подпись клиента, камера, смета.
    // Карточка оффера на весь экран в этот момент перекрывает работу и
    // уводит мастера с середины действия; ждём его баннером
    if (ModalRoute.of(context)?.isCurrent ?? true) {
      await _showOffer();
    } else if (!_offerBanner) {
      setState(() => _offerBanner = true);
    }
  }

  Future<void> _showOffer() async {
    if (_offerOpen) return;
    _offerOpen = true;
    if (_offerBanner) setState(() => _offerBanner = false);
    try {
      final j = await session.api.offers();
      final items = ((j['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
      if (items.isEmpty || !mounted) return;
      final offer = Offer.fromJson(items.first);
      final reasons = ((j['declineReasons'] as List?) ?? const [])
          .map((r) => (code: (r as Map)['code'].toString(), title: r['title'].toString()))
          .toList();
      final acceptedOrderId = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => OfferSheet(
            offer: offer,
            ttlSeconds: offer.ttlSeconds,
            declineReasons: reasons,
            onAccept: () async {
              final card = await session.api.acceptOffer(offer.id);
              return card['id'] as String?;
            },
            onDecline: (code) => session.api.declineOffer(offer.id, code),
          ),
        ),
      );
      if (!mounted) return;
      if (acceptedOrderId != null) {
        // Карточку открываем только после того, как экран оффера закрылся
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: acceptedOrderId)));
      }
      if (mounted) await _load();
    } on ApiError {
      // офферы подождут до следующего тика
    } finally {
      _offerOpen = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_tab == 1) return _tomorrowView();
    final profile = session.profile;
    final current = _data?['current'] as Map<String, dynamic>?;
    final upcoming = ((_data?['upcoming'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final lane = _data?['lane'] as Map<String, dynamic>?;
    final cash = _data?['cash'] as Map<String, dynamic>?;
    final duty = _data?['duty'] as Map<String, dynamic>?;
    final probation = _data?['probation'] as Map<String, dynamic>?;
    final day = _data?['day'] as Map<String, dynamic>?;
    final locked = cash?['locked'] == true;

    final earned = (day?['earnedTiyin'] as num?)?.toInt() ?? 0;
    final closedToday = (day?['orders'] as num?)?.toInt() ?? 0;
    final activeNow = (current != null ? 1 : 0) + upcoming.length;
    final loadPercent = (lane?['loadPercent'] as num?)?.toInt() ?? 0;
    final busyMin = (lane?['busyMin'] as num?)?.toInt() ?? 0;
    final shiftMin = (lane?['shiftMin'] as num?)?.toInt() ?? 0;

    // Порядок блоков — как в макете (node 21:12), между блоками ровно 16
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, 90),
        children: [
          ProfileHeader(
            name: profile?.fullName.split(' ').first ?? '—',
            role: t('today.masterTehnik'),
            bell: NotificationBell(
              unread: (_data?['unreadNotifications'] as num?)?.toInt() ?? session.unreadNotifications,
              onReturn: _load,
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          // Состояние смены — на главной, а не в четвёртой вкладке: от него
          // зависит, придут ли заявки вообще
          _shiftCard(profile?.online == true),
          const SizedBox(height: SozoSpace.s16),
          if (_offerBanner) ...[_offerBannerCard(), const SizedBox(height: SozoSpace.s16)],
          if (locked) ...[
            BlockerNote(
              icon: 'alert-triangle',
              danger: true,
              text: t('today.snyatySLiniiDolg', {'p1': formatSoums(tiyinOf(cash!['debtTiyin']))}),
            ),
            const SizedBox(height: SozoSpace.s16),
          ] else ...[
            EarningsCard(amount: formatSoums(earned), onTap: widget.onOpenWallet),
            const SizedBox(height: SozoSpace.s16),
            Row(
              children: [
                Expanded(
                  child: MetricCard(value: '$closedToday', label: t('today.zakryto')),
                ),
                const SizedBox(width: SozoSpace.s8),
                Expanded(
                  child: MetricCard(value: '$activeNow', label: t('today.vRabote')),
                ),
                const SizedBox(width: SozoSpace.s8),
                Expanded(
                  child: MetricCard(value: '${profile?.rating ?? 0}', label: t('res.reyting')),
                ),
                const SizedBox(width: SozoSpace.s8),
                Expanded(
                  child: MetricCard(value: profile?.avgRating?.toString() ?? '—', label: t('today.ocenka')),
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (cash?['warning'] != null) ...[
            BlockerNote(text: cash!['warning'].toString(), icon: 'credit-card'),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (duty != null) ...[_dutyCard(duty), const SizedBox(height: SozoSpace.s16)],
          if (probation != null) ...[
            SozoCard(
              child: Row(
                children: [
                  const FigmaIcon('graduation-cap', size: 20, color: SozoColors.warning),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Text(
                      t('today.ispytatelnyyIzZayavok', {'p1': probation['done'], 'p2': probation['target']}),
                      style: const TextStyle(fontSize: 14.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (_error != null && _data == null) ...[
            BlockerNote(text: _error!, icon: 'alert-circle'),
            const SizedBox(height: SozoSpace.s16),
          ],
          // Прокрутка, а не Row: две пилюли с длинными подписями в ширину
          // телефона не помещаются, и «Требуют внимания» уезжало за край на
          // 203 точки — на узбекском будет ещё длиннее
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                FilterPill(
                  label: t('today.aktivnyeZayavki'),
                  active: _filter == 0,
                  onTap: () => setState(() => _filter = 0),
                ),
                const SizedBox(width: SozoSpace.s8),
                FilterPill(
                  // Иконка набора, а не эмодзи: 🔧 рисуется шрифтом системы
                  // и на дешёвом Android выглядит чужеродно рядом с остальной
                  // навигацией (об этом же комментарий в notifications_screen)
                  label: t('today.trebuyutVnimaniya'),
                  icon: 'wrench',
                  active: _filter == 1,
                  onTap: () => setState(() => _filter = 1),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          DayToggle(
            tab: _tab,
            onTab: (i) {
              setState(() => _tab = i);
              if (i == 1) _loadTomorrow();
            },
            onMap: _openMap,
          ),
          const SizedBox(height: SozoSpace.s16),
          if (_filter == 1)
            ..._attentionView(current, upcoming)
          else ...[
            HomeSectionTitle(t('today.seychasVRabote')),
            const SizedBox(height: SozoSpace.s16),
            if (current == null)
              Column(
                children: [
                  EmptyView(
                    title: session.profile?.online == true ? t('today.zayavokPokaNet') : t('today.vyNeNaLinii'),
                    subtitle: session.profile?.online == true
                        ? t('today.offeryPridutSamiKak')
                        : t('today.nachniteSmenuDispetcherUvidit'),
                    icon: 'toolbox',
                  ),
                  // Текст «начните смену» без кнопки — тупик: тумблер жил
                  // во вкладке «Профиль», и найти его удавалось не всем
                  if (session.profile?.online != true) ...[
                    const SizedBox(height: SozoSpace.s16),
                    PrimaryButton(label: t('today.nachatSmenu'), busy: _shiftBusy, onPressed: () => _toggleShift(true)),
                  ],
                ],
              )
            else
              _orderTile(current, accent: true),
            if (upcoming.isNotEmpty) ...[
              const SizedBox(height: SozoSpace.s16),
              HomeSectionTitle(t('today.predstoyaschieZayavki')),
              const SizedBox(height: SozoSpace.s16),
              for (var i = 0; i < upcoming.length; i++) ...[
                if (i > 0) const SizedBox(height: SozoSpace.s12),
                _orderTile(upcoming[i]),
              ],
            ],
          ],
          const SizedBox(height: SozoSpace.s16),
          DayLoadCard(
            percent: loadPercent,
            caption: t('today.zanyatoMinIzMin', {
              'p1': loadPercent,
              'p2': formatDuration(busyMin),
              'p3': formatDuration(shiftMin),
            }),
          ),
        ],
      ),
    );
  }

  /// Смена на главном экране: состояние словом и кнопка рядом.
  /// Тумблер 44×24 в четвёртой вкладке был самым спрятанным элементом
  /// приложения при том, что без него не приходит ни одна заявка
  Widget _shiftCard(bool online) {
    return SozoCard(
      accent: !online,
      child: Row(
        children: [
          FigmaIcon('circle', size: 18, color: online ? softSuccessFg : SozoColors.textSecondary),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  online ? t('today.smenaIdet') : t('today.smenaZakryta'),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  online ? t('prof.vyPoluchaeteZayavki') : t('prof.pokaSmenaZakrytaZayavki'),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.3),
                ),
              ],
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          if (_shiftBusy)
            const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
          else
            SmallChipButton(
              label: online ? t('today.zakonchitSmenu') : t('today.nachatSmenu'),
              onTap: () => _toggleShift(!online),
            ),
        ],
      ),
    );
  }

  /// Оффер, пришедший во время другой работы. Карточку с таймером мастер
  /// откроет сам, когда освободится: перебивать подпись клиента нельзя
  Widget _offerBannerCard() {
    return SozoCard(
      accent: true,
      onTap: _showOffer,
      child: Row(
        children: [
          const FigmaIcon('alert-circle', size: 20, color: SozoColors.accent),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Text(
              t('today.novayaZayavkaJdet'),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
          ),
          AmberAction(t('today.otkrytZayavku'), onTap: _showOffer),
        ],
      ),
    );
  }

  void _openMap() {
    final all = [
      if (_data?['current'] != null) OrderCard.fromJson(_data!['current'] as Map<String, dynamic>),
      ...((_data?['upcoming'] as List?) ?? const []).map((e) => OrderCard.fromJson(e as Map<String, dynamic>)),
    ];
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => RouteScreen(orders: all)));
  }

  /// M-07 «Завтра» — черновик: заявку можно только снять с себя заранее
  Widget _tomorrowView() {
    final items = ((_tomorrow?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return ListView(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, 90),
      children: [
        DayToggle(
          tab: _tab,
          onTab: (i) {
            setState(() => _tab = i);
            if (i == 1) _loadTomorrow();
          },
          onMap: _openMap,
        ),
        const SizedBox(height: SozoSpace.s16),
        if (_tomorrow == null)
          const Center(
            child: Padding(padding: EdgeInsets.all(SozoSpace.s32), child: CircularProgressIndicator()),
          )
        else ...[
          BlockerNote(text: _tomorrow!['note']?.toString() ?? t('today.chernovik'), icon: 'calendar'),
          const SizedBox(height: SozoSpace.s16),
          if (_tomorrow!['duty'] != null) ...[
            _dutyCard(_tomorrow!['duty'] as Map<String, dynamic>, tomorrow: true),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (items.isEmpty)
            EmptyView(title: _tomorrow!['empty']?.toString() ?? t('today.pusto'), icon: 'calendar')
          else
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const SizedBox(height: SozoSpace.s12),
              _orderTile(items[i]),
            ],
        ],
        const SizedBox(height: SozoSpace.s32),
      ],
    );
  }

  Widget _dutyCard(Map<String, dynamic> duty, {bool tomorrow = false}) {
    final min = (duty['minimumTiyin'] as num?)?.toInt() ?? 0;
    final earned = (duty['earnedTiyin'] as num?)?.toInt() ?? 0;
    return SozoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('shield', size: 20, color: SozoColors.warning),
              const SizedBox(width: SozoSpace.s8),
              Expanded(
                child: Text(
                  tomorrow ? t('today.zavtraVyDejurnyy') : t('today.vyDejurnyySegodnya'),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
          Text(
            t('today.minimumSmeny', {'p1': formatSoums(min)}),
            style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
          ),
          if (!tomorrow) ...[
            const SizedBox(height: SozoSpace.s8),
            LinearProgressIndicator(
              value: min == 0 ? 0 : (earned / min).clamp(0.0, 1.0),
              minHeight: 6,
              backgroundColor: SozoColors.border,
              valueColor: const AlwaysStoppedAnimation(SozoColors.warning),
            ),
            const SizedBox(height: SozoSpace.s4),
            Text(
              t('today.nabranoIz', {'p1': formatSoums(earned), 'p2': formatSoums(min)}),
              style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
            ),
          ],
          const SizedBox(height: SozoSpace.s4),
          Text(
            t('today.dejurstvoAvariynyeIZameny'),
            style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.35),
          ),
        ],
      ),
    );
  }

  /// Фильтр «Требуют внимания»: только те заявки дня, по которым мастер
  /// дальше сам не продвинется. Причину пишем строкой под карточкой —
  /// иначе фильтр отвечает «есть проблема», но не говорит какая.
  List<Widget> _attentionView(Map<String, dynamic>? current, List<Map<String, dynamic>> upcoming) {
    final all = [if (current != null) OrderCard.fromJson(current), ...upcoming.map((e) => OrderCard.fromJson(e))];
    final flagged = all.where((o) => o.needsAttention).toList();
    if (flagged.isEmpty) {
      return [
        EmptyView(
          title: t('today.vseIdetPoPlanu'),
          subtitle: t('today.zdesPoyavyatsyaZayavkiNa'),
          icon: 'check-square',
        ),
      ];
    }
    return [
      HomeSectionTitle(t('today.trebuyutVnimaniya')),
      const SizedBox(height: SozoSpace.s16),
      for (var i = 0; i < flagged.length; i++) ...[
        if (i > 0) const SizedBox(height: SozoSpace.s12),
        WorkOrderCard(
          order: flagged[i],
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: flagged[i].id)));
            if (mounted) await _load();
          },
        ),
        const SizedBox(height: SozoSpace.s8),
        BlockerNote(text: flagged[i].attentionReason!, icon: 'alert-circle'),
      ],
    ];
  }

  Widget _orderTile(Map<String, dynamic> o, {bool accent = false}) {
    final card = OrderCard.fromJson(o);
    return WorkOrderCard(
      order: card,
      highlight: accent,
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: card.id)));
        if (mounted) await _load();
      },
    );
  }
}
