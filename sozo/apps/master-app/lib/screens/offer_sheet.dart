import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../widgets/common.dart';
import '../i18n.dart';

/// Оффер с таймером-кольцом (DEV-09 П-1, экран M-04).
///
/// До принятия видны только район, категория, вилка и доля — точный адрес
/// и телефон клиента открываются после «Принять» (PRD-02 §3.2).
/// Молчание считается отказом: кольцо доходит до нуля и экран закрывается сам.
class OfferSheet extends StatefulWidget {
  const OfferSheet({
    super.key,
    required this.offer,
    required this.ttlSeconds,
    required this.declineReasons,
    required this.onAccept,
    required this.onDecline,
  });

  final Offer offer;
  final int ttlSeconds;
  final List<({String code, String title})> declineReasons;

  /// Возвращает id принятой заявки. Открывать её должен вызывающий экран,
  /// а не этот: иначе карточка окажется поверх оффера и закроется вместе с ним.
  final Future<String?> Function() onAccept;
  final Future<void> Function(String reasonCode) onDecline;

  @override
  State<OfferSheet> createState() => _OfferSheetState();
}

class _OfferSheetState extends State<OfferSheet> {
  late int _left = widget.offer.secondsLeft;
  Timer? _timer;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _left = math.max(0, _left - 1));
      if (_left == 0) {
        _timer?.cancel();
        // Таймаут = отказ, но не молча: экран, исчезнувший сам по себе,
        // мастер читает как сбой приложения, а не как «время вышло»
        showOk(context, t('offer.vremyaVyshlo'));
        Navigator.of(context).maybePop();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _accept() async {
    setState(() => _busy = true);
    _timer?.cancel();
    try {
      final orderId = await widget.onAccept();
      if (mounted) Navigator.of(context).pop(orderId);
    } catch (e) {
      if (mounted) {
        showError(context, e);
        Navigator.of(context).pop();
      }
    }
  }

  Future<void> _decline() async {
    // Бродкаст пропускают без причины и без штрафа — спрашивать нечего
    if (widget.offer.kind != 'personal') {
      setState(() => _busy = true);
      _timer?.cancel();
      try {
        await widget.onDecline('');
      } catch (_) {
        // пропуск бродкаста ничего не меняет для мастера — молча закрываем
      }
      if (mounted) Navigator.of(context).pop();
      return;
    }
    await _declineWithReason();
  }

  Future<void> _declineWithReason() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.all(SozoSpace.s16),
              child: Text(t('offer.pochemuOtkazyvaetes'), style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: SozoSpace.s16),
              child: Text(
                t('offer.prichinaNujnaDispetcheruChtoby'),
                style: TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
              ),
            ),
            const SizedBox(height: SozoSpace.s8),
            for (final r in widget.declineReasons)
              ListTile(
                title: Text(r.title),
                trailing: const FigmaIcon('chevron-right', size: 16),
                onTap: () => Navigator.of(ctx).pop(r.code),
              ),
            const SizedBox(height: SozoSpace.s8),
          ],
        ),
      ),
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    _timer?.cancel();
    try {
      await widget.onDecline(reason);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        showError(context, e);
        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.offer;
    final progress = widget.ttlSeconds == 0 ? 0.0 : _left / widget.ttlSeconds;
    final urgent = o.urgency != 'normal';
    return Scaffold(
      backgroundColor: SozoColors.bg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Содержимое прокручивается, кнопки закреплены снизу.
              //
              // Оффер живёт 60 секунд, и «Принять» обязана быть на экране
              // всегда. При этом на узбекском текст длиннее, и на невысоком
              // телефоне колонка вылезала за низ экрана на 180 точек —
              // мастер не видел ни доли, ни кнопки
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                  const SizedBox(height: SozoSpace.s16),
                  Center(
                    child: SizedBox(
                      width: 128,
                      height: 128,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          SizedBox(
                            width: 128,
                            height: 128,
                            child: CircularProgressIndicator(
                              value: progress,
                              strokeWidth: 8,
                              backgroundColor: SozoColors.border,
                              valueColor: AlwaysStoppedAnimation(_left <= 10 ? SozoColors.error : SozoColors.accent),
                            ),
                          ),
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                '$_left',
                                style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w700, color: SozoColors.text),
                              ),
                              Text(t('offer.sekund'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s24),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: SozoSpace.s8,
                    runSpacing: SozoSpace.s8,
                    children: [
                      if (urgent) ...[
                        StatusChip(
                          label: o.urgency == 'emergency' ? t('offer.avariya') : t('common.srochno'),
                          status: 'dispute',
                          icon: 'bolt',
                        ),
                        const SizedBox(width: SozoSpace.s8),
                      ],
                      if (o.isPaired) StatusChip(label: t('offer.parnayaRabota'), status: 'assigned', icon: 'users'),
                    ],
                  ),
                  if (o.kind == 'express') ...[
                    const SizedBox(height: SozoSpace.s8),
                    BlockerNote(
                      icon: 'alert-circle',
                      text: o.waitingSince != null
                          ? t('offer.srochnayaZamenaKlientJdet', {'p1': hhmm(o.waitingSince)})
                          : t('offer.srochnayaZamenaKlientUje'),
                    ),
                    Padding(
                      padding: EdgeInsets.only(top: SozoSpace.s4),
                      child: Text(
                        t('offer.zayavkuPoluchaetPervyyPrinyavs'),
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                      ),
                    ),
                  ],
                  const SizedBox(height: SozoSpace.s16),
                  SozoCard(
                    accent: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(o.category, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.25)),
                        const SizedBox(height: SozoSpace.s12),
                        _row('map-pin', t('offer.rayon'), tv(o.district)),
                        _row(
                          'clipboard',
                          t('offer.smetaKlientu'),
                          o.estimateFromTiyin > 0
                              ? t('common.ot', {'p1': formatSoums(o.estimateFromTiyin)})
                              : t('offer.poSmeteNaMeste'),
                        ),
                        _row(
                          'credit-card',
                          t('common.vashaDolya'),
                          o.masterShareFromTiyin > 0
                              ? t('common.ot', {'p1': formatSoums(o.masterShareFromTiyin)})
                              : t('offer.n5OtSmety'),
                          accent: true,
                        ),
                        const SizedBox(height: SozoSpace.s12),
                        Text(
                          t('offer.tochnyyAdresITelefon'),
                          style: TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.35),
                        ),
                      ],
                    ),
                  ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
              PrimaryButton(label: t('offer.prinyatZayavku'), busy: _busy, onPressed: _accept),
              const SizedBox(height: SozoSpace.s12),
              SizedBox(
                height: 48,
                child: TextButton(
                  onPressed: _busy ? null : _decline,
                  child: Text(
                    o.kind == 'personal' ? t('offer.neMoguVzyat') : t('offer.propustit'),
                    style: const TextStyle(fontSize: 16, color: SozoColors.textSecondary),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String icon, String label, String value, {bool accent = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
      child: Row(
        children: [
          FigmaIcon(icon, size: 18, color: SozoColors.textSecondary),
          const SizedBox(width: SozoSpace.s8),
          Text(label, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
          const SizedBox(width: SozoSpace.s8),
          // Значение занимает остаток строки и переносится: адрес и «по смете
          // на месте» длиннее подписи, и Spacer выталкивал их за край на 405
          // точек — мастер не видел ни адреса, ни своей доли
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: accent ? 17 : 15,
                fontWeight: accent ? FontWeight.w700 : FontWeight.w600,
                color: accent ? SozoColors.accent : SozoColors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
