import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../i18n.dart';

/// M-34 «Кошелёк» — полная прозрачность: каждая сумма с расшифровкой до заявки.
///
/// Формула читается сверху вниз: начисления → удержания → наличные у вас → к выплате.
/// Наличные показаны отдельно, потому что это долг компании, а не заработок.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _tips;
  String _period = 'week';

  /// Раскрытая секция детализации — раскрыта всегда одна: две открытые
  /// колонки сумм на телефоне сливаются
  String? _expanded;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.wallet(period: _period);
      final tips = await session.api.tips();
      if (!mounted) return;
      setState(() {
        _data = r;
        _tips = tips;
        _error = null;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    }
  }

  Future<void> _deposit() async {
    final debt = (_data?['cashDebtTiyin'] as num?)?.toInt() ?? 0;
    if (debt <= 0) {
      showOk(context, t('money.dolgaNetVnositNechego'));
      return;
    }
    final ctrl = TextEditingController(text: (debt / 100).round().toString());
    final amount = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('money.vnestiNalichnye')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t('money.vashDolg', {'p1': formatSoums(debt)})),
            const SizedBox(height: SozoSpace.s12),
            TextField(
              controller: ctrl,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: t('common.summaSum')),
            ),
            const SizedBox(height: SozoSpace.s8),
            Wrap(
              spacing: SozoSpace.s8,
              children: [
                ActionChip(
                  label: Text(t('money.vesDolg')),
                  onPressed: () => ctrl.text = (debt / 100).round().toString(),
                ),
                ActionChip(
                  label: Text(t('money.polovina')),
                  onPressed: () => ctrl.text = (debt / 200).round().toString(),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(int.tryParse(ctrl.text.trim())),
            child: Text(t('money.oplatit')),
          ),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !mounted) return;
    try {
      final r = await session.api.cashDeposit(amount);
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('res.zachisleno')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.isOffline ? t('money.vnesenieRabotaetTolkoPri') : e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return _error != null
          ? EmptyView(title: t('money.koshelekNedostupen'), subtitle: _error, icon: 'alert-circle')
          : const Center(child: CircularProgressIndicator());
    }
    final accrued = (d['accruedTiyin'] as num).toInt();
    final paid = (d['paidTiyin'] as num).toInt();
    final due = (d['dueTiyin'] as num).toInt();
    final debt = (d['cashDebtTiyin'] as num).toInt();
    final limit = (d['cashLimitTiyin'] as num?)?.toInt() ?? 200000000;
    final sections = ((d['sections'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final blocked = ((d['blocked'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final periods = ((d['periods'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return Column(
      children: [
        SozoTabHeader(t('money.koshelek')),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s24),
              children: [
                if (periods.length > 1) ...[
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: periods
                          .map(
                            (p) => Padding(
                              padding: const EdgeInsets.only(right: SozoSpace.s8),
                              child: ChoicePill(
                                label: p['title'].toString(),
                                selected: _period == p['code'],
                                onTap: () {
                                  setState(() => _period = p['code'].toString());
                                  _load();
                                },
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s12),
                ],
                if (d['frozen'] != null) ...[
                  BlockerNote(text: d['frozen'].toString(), icon: 'alert-circle'),
                  const SizedBox(height: SozoSpace.s12),
                ],
                _summaryCard(accrued, paid, debt, due),
                const SizedBox(height: SozoSpace.s12),
                _cashCard(debt, limit),
                if (blocked.isNotEmpty) ...[
                  const SizedBox(height: SozoSpace.s12),
                  ...blocked.map(
                    (b) => Padding(
                      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                      child: BlockerNote(
                        text: '${b['orderNumber']}: ${b['note']}',
                        icon: 'alert-triangle',
                        danger: true,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: SozoSpace.s12),
                ...sections.map(_section),
                if (_tips != null && ((_tips!['totalTiyin'] as num?)?.toInt() ?? 0) > 0)
                  _detailCard(
                    title: t('money.chaevye'),
                    note: _tips!['note']?.toString(),
                    value: formatSoums((_tips!['totalTiyin'] as num).toInt()),
                    valueColor: incomeGreen,
                  ),
                if (d['taxMode'] == 'gph')
                  _detailCard(title: t('money.rejimGph'), note: t('money.izVyplatyUderjivayutsyaNdfl'), value: ''),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Формула кошелька (макет 51:17): янтарная полоса слева, итог 20/bold.
  /// Мастер должен видеть, из чего сложилась выплата, а не только результат.
  Widget _summaryCard(int accrued, int paid, int debt, int due) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        border: const Border(left: BorderSide(color: SozoColors.accent, width: 4)),
      ),
      child: Column(
        children: [
          _formulaRow(t('money.nachisleniya'), '+ ${formatSoums(accrued)}', color: incomeGreen),
          const SizedBox(height: SozoSpace.s12),
          _formulaRow(t('money.vyplacheno'), '− ${formatSoums(paid)}'),
          const SizedBox(height: SozoSpace.s12),
          _formulaRow(t('money.nalichnyeUVas'), '− ${formatSoums(debt)}'),
          const SizedBox(height: SozoSpace.s12),
          const FigmaDivider(),
          const SizedBox(height: SozoSpace.s12),
          Row(
            children: [
              Expanded(
                child: Text(
                  t('money.kVyplate'),
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
              ),
              Money(
                formatSoums(due),
                size: 20,
                weight: FontWeight.w700,
                color: due < 0 ? softDangerFg : SozoColors.text,
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Наличные на руках (макет 51:31): полоса 8 показывает, сколько до лимита
  Widget _cashCard(int debt, int limit) {
    final ratio = limit == 0 ? 0.0 : (debt / limit).clamp(0.0, 1.0);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('money.nalichnyeNaRukah'),
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
          ),
          const SizedBox(height: SozoSpace.s12),
          ClipRRect(
            borderRadius: BorderRadius.circular(SozoRadius.s4),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 8,
              backgroundColor: trackGrey,
              valueColor: AlwaysStoppedAnimation(
                debt >= limit ? softDangerFg : (debt >= limit * 0.8 ? softWarnFg : incomeGreen),
              ),
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
          Text(
            t('onb.iz', {'p1': formatSoums(debt), 'p2': formatSoums(limit)}),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
          ),
          if (debt >= limit) ...[
            const SizedBox(height: SozoSpace.s12),
            BlockerNote(icon: 'alert-triangle', danger: true, text: t('money.vnesiteInacheSnyatieS')),
          ],
          if (debt > 0) ...[
            const SizedBox(height: SozoSpace.s12),
            PrimaryButton(label: t('money.vnestiCherezPayme'), onPressed: _deposit),
          ],
        ],
      ),
    );
  }

  Widget _formulaRow(String label, String value, {Color? color}) {
    return Row(
      children: [
        Expanded(
          child: Text(label, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: color ?? SozoColors.text,
            fontFeatures: moneyFeatures,
          ),
        ),
      ],
    );
  }

  /// Строка детализации (макет 51:36). Раскрывается по тапу: свёрнутый вид
  /// совпадает с макетом, разбивка нужна, когда сумма не сошлась.
  Widget _detailCard({
    required String title,
    String? note,
    required String value,
    Color? valueColor,
    VoidCallback? onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
      child: Material(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.card),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(SozoSpace.s16),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(SozoRadius.card)),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                      ),
                      if (note != null && note.isNotEmpty) ...[
                        const SizedBox(height: SozoSpace.s4),
                        Text(note, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4)),
                      ],
                    ],
                  ),
                ),
                if (value.isNotEmpty) ...[
                  const SizedBox(width: SozoSpace.s12),
                  Money(value, size: 16, weight: FontWeight.w700, color: valueColor),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _section(Map<String, dynamic> s) {
    final rows = ((s['rows'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final total = (s['totalTiyin'] as num?)?.toInt() ?? 0;
    final code = s['title'].toString();
    final expanded = _expanded == code;
    return Column(
      children: [
        _detailCard(
          title: code,
          note: s['note']?.toString(),
          value: formatSoums(total),
          onTap: rows.isEmpty ? null : () => setState(() => _expanded = expanded ? null : code),
        ),
        if (expanded)
          Padding(
            padding: const EdgeInsets.only(left: SozoSpace.s16, bottom: SozoSpace.s8),
            child: Column(
              children: rows
                  .map(
                    (r) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Expanded(child: Text(r['title'].toString(), style: const TextStyle(fontSize: 14))),
                          Money(formatSoums((r['amountTiyin'] as num).toInt()), size: 14, weight: FontWeight.w500),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
      ],
    );
  }
}
