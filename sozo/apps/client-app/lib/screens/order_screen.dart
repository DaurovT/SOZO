import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_grid.dart';
import 'address_details_screen.dart';
import 'complaints_screen.dart';
import 'decisions_screen.dart';
import 'finish_screens.dart';

/// C-14. Активная заявка.
///
/// Экран отвечает на один вопрос: что сейчас с моей проблемой. Поэтому
/// сверху — событие и статус, а не реквизиты; деньги — ниже, действия — внизу.
class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // Пуш-уведомлений пока нет (FCM не подключён) — держим экран живым
    // опросом: клиент не должен гадать, выехал мастер или нет
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _key.currentState?.reload());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      body: SafeArea(
        bottom: false,
        child: AsyncView<Map<String, dynamic>>(
          key: _key,
          load: () => session.api.order(widget.orderId),
          builder: (context, order, reload) => _OrderBody(order: order, reload: reload),
        ),
      ),
    );
  }
}

/// Свёрнутый трекер с раскрытием: по умолчанию — текущий шаг и прогресс
class _TrackerCard extends StatefulWidget {
  const _TrackerCard({required this.steps, required this.current, required this.done, required this.row});

  final List<Map<String, dynamic>> steps;
  final Map<String, dynamic> current;
  final int done;
  final Widget Function(Map<String, dynamic> step, {required bool last}) row;

  @override
  State<_TrackerCard> createState() => _TrackerCardState();
}

class _TrackerCardState extends State<_TrackerCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final total = widget.steps.length;
    return SozoCard(
      gap: SozoSpace.s8,
      onTap: () => setState(() => _open = !_open),
      children: [
        Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
            ),
            const SizedBox(width: SozoSpace.s8),
            Expanded(
              child: Text(
                (widget.current['label'] as String?) ?? '',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
            ),
            Text(
              '${widget.done} / $total',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: authHint),
            ),
            const SizedBox(width: SozoSpace.s4),
            FigmaIcon(_open ? 'arrow-left' : 'chevron-right', size: 14, color: SozoColors.textTertiary),
          ],
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(SozoRadius.badge),
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : widget.done / total,
            minHeight: 4,
            backgroundColor: trackGrey,
            valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
          ),
        ),
        if (_open) ...[
          const SozoDivider(),
          for (var i = 0; i < widget.steps.length; i++)
            widget.row(widget.steps[i], last: i == widget.steps.length - 1),
        ],
      ],
    );
  }
}

class _OrderBody extends StatelessWidget {
  const _OrderBody({required this.order, required this.reload});

  final Map<String, dynamic> order;
  final Future<void> Function() reload;

  Map<String, dynamic> get _pending => (order['pending'] as Map<String, dynamic>?) ?? const {};

  /// Решение, которого ждёт мастер прямо сейчас — оно и есть главное действие
  DecisionKind? get _decisionKind {
    if (_pending['addwork'] != null) return DecisionKind.addwork;
    if (_pending['estimate'] == true) return DecisionKind.estimate;
    if (_pending['spareTier'] != null) return DecisionKind.spareTier;
    if (_pending['stagePlan'] != null) return DecisionKind.stages;
    if (_pending['recommendation'] != null) return DecisionKind.recommendation;
    return null;
  }
  Map<String, dynamic> get _can => (order['can'] as Map<String, dynamic>?) ?? const {};

