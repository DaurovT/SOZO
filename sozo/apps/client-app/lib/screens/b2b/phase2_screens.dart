import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../../widgets/figma_icon.dart';
import 'approvals_inbox.dart';
import 'org_screens.dart';
import 'site_screens.dart';

/// C-42. Пакетное утверждение дефектов после осмотра (фаза 2).
///
/// Смысл экрана — решить пакетом, а не по одному: после обхода дефектов бывает
/// восемь, и восемь отдельных согласований никто не пройдёт. Критичные отмечены
/// заранее — отказаться от них можно, но осознанно.
class DefectPackageScreen extends StatefulWidget {
  const DefectPackageScreen({super.key});

  @override
  State<DefectPackageScreen> createState() => _DefectPackageScreenState();
}

class _DefectPackageScreenState extends State<DefectPackageScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  final Set<String> _selected = {};
  bool _initialised = false;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c42.title')),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          key: _key,
          load: () => session.api.acts(),
          builder: (context, data, reload) {
            final acts = ((data['acts'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final act = acts.where((a) => (a['pending'] as num? ?? 0) > 0).firstOrNull ?? acts.firstOrNull;
            if (act == null) {
              return EmptyState(icon: 'clipboard', text: (data['empty'] as String?) ?? t('c42.empty'));
            }
            final items = ((act['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final pending = items.where((i) => i['decision'] == 'pending').toList();

            // Критичные отмечаем по умолчанию: пропустить их молча нельзя
            if (!_initialised) {
              _initialised = true;
              _selected.addAll(pending.where((i) => i['severity'] == 'high').map((i) => i['id'] as String));
            }
            final selectedSum = pending
                .where((i) => _selected.contains(i['id']))
                .fold<int>(0, (s, i) => s + ((i['estimateTiyin'] as num?)?.toInt() ?? 0));

            return Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      SozoCard(
                        children: [
                          Text(
                            '${act['locationName']} · ${act['number']}',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                          ),
                          Text(
                            t('c42.summary', {
                              'n': plural(items.length, 'дефект', 'дефекта', 'дефектов'),
                              'sum': soums(act['totalTiyin']),
                            }),
                            style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                          ),
                          Text(
                            t('c42.master', {'name': act['masterName'] ?? ''}),
                            style: const TextStyle(fontSize: 12, color: SozoColors.textTertiary),
                          ),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s12),

                      // Чек-лист обхода: что смотрели и где не в порядке
                      if (((act['checklist'] as List?) ?? const []).isNotEmpty)
                        SozoCard(
                          children: [
                            CardTitle(t('c42.checklist')),
                            for (final z in ((act['checklist'] as List?) ?? const []).cast<Map<String, dynamic>>())
                              Row(
                                children: [
                                  FigmaIcon(
                                    z['ok'] == true ? 'check-done' : 'alert-circle',
                                    size: 16,
                                    color: z['ok'] == true ? SozoColors.success : SozoColors.warning,
                                  ),
                                  const SizedBox(width: SozoSpace.s8),
                                  Expanded(
                                    child: Text(
                                      [z['zone'], z['note']].where((v) => (v as String?)?.isNotEmpty ?? false).join(' — '),
                                      style: const TextStyle(fontSize: 13, color: SozoColors.text),
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      const SizedBox(height: SozoSpace.s16),

                      SectionHeading(t('c42.defects')),
                      const SizedBox(height: SozoSpace.s8),
                      for (final d in items) _defect(d, pending.contains(d)),
                    ],
                  ),
                ),
                StickyFooter(
                  children: [
                    MoneyRow(
                      label: t('c42.selected', {'n': _selected.length}),
                      amount: soums(selectedSum),
                      bold: true,
                    ),
                    PrimaryButton(
                      t('c42.approve'),
                      busy: _busy,
                      onTap: _selected.isEmpty ? null : () => _send(act['id'] as String, pending, reload),
                    ),
                    DangerTextButton(
                      t('c42.declineRest'),
                      onTap: _busy ? null : () => _declineRest(act['id'] as String, pending, reload),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _defect(Map<String, dynamic> d, bool decidable) {
    final id = d['id'] as String;
    final high = d['severity'] == 'high';
    final decided = d['decision'] != 'pending';
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
      child: SozoCard(
        onTap: decidable && !decided
            ? () => setState(() => _selected.contains(id) ? _selected.remove(id) : _selected.add(id))
            : null,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (decidable && !decided)
                Container(
                  width: 22,
                  height: 22,
                  margin: const EdgeInsets.only(top: 2),
                  decoration: BoxDecoration(
                    color: _selected.contains(id) ? SozoColors.accent : SozoColors.surface,
                    borderRadius: BorderRadius.circular(SozoRadius.s4 + 2),
                    border: Border.all(
                      color: _selected.contains(id) ? SozoColors.accent : SozoColors.border,
                      width: 1.5,
                    ),
                  ),
                  child: _selected.contains(id)
                      ? const Center(child: FigmaIcon('check-12', size: 12, color: SozoColors.onAccent))
                      : null,
                )
              else
                FigmaIcon(
                  d['decision'] == 'accepted' ? 'check-done' : 'circle-x',
                  size: 20,
                  color: d['decision'] == 'accepted' ? SozoColors.success : SozoColors.textTertiary,
                ),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (d['description'] as String?) ?? '',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                    ),
                    const SizedBox(height: SozoSpace.s4),
                    // Wrap: важность и категория дефекта вместе не помещались
                    Wrap(
                      spacing: SozoSpace.s4,
                      runSpacing: SozoSpace.s4,
                      children: [
                        TagChip(
                          high ? t('c37.high') : (d['severity'] == 'medium' ? t('c37.medium') : t('c37.low')),
                          bg: high ? softDangerBg : SozoColors.chipGrey,
                          fg: high ? softDangerFg : SozoColors.textSecondary,
                        ),
                        TagChip((d['category'] as String?) ?? ''),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s8),
              Text(
                d['estimateTiyin'] == null ? t('c37.needsEstimate') : soums(d['estimateTiyin']),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: SozoColors.text,
                  fontFeatures: moneyFeatures,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _send(String actId, List<Map<String, dynamic>> pending, Future<void> Function() reload) async {
    setState(() => _busy = true);
    try {
      final r = await session.api.decideAct(actId, {
        'accepted': _selected.toList(),
        'declined': pending.map((i) => i['id'] as String).where((id) => !_selected.contains(id)).toList(),
        'declineReason': 'Отложено руководителем',
      });
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      _selected.clear();
      _initialised = false;
      await reload();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _declineRest(String actId, List<Map<String, dynamic>> pending, Future<void> Function() reload) async {
    final ok = await showSozoConfirm(
      context,
      title: t('c42.declineTitle'),
      text: t('c42.declineText'),
      confirmLabel: t('c36.decline'),
      cancelLabel: t('c15.declineBack'),
      danger: true,
    );
    if (!ok) return;
    setState(() => _selected.clear());
    await _send(actId, pending, reload);
  }
}

/// C-43. Техдолг организации (фаза 2) — разрез по точкам.
class OrgDebtScreen extends StatelessWidget {
  const OrgDebtScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final orgId = session.currentContext?['organizationId'] as String?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c43.title')),
      body: SafeArea(
        child: orgId == null
            ? EmptyState(icon: 'clipboard', text: t('c31.noContext'))
            : AsyncView<Map<String, dynamic>>(
                load: () => session.api.orgDebt(orgId),
                builder: (context, data, reload) {
                  final locations = ((data['locations'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  final by = (data['bySeverity'] as Map<String, dynamic>?) ?? const {};
                  final total = (data['totalTiyin'] as num?)?.toInt() ?? 0;
                  if (total == 0) {
                    return EmptyState(icon: 'check-done', text: (data['empty'] as String?) ?? t('c43.empty'));
                  }
                  return ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      SozoCard(
                        children: [
                          Text(
                            soums(total),
                            style: const TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w700,
                              color: SozoColors.text,
                              fontFeatures: moneyFeatures,
                            ),
                          ),
                          const SozoDivider(),
                          MoneyRow(label: t('c37.high'), amount: soums(by['high']), color: SozoColors.error),
                          MoneyRow(label: t('c37.medium'), amount: soums(by['medium'])),
                          MoneyRow(label: t('c37.low'), amount: soums(by['low'])),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s16),
                      SectionHeading(t('c43.byLocation')),
                      const SizedBox(height: SozoSpace.s8),
                      for (final l in locations) ...[
                        SozoCard(
                          onTap: () async {
                            await session.setContext(l['id'] as String, remember: session.rememberContext);
                            if (!context.mounted) return;
                            await Navigator.of(context).push(
                              MaterialPageRoute<void>(builder: (_) => DebtScreen(locationId: l['id'] as String)),
                            );
                            await reload();
                          },
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    (l['name'] as String?) ?? '',
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                                  ),
                                ),
                                Text(
                                  soums(l['totalTiyin']),
                                  style: const TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: SozoColors.text,
                                    fontFeatures: moneyFeatures,
                                  ),
                                ),
                              ],
                            ),
                            Text(
                              t('c43.count', {'n': plural((l['count'] as num?)?.toInt() ?? 0, 'дефект', 'дефекта', 'дефектов')}),
                              style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                            ),
                            // Старше 60 дней — отдельной строкой: это уже риск, а не список
                            if (((l['olderThan60'] as num?)?.toInt() ?? 0) > 0)
                              SozoBanner(
                                icon: 'clock',
                                tone: BannerTone.danger,
                                text: t('c43.old', {
                                  'n': plural((l['olderThan60'] as num?)?.toInt() ?? 0, 'дефект', 'дефекта', 'дефектов'),
                                  'sum': soums(l['olderThan60Tiyin']),
                                }),
                              ),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s12),
                      ],
                      SecondaryButton(
                        t('c43.package'),
                        icon: 'clipboard',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(builder: (_) => const DefectPackageScreen()),
                        ),
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }
}

/// C-46. График осмотров (фаза 2).
class InspectionsScreen extends StatelessWidget {
  const InspectionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final orgId = session.currentContext?['organizationId'] as String?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c46.title')),
      body: SafeArea(
        child: orgId == null
            ? EmptyState(icon: 'calendar', text: t('c31.noContext'))
            : AsyncView<Map<String, dynamic>>(
                load: () => session.api.inspections(orgId),
                builder: (context, data, reload) {
                  final upcoming = ((data['upcoming'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  final history = ((data['history'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  if (upcoming.isEmpty && history.isEmpty) {
                    return EmptyState(icon: 'calendar', text: (data['empty'] as String?) ?? t('c46.empty'));
                  }
                  return ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      if (data['suspended'] == true) ...[
                        SozoBanner(icon: 'alert-triangle', tone: BannerTone.warn, text: t('c46.suspended')),
                        const SizedBox(height: SozoSpace.s12),
                      ],
                      SectionHeading(t('c46.upcoming')),
                      const SizedBox(height: SozoSpace.s8),
                      for (final u in upcoming) ...[
                        SozoCard(
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    (u['locationName'] as String?) ?? '',
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                                  ),
                                ),
                                if (u['overdue'] == true)
                                  TagChip(t('c46.overdue'), bg: softDangerBg, fg: softDangerFg),
                              ],
                            ),
                            MoneyRow(
                              label: dayMonth(u['nextAt']),
                              sub: (u['periodicity'] as String?) ?? '',
                              amount: '',
                            ),
                            if (u['lastAt'] != null)
                              Text(
                                t('c46.last', {
                                  'date': dayMonth(u['lastAt']),
                                  'n': plural((u['lastDefects'] as num?)?.toInt() ?? 0, 'дефект', 'дефекта', 'дефектов'),
                                }),
                                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                              ),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s12),
                      ],
                      if (history.isNotEmpty) ...[
                        const SizedBox(height: SozoSpace.s8),
                        SectionHeading(t('c46.history')),
                        const SizedBox(height: SozoSpace.s8),
                        for (final h in history)
                          SozoCard(
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(builder: (_) => const DefectPackageScreen()),
                            ),
                            children: [
                              Row(
                                children: [
                                  const FigmaIcon('clipboard', size: 18, color: SozoColors.textSecondary),
                                  const SizedBox(width: SozoSpace.s12),
                                  Expanded(
                                    child: Text(
                                      '${h['locationName']} · ${h['number']}',
                                      style: const TextStyle(fontSize: 14, color: SozoColors.text),
                                    ),
                                  ),
                                  const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                                ],
                              ),
                              Text(
                                t('c46.found', {
                                  'date': dayMonth(h['at']),
                                  'n': plural((h['defects'] as num?)?.toInt() ?? 0, 'дефект', 'дефекта', 'дефектов'),
                                }),
                                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                              ),
                            ],
                          ),
                      ],
                      const SizedBox(height: SozoSpace.s16),
                      SozoBanner(icon: 'info', text: t('c46.note')),
                    ],
                  );
                },
              ),
      ),
    );
  }
}

/// C-48. Дашборд владельца (фаза 2) — только наблюдение.
///
/// Ни одной операционной кнопки: владелец смотрит, а не управляет. Поэтому
/// экран переиспользует блоки руководителя организации, но без действий.
class OwnerDashboardScreen extends StatelessWidget {
  const OwnerDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final orgId = session.currentContext?['organizationId'] as String?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c48.title')),
      body: SafeArea(
        child: orgId == null
            ? EmptyState(icon: 'shield', text: t('c31.noContext'))
            : AsyncView<Map<String, dynamic>>(
                load: () => session.api.orgDashboard(orgId),
                builder: (context, data, reload) {
                  final tiles = ((data['tiles'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  final s = (data['summary'] as Map<String, dynamic>?) ?? const {};
                  final pending = (s['pendingApproval'] as num?)?.toInt() ?? 0;
                  return ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      SozoBanner(icon: 'shield', text: t('c48.readOnly')),
                      const SizedBox(height: SozoSpace.s12),

                      // Второе утверждение — единственное, где владелец действует;
                      // при выключенной опции договора карточки нет вовсе
                      if (pending > 0) ...[
                        SozoCard(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(builder: (_) => const ApprovalsInboxScreen(asTab: false)),
                          ),
                          children: [
                            Row(
                              children: [
                                const FigmaIcon('hourglass', size: 20, color: softWarnFg),
                                const SizedBox(width: SozoSpace.s12),
                                Expanded(
                                  child: Text(
                                    t('c48.secondApproval', {'n': pending}),
                                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.text),
                                  ),
                                ),
                                const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s12),
                      ],

                      SozoCard(
                        children: [
                          MoneyRow(label: t('c40.subscription'), amount: soums(s['subscriptionTiyin'])),
                          MoneyRow(
                            label: t('c40.unpaid'),
                            amount: soums(s['unpaidTiyin']),
                            color: (s['unpaidTiyin'] as num? ?? 0) > 0 ? SozoColors.error : null,
                          ),
                          MoneyRow(label: t('c40.techDebt'), amount: soums(s['techDebtTiyin'])),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s24),
                      SectionHeading(t('c40.sites')),
                      const SizedBox(height: SozoSpace.s12),
                      for (final tile in tiles) ...[
                        SozoCard(
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 10,
                                  height: 10,
                                  decoration: BoxDecoration(
                                    color: switch (tile['state']) {
                                      'error' => SozoColors.error,
                                      'warning' => SozoColors.warning,
                                      _ => SozoColors.success,
                                    },
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: SozoSpace.s8),
                                Expanded(
                                  child: Text(
                                    (tile['name'] as String?) ?? '',
                                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                                  ),
                                ),
                              ],
                            ),
                            Text(
                              (tile['label'] as String?) ?? '',
                              style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                            ),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s12),
                      ],
                      const SizedBox(height: SozoSpace.s8),
                      SecondaryButton(
                        t('c47.title'),
                        icon: 'line-chart',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(builder: (_) => const ReportsScreen(asTab: false)),
                        ),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                      SecondaryButton(
                        t('c44.title'),
                        icon: 'credit-card',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(builder: (_) => const OrgFinanceScreen(asTab: false)),
                        ),
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }
}
