import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/photo_grid.dart';

/// C-15…C-18. Решения клиента по смете.
///
/// Экраны разведены тоном намеренно: вынужденная доп-работа (C-16) красная и
/// блокирующая, рекомендация (C-17) нейтральная и необязательная. Спутать их
/// нельзя — на этом строится доверие к тому, что тебе не навязывают.
enum DecisionKind { estimate, spareTier, addwork, recommendation, stages }

class DecisionScreen extends StatefulWidget {
  const DecisionScreen({super.key, required this.order, required this.kind});

  final Map<String, dynamic> order;
  final DecisionKind kind;

  @override
  State<DecisionScreen> createState() => _DecisionScreenState();
}

class _DecisionScreenState extends State<DecisionScreen> {
  bool _busy = false;
  String? _error;

  String? _variant;
  String? _tier;
  final Map<int, String> _stageSlots = {};

  Map<String, dynamic> get _pending => (widget.order['pending'] as Map<String, dynamic>?) ?? const {};

  @override
  void initState() {
    super.initState();
    if (widget.kind == DecisionKind.estimate) {
      unawaited(session.api.track('estimate_shown'));
    }
  }

  Future<void> _send(Map<String, dynamic> body, {String? successEvent}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await session.api.decide(widget.order['id'] as String, body);
      if (successEvent != null) unawaited(session.api.track(successEvent));
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? t('common.done'));
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(
        // Звонок диспетчеру — вспомогательное действие, ему место в шапке.
        // Внизу должно оставаться то, ради чего экран открыт
        action: SozoAppBarAction(icon: 'phone', onTap: () => _callDispatcher(context)),
        title: switch (widget.kind) {
          DecisionKind.estimate => t('c15.title'),
          DecisionKind.spareTier => t('c15.tierTitle'),
          DecisionKind.addwork => t('c16.title'),
          DecisionKind.recommendation => t('c17.title'),
          DecisionKind.stages => t('c18.title'),
        },
      ),
      body: SafeArea(
        child: switch (widget.kind) {
          DecisionKind.estimate => _estimate(),
          DecisionKind.spareTier => _spareTier(),
          DecisionKind.addwork => _addwork(),
          DecisionKind.recommendation => _recommendation(),
          DecisionKind.stages => _stages(),
        },
      ),
    );
  }

  void _callDispatcher(BuildContext context) {
    callPhone(context, (session.me?['supportPhone'] as String?) ?? '+998712000000');
  }

  Widget _errorBox() => _error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: SozoSpace.s12),
          child: SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
        );

  // ---------------- C-15. Подтверждение сметы ----------------

  Widget _estimate() {
    final lines = ((widget.order['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final master = widget.order['master'] as Map<String, dynamic>?;
    final total = (widget.order['totalFromTiyin'] as num?)?.toInt() ?? 0;
    final initial = ((widget.order['quotes'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .where((q) => q['kind'] == 'initial')
        .firstOrNull;
    final initialAmount = (initial?['amountTiyin'] as num?)?.toInt() ?? 0;
    final delta = total - initialAmount;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              SozoBanner(
                icon: 'file-text',
                tone: BannerTone.info,
                text: t('c15.context', {'master': master?['name'] ?? t('c50.masterFallback')}),
              ),
              const SizedBox(height: SozoSpace.s16),
              SozoCard(
                children: [
                  for (final l in lines)
                    MoneyRow(
                      label: (l['name'] as String?) ?? '',
                      sub: (l['qty'] as num? ?? 1) > 1
                          ? '${l['qty']} × ${soums(((l['fromTiyin'] as num?)?.toInt() ?? 0) ~/ ((l['qty'] as num?)?.toInt() ?? 1))}'
                          : null,
                      amount: soums(l['fromTiyin']),
                    ),
                  const SozoDivider(),
                  MoneyRow(label: t('c15.total'), amount: soums(total), bold: true),
                ],
              ),
              // Превышение первоначальной вилки объясняется, а не подаётся фактом
              if (delta > 0) ...[
                const SizedBox(height: SozoSpace.s12),
                SozoBanner(
                  icon: 'alert-triangle',
                  tone: BannerTone.warn,
                  title: t('c15.deltaTitle', {'sum': soums(delta)}),
                  text: t('c15.deltaText'),
                ),
              ],
              const SizedBox(height: SozoSpace.s12),
              Text(
                t('c15.materialsNote'),
                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
              ),
              _errorBox(),
            ],
          ),
        ),
        StickyFooter(
          gap: SozoSpace.s4,
          children: [
            PrimaryButton(
              t('c15.agree'),
              busy: _busy,
              onTap: () => _send({'kind': 'estimate', 'accept': true}, successEvent: 'estimate_approved'),
            ),
            // Отказ не равновелик согласию: текстом, а не кнопкой той же формы
            TextAction(t('c15.decline'), onTap: _busy ? null : _declineEstimate, danger: true),
          ],
        ),
      ],
    );
  }

  Future<void> _declineEstimate() async {
    final ok = await showSozoConfirm(
      context,
      title: t('c15.declineTitle'),
      text: t('c15.declineText'),
      confirmLabel: t('c15.declineConfirm'),
      cancelLabel: t('c15.declineBack'),
      danger: true,
    );
    if (!ok) return;
    await _send({'kind': 'estimate', 'accept': false}, successEvent: 'estimate_declined');
  }

  // ---------------- C-15. Уровень запчасти ----------------

  Widget _spareTier() {
    final rec = _pending['spareTier'] as Map<String, dynamic>?;
    final variants = ((rec?['variants'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              SozoBanner(
                icon: 'shopping-bag',
                text: t('c15.tierContext', {'part': rec?['partName'] ?? ''}),
              ),
              const SizedBox(height: SozoSpace.s16),
              for (final v in variants) ...[
                RadioCard(
                  title: (v['title'] as String?) ?? '',
                  subtitle: v['note'] as String?,
                  trailing: soums(v['amountTiyin']),
                  selected: _tier == v['tier'],
                  onTap: () => setState(() => _tier = v['tier'] as String?),
                ),
                const SizedBox(height: SozoSpace.s8),
              ],
              _errorBox(),
            ],
          ),
        ),
        StickyFooter(
          children: [
            PrimaryButton(
              t('c15.tierConfirm'),
              busy: _busy,
              onTap: _tier == null ? null : () => _send({'kind': 'spare_tier', 'tier': _tier}),
            ),
          ],
        ),
      ],
    );
  }

  // ---------------- C-16. Вынужденная доп-работа ----------------

  Widget _addwork() {
    final rec = _pending['addwork'] as Map<String, dynamic>?;
    final variants = ((rec?['variants'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final photos = ((widget.order['photos'] as List?) ?? const [])
        .cast<Map<String, dynamic>>()
        .where((p) => p['stage'] == 'during' || p['stage'] == 'before')
        .toList();

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              SozoBanner(
                icon: 'alert-triangle',
                tone: BannerTone.danger,
                title: t('c16.blockTitle'),
                text: t('c16.blockText'),
              ),
              if (photos.isNotEmpty) ...[
                const SizedBox(height: SozoSpace.s16),
                PhotoGrid(
                  photos: [
                    for (final p in photos) PhotoRef(url: _absolute(p['url'] as String?)),
                  ],
                ),
              ],
              const SizedBox(height: SozoSpace.s16),
              for (final v in variants) ...[
                RadioCard(
                  title: (v['title'] as String?) ?? '',
                  subtitle: ((v['lines'] as List?) ?? const []).map((l) => (l as Map)['name']).join(', '),
                  trailing: soums(v['totalTiyin']),
                  selected: _variant == v['kind'],
                  onTap: () => setState(() => _variant = v['kind'] as String?),
                ),
                const SizedBox(height: SozoSpace.s8),
              ],
              const SizedBox(height: SozoSpace.s8),
              Text(
                t('c16.ifDecline'),
                style: const TextStyle(fontSize: 13, height: 1.4, color: SozoColors.textSecondary),
              ),
              _errorBox(),
            ],
          ),
        ),
        StickyFooter(
          children: [
            PrimaryButton(
              _variant == null
                  ? t('c16.agreeGeneric')
                  : t('c16.agreeWith', {
                      'variant': variants.where((v) => v['kind'] == _variant).firstOrNull?['title'] ?? '',
                    }),
              busy: _busy,
              onTap: _variant == null
                  ? null
                  : () => _send({'kind': 'addwork', 'accept': true, 'variant': _variant}),
            ),
            TextAction(t('c16.decline'), onTap: _busy ? null : _declineAddwork, danger: true),
          ],
        ),
      ],
    );
  }

  Future<void> _declineAddwork() async {
    final ok = await showSozoConfirm(
      context,
      title: t('c16.declineTitle'),
      text: t('c16.declineText'),
      confirmLabel: t('c16.declineConfirm'),
      cancelLabel: t('c15.declineBack'),
      danger: true,
    );
    if (!ok) return;
    await _send({'kind': 'addwork', 'accept': false});
  }

  // ---------------- C-17. Рекомендация мастера ----------------

  Widget _recommendation() {
    final rec = _pending['recommendation'] as Map<String, dynamic>?;
    final lines = ((rec?['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final total = lines.fold<int>(
      0,
      (s, l) => s + ((l['amountTiyin'] as num?)?.toInt() ?? 0) * ((l['qty'] as num?)?.toInt() ?? 1),
    );

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              // Нейтральный тон — сознательное отличие от C-16
              SozoBanner(icon: 'sparkles', text: t('c17.notMandatory')),
              const SizedBox(height: SozoSpace.s16),
              SozoCard(
                children: [
                  for (final l in lines)
                    MoneyRow(
                      label: (l['name'] as String?) ?? '',
                      sub: (l['qty'] as num? ?? 1) > 1 ? '× ${l['qty']}' : null,
                      amount: soums(((l['amountTiyin'] as num?)?.toInt() ?? 0) * ((l['qty'] as num?)?.toInt() ?? 1)),
                    ),
                  const SozoDivider(),
                  MoneyRow(label: t('c17.total'), amount: soums(total), bold: true),
                ],
              ),
              if ((rec?['comment'] as String?)?.isNotEmpty ?? false) ...[
                const SizedBox(height: SozoSpace.s12),
                SozoCard(
                  children: [
                    Text(
                      '«${rec!['comment']}»',
                      style: const TextStyle(
                        fontSize: 14,
                        height: 1.4,
                        fontStyle: FontStyle.italic,
                        color: SozoColors.text,
                      ),
                    ),
                  ],
                ),
              ],
              _errorBox(),
            ],
          ),
        ),
        StickyFooter(
          gap: SozoSpace.s4,
          children: [
            PrimaryButton(
              t('c17.accept'),
              busy: _busy,
              onTap: () => _send({'kind': 'recommendation', 'accept': true}),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                TextAction(
                  t('c17.postpone'),
                  onTap: _busy ? null : () => _send({'kind': 'recommendation', 'postpone': true}),
                ),
                // Отказ без уговоров: диалог «вы уверены?» здесь был бы давлением
                TextAction(
                  t('c17.decline'),
                  onTap: _busy ? null : () => _send({'kind': 'recommendation', 'accept': false}),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }

  // ---------------- C-18. План визитов ----------------

  Widget _stages() {
    final plan = _pending['stagePlan'] as Map<String, dynamic>?;
    final stages = ((plan?['stages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final allChosen = stages.every((s) => s['slotAt'] != null || _stageSlots.containsKey(s['index']));

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              SozoBanner(icon: 'info', text: t('c18.rule')),
              const SizedBox(height: SozoSpace.s16),
              for (final s in stages) ...[
                SozoCard(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            color: s['status'] == 'done' ? SozoColors.success : SozoColors.accent,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            '${s['index']}',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: SozoColors.onAccent,
                            ),
                          ),
                        ),
                        const SizedBox(width: SozoSpace.s12),
                        Expanded(
                          child: Text(
                            (s['title'] as String?) ?? '',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      _stageSlots[s['index']] != null
                          ? '${relativeDay(_stageSlots[s['index']])} ${hhmm(_stageSlots[s['index']])}'
                          : (s['slotAt'] != null
                              ? '${relativeDay(s['slotAt'])} ${hhmm(s['slotAt'])}'
                              : t('c18.noSlot')),
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                    ),
                    if (s['status'] != 'done')
                      SecondaryButton(
                        t('c18.pickSlot'),
                        icon: 'calendar',
                        onTap: () => _pickStageSlot((s['index'] as num).toInt()),
                      ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s8),
                if (s != stages.last)
                  Text(
                    t('c18.pause'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                  ),
                const SizedBox(height: SozoSpace.s8),
              ],
              _errorBox(),
            ],
          ),
        ),
        StickyFooter(
          children: [
            PrimaryButton(
              t('c18.confirm'),
              busy: _busy,
              // Этап 1 не стартует без подтверждённой цепочки — инвариант ТЗ 4.1
              onTap: allChosen
                  ? () => _send({
                        'kind': 'stages',
                        'slots': [
                          for (final e in _stageSlots.entries) {'index': e.key, 'at': e.value},
                        ],
                      })
                  : null,
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickStageSlot(int index) async {
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 30)),
      initialDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (time == null || !mounted) return;
    final at = DateTime(picked.year, picked.month, picked.day, time.hour, time.minute);
    setState(() => _stageSlots[index] = at.toIso8601String());
  }

  static String? _absolute(String? path) =>
      path == null ? null : (path.startsWith('http') ? path : '${session.api.baseUrl}$path');
}