  @override
  Widget build(BuildContext context) {
    final status = (order['status'] as String?) ?? '';
    // Заявка дошла до итога — это уже другой экран (C-19), не карточка работы
    if (['completed', 'verified', 'awaiting_payment', 'closed', 'rated'].contains(status)) {
      return FinishScreenBody(order: order, reload: reload);
    }

    final master = order['master'] as Map<String, dynamic>?;
    final window = order['window'] as Map<String, dynamic>?;
    final pause = order['pause'] as Map<String, dynamic>?;
    final photos = ((order['photos'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final lines = ((order['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return Column(
      children: [
        SozoAppBar(
          title: (order['number'] as String?) ?? '',
          titleSize: 16,
          // Звонок диспетчеру — частое вспомогательное действие: держим под рукой,
          // но не в главном слоте. Жалоба ушла в меню внутри экрана.
          // Кнопка янтарная и того же размера, что «назад» (242:16)
          action: SozoAppBarAction(
            icon: 'phone',
            filled: true,
            onTap: () => _callDispatcher(context),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s32),
            children: [
              ..._banners(context),

              _tracker(),
              const SizedBox(height: SozoSpace.s12),

              if (status == 'master_departed') ...[
                _etaMap(),
                const SizedBox(height: SozoSpace.s12),
              ],

              if (master != null) ...[
                SozoCard(
                  children: [
                    Row(
                      children: [
                        PersonAvatar(name: (master['name'] as String?) ?? '?', size: 48),
                        const SizedBox(width: SozoSpace.s12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (master['name'] as String?) ?? '',
                                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                _masterLine(master),
                                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (window != null)
                      Text(
                        t('c14.window', {'window': '${relativeDay(window['from'])} ${window['label']}'}),
                        style: const TextStyle(fontSize: 14, color: SozoColors.text),
                      ),
                    // Телефона мастера нет — связь только через диспетчера (ТЗ 14)
                    Text(t('c14.noMasterPhone'), style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              if (pause != null) ...[
                SozoBanner(
                  icon: 'hourglass',
                  tone: BannerTone.warn,
                  title: t('c14.pauseTitle'),
                  text: [
                    pause['reason'],
                    if (pause['until'] != null) t('c14.pauseUntil', {'at': hhmm(pause['until'])}),
                  ].where((v) => v != null).join(' · '),
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              if (_pending['stagePlan'] != null) ...[
                SozoCard(
                  onTap: () => _openDecision(context, DecisionKind.stages),
                  children: [
                    Row(
                      children: [
                        const FigmaIcon('calendar', size: 20, color: SozoColors.textSecondary),
                        const SizedBox(width: SozoSpace.s12),
                        Expanded(child: Text(t('c14.stages'), style: const TextStyle(fontSize: 14, color: SozoColors.text))),
                        const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              if (lines.isNotEmpty) ...[
                SozoCard(
                  children: [
                    CardTitle(t('c14.works')),
                    for (final l in lines)
                      MoneyRow(
                        label: (l['name'] as String?) ?? '',
                        sub: (l['qty'] as num? ?? 1) > 1 ? '${l['qty']} ${l['unit']}' : null,
                        amount: soums(l['fromTiyin']),
                      ),
                    const SozoDivider(),
                    MoneyRow(
                      label: t('c14.estimate'),
                      amount: range(order['totalFromTiyin'], order['totalToTiyin']),
                      bold: true,
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              if (photos.isNotEmpty) ...[
                SozoCard(
                  children: [
                    CardTitle(t('c14.photos')),
                    PhotoGrid(
                      photos: [
                        for (final p in photos)
                          PhotoRef(url: _absolute(p['url'] as String?), label: _photoLabel(p['stage'] as String?)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              // Чат в MVP заменён шаблонами: живой чат без модерации
              // превращается в канал давления на мастера (PRD-01)
              SozoCard(
                radius: SozoRadius.tile,
                gap: SozoSpace.s16,
                children: [
                  Text(
                    t('c14.quickTitle'),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
                  ),
                  Column(
                    children: [
                      for (final msg in [t('c14.quickLate'), t('c14.quickCall'), t('c14.quickIntercom')])
                        Padding(
                          padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                          child: NeutralPill(msg, onTap: () => _sendQuick(context, msg)),
                        ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),

              if (_can['reschedule'] == true) ...[
                NeutralPill(t('c14.reschedule'), icon: 'calendar', onTap: () => _reschedule(context)),
                const SizedBox(height: SozoSpace.s12),
              ],
              // Жалоба и отмена разведены по краям: это не пара равных кнопок,
              // а два разных выхода, и попасть в них случайно не должно
              Padding(
                padding: const EdgeInsets.symmetric(vertical: SozoSpace.s8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _FooterLink(
                      t('c14.complain'),
                      color: linkMuted,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ComplaintsScreen(
                            orderId: order['id'] as String?,
                            orderNumber: order['number'] as String?,
                          ),
                        ),
                      ),
                    ),
                    if (_can['cancel'] == true)
                      _FooterLink(t('c14.cancel'), color: linkDanger, onTap: () => _cancel(context)),
                  ],
                ),
              ),
            ],
          ),
        ),
        // Нижняя панель появляется только когда есть что нажать: у заявки
        // в пути главного действия нет, и держать ради этого треть экрана нельзя
        if (_decisionKind != null)
          StickyFooter(
            children: [
              PrimaryButton(
                t('c06.answer'),
                onTap: () => _openDecision(context, _decisionKind!),
              ),
            ],
          ),
      ],
    );
  }

  String _masterLine(Map<String, dynamic> master) {
    final rating = master['rating'] as num?;
    final jobs = master['jobsDone'] as num?;
    return [
      if (rating != null) '★ ${rating.toStringAsFixed(1)}',
      if (jobs != null) plural(jobs.toInt(), 'работа', 'работы', 'работ'),
    ].join(' · ');
  }

  String? _photoLabel(String? stage) => switch (stage) {
        'before' => t('photo.before'),
        'after' => t('photo.after'),
        'during' => t('photo.during'),
        _ => null,
      };

  /// Сервер отдаёт относительный путь с токеном — базовый адрес свой у каждого стенда
  static String? _absolute(String? path) =>
      path == null ? null : (path.startsWith('http') ? path : '${session.api.baseUrl}$path');

  /// Баннер события — один сверху, самый свежий (DEV-08 C-14)
  List<Widget> _banners(BuildContext context) {
    final out = <Widget>[];
    void add(Widget w) {
      out.add(w);
      out.add(const SizedBox(height: SozoSpace.s12));
    }

    // Спор — первым: пока он идёт, всё остальное на экране второстепенно,
    // а когда решён, человек ждёт именно ответа, а не статуса заявки
    final dispute = order['dispute'] as Map<String, dynamic>?;
    if (dispute != null) {
      final verdict = dispute['verdict'] as String?;
      final refund = (dispute['refundTiyin'] as num?)?.toInt() ?? 0;
      add(SozoBanner(
        icon: verdict == null ? 'hourglass' : 'shield-check',
        tone: verdict == null ? BannerTone.warn : BannerTone.info,
        title: verdict ?? t('c22.inWork'),
        text: [
          if (verdict == null) t('c22.inWorkText'),
          if (dispute['comment'] != null) dispute['comment'] as String,
          if (refund > 0) t('c22.refund', {'sum': soums(refund)}),
        ].join(' · '),
      ));
    }

    if (_pending['estimate'] == true) {
      add(SozoBanner(
        icon: 'file-text',
        tone: BannerTone.info,
        title: t('c14.estimateTitle'),
        text: t('c14.estimateText'),
        actionLabel: t('c14.open'),
        onAction: () => _openDecision(context, DecisionKind.estimate),
      ));
    }
    if (_pending['addwork'] != null) {
      add(SozoBanner(
        icon: 'alert-triangle',
        tone: BannerTone.danger,
        title: t('c16.title'),
        text: t('c16.banner'),
        actionLabel: t('c14.open'),
        onAction: () => _openDecision(context, DecisionKind.addwork),
      ));
    }
    if (_pending['spareTier'] != null) {
      add(SozoBanner(
        icon: 'shopping-bag',
        tone: BannerTone.info,
        title: t('c15.tierTitle'),
        text: t('c15.tierBanner'),
        actionLabel: t('c14.open'),
        onAction: () => _openDecision(context, DecisionKind.spareTier),
      ));
    }
    if (_pending['recommendation'] != null) {
      add(SozoBanner(
        icon: 'sparkles',
        title: t('c17.title'),
        text: t('c17.banner'),
        actionLabel: t('c14.open'),
        onAction: () => _openDecision(context, DecisionKind.recommendation),
      ));
    }
    if (_pending['addressDetails'] == true) {
      add(SozoBanner(
        icon: 'map-pin',
        tone: BannerTone.info,
        title: t('c50.bannerTitle'),
        text: t('c50.bannerText'),
        actionLabel: t('c50.fill'),
        onAction: () async {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => AddressDetailsScreen(order: order)),
          );
          await reload();
        },
      ));
    }
    return out;
  }

  /// Трекер свёрнут до сути: где мы сейчас и сколько осталось.
  /// Полная цепочка из восьми шагов — по запросу: клиенту нужен ответ
  /// «что с моей заявкой», а не диаграмма процесса.
  Widget _tracker() {
    final steps = ((order['timeline'] as List?) ?? const []).cast<Map<String, dynamic>>();
    if (steps.isEmpty) return const SizedBox.shrink();
    final currentIndex = steps.indexWhere((s) => s['current'] == true);
    final done = steps.where((s) => s['done'] == true).length;
    final current = currentIndex >= 0 ? steps[currentIndex] : steps.last;

    return _TrackerCard(steps: steps, current: current, done: done, row: _trackerRow);
  }

  Widget _trackerRow(Map<String, dynamic> step, {required bool last}) {
    final done = step['done'] == true;
    final current = step['current'] == true;
    final color = current
        ? SozoColors.accent
        : done
            ? SozoColors.success
            : SozoColors.border;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                child: done && !current
                    ? const Center(child: FigmaIcon('check-12', size: 12, color: SozoColors.surface))
                    : null,
              ),
              if (!last)
                Expanded(
                  child: Container(width: 2, color: done ? SozoColors.success : SozoColors.border),
                ),
            ],
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : SozoSpace.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (step['label'] as String?) ?? '',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                      color: done || current ? SozoColors.text : SozoColors.textSecondary,
                    ),
                  ),
                  if (step['at'] != null)
                    Text(
                      '${relativeDay(step['at'])} ${hhmm(step['at'])}',
                      style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _etaMap() {
    final lat = (order['lat'] as num?)?.toDouble() ?? 41.311;
    final lng = (order['lng'] as num?)?.toDouble() ?? 69.279;
    // Позицию мастера сервер отдаёт только пока тот едет и только если
    // отметка свежая — здесь не решаем, показывать ли, а показываем присланное
    final master = order['master'] as Map<String, dynamic>?;
    final geo = master?['geo'] as Map<String, dynamic>?;
    final masterLat = (geo?['lat'] as num?)?.toDouble();
    final masterLng = (geo?['lng'] as num?)?.toDouble();
    final eta = master?['eta'] as String?;

    final points = <LatLng>[
      LatLng(lat, lng),
      if (masterLat != null && masterLng != null) LatLng(masterLat, masterLng),
    ];
    final center = points.length == 2
        ? LatLng((points[0].latitude + points[1].latitude) / 2, (points[0].longitude + points[1].longitude) / 2)
        : points.first;

    return ClipRRect(
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: SizedBox(
        height: 180,
        child: Stack(
          children: [
            FlutterMap(
              options: MapOptions(initialCenter: center, initialZoom: points.length == 2 ? 12 : 13),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'uz.sozo.client',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      point: LatLng(lat, lng),
                      width: 40,
                      height: 40,
                      child: const FigmaIcon('map-pin', size: 32, color: SozoColors.accent),
                    ),
                    if (masterLat != null && masterLng != null)
                      Marker(
                        point: LatLng(masterLat, masterLng),
                        width: 40,
                        height: 40,
                        child: const FigmaIcon('car', size: 30, color: SozoColors.text),
                      ),
                  ],
                ),
              ],
            ),
            Positioned(
              left: SozoSpace.s12,
              bottom: SozoSpace.s12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: SozoSpace.s8),
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  borderRadius: BorderRadius.circular(SozoRadius.field),
                  boxShadow: sozoFloatShadow,
                ),
                child: Text(
                  eta == null ? t('c14.onTheWay') : t('c14.etaAt', {'time': hhmm(eta)}),
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.text),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openDecision(BuildContext context, DecisionKind kind) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => DecisionScreen(order: order, kind: kind)),
    );
    await reload();
  }

  Future<void> _sendQuick(BuildContext context, String text) async {
    try {
      await session.api.quickMessage(order['id'] as String, text);
      if (context.mounted) showSozoToast(context, t('c14.quickSent'));
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  Future<void> _callDispatcher(BuildContext context) async {
    unawaited(session.api.track('call_dispatcher_tap', {'screen': 'C-14'}));
    // Номер даёт сервер: зашитый в код он разъедется с реальным в первый же
    // день, а звонить будут именно отсюда
    callPhone(context, (session.me?['supportPhone'] as String?) ?? '+998712000000');
  }

  Future<void> _reschedule(BuildContext context) async {
    Map<String, dynamic> slots;
    try {
      slots = await session.api.slots();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
      return;
    }
    if (!context.mounted) return;
    final days = ((slots['days'] as List?) ?? const []).cast<Map<String, dynamic>>();
    await showSozoSheet<void>(
      context,
      title: t('c14.rescheduleTitle'),
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Предупреждение о переназначении мастера (242:181): своя плашка
            // на медовом фоне — она тут единственная и должна читаться сразу
            Container(
              decoration: BoxDecoration(color: rescheduleWarnBg, borderRadius: BorderRadius.circular(12)),
              padding: const EdgeInsets.all(SozoSpace.s12),
              child: Row(
                children: [
                  const FigmaIcon('info', size: 18, color: rescheduleWarnFg),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      t('c14.rescheduleWarn'),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: rescheduleWarnFg),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
            Text(
              t('c10.whenTitle'),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
            ),
            const SizedBox(height: SozoSpace.s12),
            if (days.isEmpty)
              Text(t('c10.noWindows'), style: const TextStyle(fontSize: 14, color: authHint)),
            // Дни лентой, окна выбранного дня — сеткой в две колонки (242:185)
            _RescheduleTime(
              days: days,
              onPick: (day, w) async {
                Navigator.of(context).pop();
                try {
                  await session.api.reschedule(order['id'] as String, {
                    'date': day['date'],
                    'startMin': w['startMin'],
                  });
                  if (context.mounted) showSozoToast(context, t('c14.rescheduleSent'));
                  await reload();
                } on ApiError catch (e) {
                  if (context.mounted) showSozoToast(context, e.message);
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _cancel(BuildContext context) async {
    Map<String, dynamic> preview;
    try {
      preview = await session.api.cancelPreview(order['id'] as String);
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
      return;
    }
    if (!context.mounted) return;
    final pays = (preview['clientPaysTiyin'] as num?)?.toInt() ?? 0;
    final ok = await showSozoConfirm(
      context,
      title: t('c14.cancelTitle'),
      // Деньги называем до отмены, а не после: сюрприз в счёте — это спор
      text: pays > 0
          ? t('c14.cancelPaid', {'sum': soums(pays), 'note': preview['note'] ?? ''})
          : t('c14.cancelFree', {'note': preview['note'] ?? ''}),
      confirmLabel: t('c14.cancelConfirm'),
      cancelLabel: t('c14.cancelBack'),
      danger: true,
    );
    if (!ok || !context.mounted) return;

    final reasons = ((await session.api.dictionaries())['cancelReasons'] as List? ?? const []).cast<String>();
    if (!context.mounted) return;
    final reason = await showSozoSheet<String>(
      context,
      title: t('c14.cancelReason'),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        children: [
          for (final r in reasons)
            Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SecondaryButton(r, onTap: () => Navigator.of(context).pop(r)),
            ),
        ],
      ),
    );
    if (reason == null || !context.mounted) return;
    try {
      await session.api.cancelOrder(order['id'] as String, reason);
      if (context.mounted) {
        showSozoToast(context, t('c14.cancelled'));
        Navigator.of(context).pop();
      }
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }
}

/// Выбор нового времени в листе переноса (242:185).
///
/// Отдельным виджетом с состоянием: лист показывается через showModalBottomSheet
/// и своего setState не имеет — без этого выбранный день некуда запомнить.
class _RescheduleTime extends StatefulWidget {
  const _RescheduleTime({required this.days, required this.onPick});

  final List<Map<String, dynamic>> days;
  final void Function(Map<String, dynamic> day, Map<String, dynamic> window) onPick;

  @override
  State<_RescheduleTime> createState() => _RescheduleTimeState();
}

class _RescheduleTimeState extends State<_RescheduleTime> {
  int _day = 0;

  @override
  Widget build(BuildContext context) {
    if (widget.days.isEmpty) return const SizedBox.shrink();
    final day = widget.days[_day.clamp(0, widget.days.length - 1)];
    final windows = ((day['windows'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 34,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: widget.days.length,
            separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
            itemBuilder: (context, i) {
              final active = i == _day;
              return Material(
                color: active ? SozoColors.accent : SozoColors.bg,
                borderRadius: BorderRadius.circular(100),
                child: InkWell(
                  borderRadius: BorderRadius.circular(100),
                  onTap: () => setState(() => _day = i),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: SozoSpace.s8),
                    child: Text(
                      relativeDay('${widget.days[i]['date']}T00:00:00'),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                        color: authInk,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: SozoSpace.s12),
        for (var r = 0; r < (windows.length + 1) ~/ 2; r++) ...[
          Row(
            children: [
              for (var c = 0; c < 2; c++)
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(left: c == 0 ? 0 : SozoSpace.s8),
                    child: r * 2 + c < windows.length
                        ? Material(
                            color: dialogSecondaryBg,
                            borderRadius: BorderRadius.circular(100),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(100),
                              onTap: () => widget.onPick(day, windows[r * 2 + c]),
                              child: SizedBox(
                                height: 44,
                                child: Center(
                                  child: Text(
                                    (windows[r * 2 + c]['label'] as String?) ?? '',
                                    style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: authInk,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          )
                        : const SizedBox(height: 44),
                  ),
                ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
        ],
      ],
    );
  }
}

/// Ссылка в подвале карточки заявки (242:110)
class _FooterLink extends StatelessWidget {
  const _FooterLink(this.label, {required this.color, this.onTap});

  final String label;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(SozoRadius.badge),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s4, vertical: SozoSpace.s4),
        child: Text(
          label,
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: color),
        ),
      ),
    );
  }
}
