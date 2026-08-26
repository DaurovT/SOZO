import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// M-25 «Этапные сессии» — работы с технологическими перерывами.
///
/// Ключевой инвариант: этап 1 не стартует, пока не подтверждены слоты всех
/// следующих этапов. Не начинай красить, если некому приехать домазать.
class StagesScreen extends StatefulWidget {
  const StagesScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<StagesScreen> createState() => _StagesScreenState();
}

class _StagesScreenState extends State<StagesScreen> {
  Map<String, dynamic>? _data;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.stages(widget.order.id);
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _complete(int index) async {
    String? photo;
    await showPhotoCapture(
      context,
      title: t('stage.fotoVProcesse'),
      stage: 'during',
      alreadyTaken: 0,
      hint: t('stage.snimiteSostoyanieNaMoment'),
      onUpload: (dataUrl) async {
        photo = dataUrl;
        return true;
      },
    );
    if (photo == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await session.api.completeStage(widget.order.id, index, photo!);
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('stage.etapZakryt')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = _data?['plan'] as Map<String, dynamic>?;
    final stages = ((plan?['stages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final canStart = _data?['canStart'] == true;
    final blocker = _data?['blocker'] as String?;
    final done = stages.where((s) => s['status'] == 'done').length;

    return Scaffold(
      appBar: SozoAppBar(title: t('order.etapyRaboty')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : plan == null
          ? EmptyView(
              title: t('stage.planEtapovNeSostavlen'),
              subtitle: t('stage.etapnayaRabotaPlaniruetsyaVmes'),
              icon: 'line-chart',
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: FigmaStatusChip(
                    label: t('stage.sessiyaIz', {'p1': done + 1, 'p2': stages.length}),
                    status: 'in_progress',
                  ),
                ),
                const SizedBox(height: SozoSpace.s12),
                if (blocker != null) ...[BlockerNote(text: blocker), const SizedBox(height: SozoSpace.s12)],
                ...stages.map((s) {
                  final isDone = s['status'] == 'done';
                  final index = (s['index'] as num).toInt();
                  final isCurrent =
                      !isDone && stages.where((x) => (x['index'] as num) < index).every((x) => x['status'] == 'done');
                  return Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                    child: FigmaCard(
                      children: [
                        Row(
                          children: [
                            StepMarker(
                              isDone
                                  ? SozoStepState.done
                                  : isCurrent
                                  ? SozoStepState.current
                                  : SozoStepState.pending,
                            ),
                            const SizedBox(width: SozoSpace.s12),
                            Expanded(
                              child: Text(
                                t('stage.etap', {'p1': index, 'p2': s['title']}),
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                              ),
                            ),
                            Text(
                              t('stage.ch', {'p1': s['normHours']}),
                              style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                            ),
                          ],
                        ),
                        Text(
                          s['slotAt'] != null
                              ? t('stage.zabronirovan', {'p1': ymd(s['slotAt'])})
                              : t('stage.slotNePodtverjden'),
                          style: TextStyle(fontSize: 13, color: s['slotAt'] != null ? softSuccessFg : softWarnFg),
                        ),
                        if ((s['pauseMinHours'] as num?) != null && (s['pauseMinHours'] as num) > 0)
                          Text(
                            t('stage.pauzaPosleOtDo', {'p1': s['pauseMinHours'], 'p2': s['pauseMaxHours']}),
                            style: const TextStyle(fontSize: 10, color: SozoColors.textSecondary),
                          ),
                        if (isCurrent && canStart)
                          BigButton(
                            label: t('stage.etapZavershen', {'p1': index}),
                            busy: _busy,
                            onPressed: () => _complete(index),
                          ),
                      ],
                    ),
                  );
                }),
                Text(
                  t('stage.mejduEtapamiZayavkaNe'),
                  style: TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
                ),
              ],
            ),
    );
  }
}

/// M-26 «Нужен помощник» — вызов второго человека, когда одному физически нельзя
class HelperRequestScreen extends StatefulWidget {
  const HelperRequestScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<HelperRequestScreen> createState() => _HelperRequestScreenState();
}

class _HelperRequestScreenState extends State<HelperRequestScreen> {
  String? _duration;
  int _feeTiyin = 0;
  List<({String code, String title})> _options = const [];
  bool _busy = false;
  String? _result;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await session.api.dictionaries();
      if (!mounted) return;
      setState(() {
        _options = ((d['helperDurations'] as List?) ?? const [])
            .map((r) => (code: (r as Map)['code'].toString(), title: r['title'].toString()))
            .toList();
        _feeTiyin = (d['helperFeeTiyin'] as num?)?.toInt() ?? 0;
      });
    } on ApiError {
      // офлайн — вызов помощника всё равно недоступен
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.helperRequest(widget.order.id, _duration!);
      if (mounted) setState(() => _result = (r['message'] ?? '').toString());
    } on ApiError catch (e) {
      if (mounted) {
        showError(context, e.isOffline ? t('stage.nujnaSetPozvoniteDispetcheru') : e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('order.nujenPomoschnik')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('stage.vskrylosChtoOdnomuFizicheski'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('stage.skolkoNujnaPomosch')),
          Wrap(
            spacing: SozoSpace.s8,
            runSpacing: SozoSpace.s8,
            children: _options
                .map(
                  (o) => ChoiceChip(
                    label: Text(o.title),
                    selected: _duration == o.code,
                    onSelected: (_) => setState(() => _duration = o.code),
                    selectedColor: SozoColors.accent.withValues(alpha: 0.14),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: SozoSpace.s16),
          if (_feeTiyin > 0)
            SozoCard(
              child: Row(
                children: [
                  const FigmaIcon('banknote', size: 20, color: SozoColors.textSecondary),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(child: Text(t('stage.fiksPomoschnikaZaSessiyu'))),
                  Text(formatSoums(_feeTiyin), style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          const SizedBox(height: SozoSpace.s8),
          Text(
            t('stage.fiksPomoschnikaOplachivaetNe'),
            style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
          ),
          if (_result != null) ...[const SizedBox(height: SozoSpace.s16), BlockerNote(text: _result!, icon: 'users')],
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('stage.otpravitMiniOffer'), busy: _busy, onPressed: _duration == null ? null : _send),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// M-29 «Оплата (B2C)» — «уйти без оплаты исключение, а не норма»
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  String? _qrPayload;
  String? _status;
  bool _busy = false;

  Future<void> _pay(String method) async {
    if (method == 'cash') {
      final ok = await showSozoConfirm(
        context,
        title: t('stage.nalichnye'),
        body: t('stage.vsyaSummaStanetVashim', {'p1': formatSoums(widget.order.totalFromTiyin)}),
        confirmLabel: t('stage.prinyal'),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    try {
      final r = await session.api.payment(widget.order.id, method);
      if (!mounted) return;
      setState(() {
        _qrPayload = r['qrPayload'] as String?;
        _status = (r['message'] ?? '').toString();
      });
      if (r['warning'] != null) showError(context, r['warning'].toString());
      if (method == 'cash') {
        showOk(context, t('stage.oplataPrinyata'));
        Navigator.of(context).pop(true);
      }
    } on ApiError catch (e) {
      if (e.isOffline && method == 'cash') {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'payment',
          payload: {'method': 'cash'},
          title: t('stage.nalichnye2', {'p1': widget.order.number}),
        );
        if (!mounted) return;
        showOk(context, queuedMessage(e));
        Navigator.of(context).pop(true);
      } else if (mounted) {
        showError(context, e.isOffline ? t('stage.onlaynOplataTrebuetSeti') : e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final offline = !session.outbox.online;
    return Scaffold(
      appBar: SozoAppBar(title: t('order.oplata')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
        children: [
          // Сумма — крупнее всего на экране: её мастер называет клиенту вслух
          Column(
            children: [
              Text(t('stage.kOplate'), style: TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
              const SizedBox(height: SozoSpace.s4),
              Text(
                formatSoums(widget.order.totalFromTiyin),
                style: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  color: SozoColors.text,
                  fontFeatures: moneyFeatures,
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s16),
          if (_qrPayload != null) ...[_qrCard(_qrPayload!), const SizedBox(height: SozoSpace.s16)],
          _method(t('stage.pokazatQr'), 'qr-code', 'qr', disabled: offline, active: _qrPayload != null),
          const SizedBox(height: SozoSpace.s12),
          _method(t('stage.otpravitSsylkuKlientu'), 'link', 'link', disabled: offline),
          const SizedBox(height: SozoSpace.s12),
          _method(t('stage.prinyalNalichnye', {'p1': formatSoums(widget.order.totalFromTiyin)}), 'banknote', 'cash'),
          if (offline) ...[const SizedBox(height: SozoSpace.s16), InfoBanner(t('stage.netSetiOnlaynOplata'))],
          if (_status != null && _status!.isNotEmpty) ...[const SizedBox(height: SozoSpace.s16), InfoBanner(_status!)],
          const SizedBox(height: SozoSpace.s16),
          Center(
            child: InkWell(
              onTap: () => showOk(context, t('order.uhodBezOplatySoglasovyvaet')),
              child: Padding(
                padding: EdgeInsets.all(SozoSpace.s8),
                child: Text(
                  t('stage.neMoguPoluchitOplatu'),
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: SozoColors.textSecondary,
                    decoration: TextDecoration.underline,
                    decorationColor: SozoColors.textSecondary,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Карточка QR (макет 43:143): янтарная рамка 1.5, код 120, ссылка 11
  Widget _qrCard(String payload) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        border: Border.all(color: SozoColors.accent, width: 1.5),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s12),
            child: SizedBox(
              width: 120,
              height: 120,
              child: QrImageView(data: payload, backgroundColor: SozoColors.surface),
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
          Text(
            payload,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s12),
          Text(
            t('stage.pokajiteKlientuOplataPodtverdi'),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: SozoColors.text),
          ),
        ],
      ),
    );
  }

  /// Способ оплаты (макет 43:108): p14, скругление 16, иконка 20 слева.
  /// Выбранный способ — янтарная заливка, недоступный — серая при 60%.
  Widget _method(String label, String icon, String method, {bool disabled = false, bool active = false}) {
    final off = disabled || _busy;
    return Opacity(
      opacity: off ? 0.6 : 1,
      child: Material(
        color: off
            ? SozoColors.border
            : active
            ? SozoColors.accent
            : SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.tile),
          onTap: off ? null : () => _pay(method),
          child: Container(
            constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
            alignment: Alignment.centerLeft,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(SozoRadius.tile),
              border: Border.all(color: off || active ? Colors.transparent : SozoColors.border),
            ),
            child: Row(
              children: [
                FigmaIcon(icon, size: 20),
                const SizedBox(width: SozoSpace.s12),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
