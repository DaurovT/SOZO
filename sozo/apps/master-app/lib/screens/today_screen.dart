import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/common.dart';
import '../widgets/home_blocks.dart';
import 'notifications_screen.dart';
import 'offer_sheet.dart';
import 'order_screen.dart';
import 'route_screen.dart';
import '../i18n.dart';

/// «Сегодня» — стартовый экран (M-01, M-02).
///
/// Заявка в работе всегда первой: мастер открывает приложение, чтобы
/// продолжить её, а не изучать список. Офферы приходят опросом раз в 5 секунд —
/// на месте push это делает FCM, здесь достаточно поллинга.
class TodayScreen extends StatefulWidget {
  const TodayScreen({super.key, this.onOpenWallet});

  /// Тап по заработку ведёт в кошелёк — переключением вкладки, а не новым экраном
  final VoidCallback? onOpenWallet;

  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> {
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _tomorrow;
  String? _error;
  Timer? _poll;
  bool _offerOpen = false;
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
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _tick());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
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
    if (session.outbox.depth > 0 && !session.outbox.hasBlocked) {
      await session.outbox.flush();
    }
    await _load();
    if (!mounted) return;
    final pending = (_data?['offersPending'] as num?)?.toInt() ?? 0;
    if (pending > 0 && session.profile?.online == true) await _showOffer();
  }

  Future<void> _showOffer() async {
    if (_offerOpen) return;
    _offerOpen = true;
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
          if (locked) ...[
            BlockerNote(
              icon: 'alert-triangle',
              danger: true,
              text: t('today.snyatySLiniiDolg', {'p1': formatSoums((cash!['debtTiyin'] as num).toInt())}),
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
                  label: t('today.trebuyutVnimaniya'),
                  emoji: '🔧',
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
              EmptyView(
                title: session.profile?.online == true ? t('today.zayavokPokaNet') : t('today.vyNeNaLinii'),
                subtitle: session.profile?.online == true
                    ? t('today.offeryPridutSamiKak')
                    : t('today.nachniteSmenuDispetcherUvidit'),
                icon: 'toolbox',
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
            caption: t('today.zanyatoMinIzMin', {'p1': loadPercent, 'p2': busyMin, 'p3': shiftMin}),
          ),
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
