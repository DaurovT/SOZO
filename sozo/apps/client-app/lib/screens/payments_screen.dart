import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'order_screen.dart';

/// Способы оплаты и история платежей.
///
/// Два блока на одном экране, потому что открывают его по одной причине:
/// «сколько и чем я заплатил». Разводить это по разным разделам значило бы
/// заставить человека искать в двух местах ответ на один вопрос.
///
/// Сохранённых карт здесь нет — их токен выдаёт платёжный провайдер, а его
/// пока не подключили. Обещать привязку до этого нельзя.
class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  final _key = GlobalKey<AsyncViewState<_PaymentsData>>();
  bool _busy = false;

  Future<_PaymentsData> _load() async {
    final methods = await session.api.paymentMethods();
    final payments = await session.api.payments();
    return _PaymentsData(methods: methods, payments: payments);
  }

  /// Выбор способа. Повторный тап по уже выбранному снимает предпочтение —
  /// человек вправе вернуться к вопросу «чем платите?» каждый раз.
  Future<void> _choose(String code, String? current) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final res = await session.api.setPaymentMethod(code == current ? null : code);
      if (mounted) showSozoToast(context, (res['message'] as String?) ?? '');
      await _key.currentState?.reload();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('pay.title'), titleSize: 18),
      body: SafeArea(
        child: AsyncView<_PaymentsData>(
          key: _key,
          load: _load,
          builder: (context, data, reload) => _content(context, data),
        ),
      ),
    );
  }

  Widget _content(BuildContext context, _PaymentsData data) {
    final preferred = data.methods['preferred'] as String?;
    final lastUsed = data.methods['lastUsed'] as String?;
    final methods = ((data.methods['methods'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final payments = ((data.payments['payments'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return ListView(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, 48),
      children: [
        SectionHeading(t('pay.methods')),
        const SizedBox(height: SozoSpace.s16),

        // Способы — одной карточкой с разделителями, а не пятью отдельными:
        // это один выбор из пяти, и разнесённые карточки читались как пять
        // независимых настроек
        SozoCard(
          gap: 0,
          radius: SozoRadius.tile,
          padding: EdgeInsets.zero,
          children: [
            for (var i = 0; i < methods.length; i++)
              _methodRow(methods[i], preferred, lastUsed, last: i == methods.length - 1),
          ],
        ),
        const SizedBox(height: SozoSpace.s16),
        _providerNote((data.methods['note'] as String?) ?? ''),

        const SizedBox(height: SozoSpace.s24),
        SectionHeading(t('pay.history')),
        const SizedBox(height: SozoSpace.s16),

        if (payments.isEmpty)
          SozoCard(
            radius: SozoRadius.tile,
            children: [
              Text(
                (data.payments['empty'] as String?) ?? t('pay.empty'),
                style: const TextStyle(fontSize: 14, color: authHint),
              ),
            ],
          )
        else ...[
          SozoCard(
            radius: SozoRadius.tile,
            children: [
              _summaryRow(t('pay.totalPaid'), soums(data.payments['totalTiyin'])),
              if (((data.payments['tipsTiyin'] as num?) ?? 0) > 0)
                _summaryRow(t('pay.tips'), soums(data.payments['tipsTiyin'])),
              if (((data.payments['pending'] as num?) ?? 0) > 0) ...[
                const SozoDivider(),
                Text(
                  t('pay.pendingNote', {'n': data.payments['pending']}),
                  style: const TextStyle(fontSize: 12, color: authHint),
                ),
              ],
            ],
          ),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            gap: 0,
            radius: SozoRadius.tile,
            padding: EdgeInsets.zero,
            children: [
              for (var i = 0; i < payments.length; i++)
                _historyEntry(context, payments[i], last: i == payments.length - 1),
            ],
          ),
        ],
      ],
    );
  }

  /// Строка способа оплаты (264:21)
  Widget _methodRow(Map<String, dynamic> m, String? preferred, String? lastUsed, {required bool last}) {
    final code = m['code'] as String;
    final chosen = code == preferred;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _busy ? null : () => _choose(code, preferred),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s14),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: authCardDivider)),
          ),
          child: Row(
            children: [
              _brandMark(code),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            (m['title'] as String?) ?? '',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: authInk),
                          ),
                        ),
                        // Подсказка «платили в прошлый раз» стоит только там, где
                        // выбора ещё нет: рядом с уже выбранным она бессмысленна
                        if (!chosen && code == lastUsed) ...[
                          const SizedBox(width: SozoSpace.s8),
                          Flexible(
                            child: TagChip(t('pay.lastUsed'), bg: payLastUsedBg, fg: payLastUsedFg),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (m['note'] as String?) ?? '',
                      style: const TextStyle(fontSize: 10, color: authHint),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              _RadioDot(selected: chosen),
            ],
          ),
        ),
      ),
    );
  }

  /// Плитка 36 со знаком платёжной системы: у Payme, Click и Uzum он свой,
  /// у карты и наличных — иконка (264:22)
  Widget _brandMark(String code) {
    const logos = {
      'payme': 'assets/logo/pay-payme.png',
      'click': 'assets/logo/pay-click.png',
      'uzum': 'assets/logo/pay-uzum.png',
    };
    final logo = logos[code];
    return Container(
      width: 36,
      height: 36,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: SozoColors.bg,
        borderRadius: BorderRadius.circular(10),
      ),
      alignment: Alignment.center,
      child: logo == null
          ? FigmaIcon(code == 'cash' ? 'banknote' : 'credit-card', size: 20, color: authInk)
          : Image.asset(logo, width: 36, height: 36, fit: BoxFit.cover),
    );
  }

  /// Оговорка про провайдера (264:63)
  Widget _providerNote(String text) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(
        color: payNoteBg,
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: FigmaIcon('info', size: 16, color: payNoteFg),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 12, height: 1.4, color: payNoteFg),
            ),
          ),
        ],
      ),
    );
  }

  /// Строка свода: «Всего оплачено — 370 000 сум» (264:70)
  Widget _summaryRow(String label, String amount) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: authInk),
          ),
        ),
        const SizedBox(width: SozoSpace.s8),
        Text(
          amount,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: authInk,
            fontFeatures: moneyFeatures,
          ),
        ),
      ],
    );
  }

  /// Запись истории (264:79): работа и сумма сверху, дата и пометка снизу
  Widget _historyEntry(BuildContext context, Map<String, dynamic> p, {required bool last}) {
    final tip = (p['tipTiyin'] as num?) ?? 0;
    final pending = p['status'] != 'succeeded';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: p['orderId'] as String)),
        ),
        child: Container(
          padding: const EdgeInsets.all(SozoSpace.s16),
          decoration: BoxDecoration(
            border: last ? null : const Border(bottom: BorderSide(color: authCardDivider)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      (p['title'] as String?) ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: authInk),
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s8),
                  Text(
                    soums(p['amountTiyin']),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: authInk,
                      fontFeatures: moneyFeatures,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      [
                        dayMonth(p['at']),
                        _provider(p['provider'] as String?),
                        p['number'],
                      ].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: authHint),
                    ),
                  ),
                  // Наличные, которые мастер ещё не подтвердил, — не оплата;
                  // чаевые, наоборот, стоит показать как отдельную заслугу
                  if (pending) ...[
                    const SizedBox(width: SozoSpace.s8),
                    _entryBadge(t('pay.awaiting'), bg: softWarnBg, fg: softWarnFg),
                  ] else if (tip > 0) ...[
                    const SizedBox(width: SozoSpace.s8),
                    _entryBadge(t('pay.tipLine', {'sum': soums(tip)}), bg: homeOkChipBg, fg: homeOkChipFg),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _entryBadge(String label, {required Color bg, required Color fg}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }

  static String _provider(String? code) => switch (code) {
        'payme' => 'Payme',
        'click' => 'Click',
        'uzum' => 'Uzum',
        'cash' => t('c20.cash'),
        _ => t('c20.card'),
      };
}

/// Кружок выбора способа (264:30). Радио, а не галочка: способ ровно один,
/// и форма элемента должна об этом говорить до того, как человек нажмёт
class _RadioDot extends StatelessWidget {
  const _RadioDot({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 16,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: selected ? SozoColors.accent : radioOutline, width: 1.5),
      ),
      child: selected
          ? Center(
              child: Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
              ),
            )
          : null,
    );
  }
}

class _PaymentsData {
  _PaymentsData({required this.methods, required this.payments});

  final Map<String, dynamic> methods;
  final Map<String, dynamic> payments;
}
