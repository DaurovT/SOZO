import 'package:flutter/material.dart';

import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../shell.dart';

/// C-37. Техдолг точки — дефекты из актов осмотра, по которым решения нет.
///
/// Возраст показан явно: дефект, который лежит третий месяц, — это не «список»,
/// а риск аварии, и он должен раздражать глаз.
class DebtScreen extends StatelessWidget {
  const DebtScreen({super.key, required this.locationId, this.asTab = false});

  final String locationId;
  final bool asTab;

  @override
  Widget build(BuildContext context) {
    final body = AsyncView<Map<String, dynamic>>(
      load: () => session.api.siteDebt(locationId),
      builder: (context, data, reload) {
        final items = ((data['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
        if (items.isEmpty) {
          return EmptyState(icon: 'check-done', text: (data['empty'] as String?) ?? t('c37.empty'));
        }
        final by = (data['bySeverity'] as Map<String, dynamic>?) ?? const {};
        return ListView(
          padding: const EdgeInsets.all(SozoSpace.s16),
          children: [
            SozoCard(
              children: [
                Text(
                  soums(data['totalTiyin']),
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
            for (final d in items) ...[
              SozoCard(
                children: [
                  Row(
                    children: [
                      TagChip(
                        _severity(d['severity'] as String?),
                        bg: d['severity'] == 'high' ? softDangerBg : SozoColors.chipGrey,
                        fg: d['severity'] == 'high' ? softDangerFg : SozoColors.textSecondary,
                      ),
                      const Spacer(),
                      Text(
                        (d['actNumber'] as String?) ?? '',
                        style: const TextStyle(fontSize: 12, color: SozoColors.textTertiary),
                      ),
                    ],
                  ),
                  Text(
                    (d['description'] as String?) ?? '',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                  ),
                  MoneyRow(
                    label: (d['category'] as String?) ?? '',
                    amount: d['estimateTiyin'] == null ? t('c37.needsEstimate') : soums(d['estimateTiyin']),
                  ),
                  Text(
                    // Дефект старше 60 дней — отдельная подсветка (DEV-08 C-37)
                    t('c37.age', {'days': plural((d['ageDays'] as num?)?.toInt() ?? 0, 'plural.days')}),
                    style: TextStyle(
                      fontSize: 12,
                      color: ((d['ageDays'] as num?) ?? 0) > 60 ? SozoColors.error : SozoColors.textSecondary,
                    ),
                  ),
                  if (d['declined'] == true)
                    SozoBanner(
                      icon: 'circle-x',
                      text: t('c37.declined', {'reason': d['declineReason'] ?? ''}),
                    ),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),
            ],
          ],
        );
      },
    );
    if (asTab) return TabScaffold(title: t('c37.title'), child: body);
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c37.title')),
      body: SafeArea(child: body),
    );
  }

  static String _severity(String? s) => switch (s) {
        'high' => t('c37.high'),
        'medium' => t('c37.medium'),
        _ => t('c37.low'),
      };
}

/// C-38. Лимиты и доступ точки.
class LimitsScreen extends StatelessWidget {
  const LimitsScreen({super.key, required this.locationId, this.asTab = false});

  final String locationId;
  final bool asTab;

  @override
  Widget build(BuildContext context) {
    final body = AsyncView<Map<String, dynamic>>(
      load: () => session.api.siteLimits(locationId),
      builder: (context, data, reload) {
        final spent = (data['monthSpentTiyin'] as num?)?.toInt() ?? 0;
        final monthly = (data['monthlyLimitTiyin'] as num?)?.toInt() ?? 0;
        final ratio = monthly == 0 ? 0.0 : (spent / monthly).clamp(0.0, 1.0);
        final access = (data['access'] as Map<String, dynamic>?) ?? const {};
        final passport = (data['passport'] as Map<String, dynamic>?) ?? const {};

        return ListView(
          padding: const EdgeInsets.all(SozoSpace.s16),
          children: [
            SozoCard(
              children: [
                CardTitle(t('c38.limits')),
                MoneyRow(label: t('c38.perOrder'), amount: soums(data['orderLimitTiyin'])),
                MoneyRow(label: t('c38.month'), amount: '${soums(spent, withUnit: false)} / ${soums(monthly)}'),
                ClipRRect(
                  borderRadius: BorderRadius.circular(SozoRadius.badge),
                  child: LinearProgressIndicator(
                    value: ratio,
                    minHeight: 8,
                    backgroundColor: trackGrey,
                    valueColor: AlwaysStoppedAnimation(ratio > 0.9 ? SozoColors.warning : SozoColors.accent),
                  ),
                ),
                if (ratio >= 1)
                  SozoBanner(icon: 'alert-triangle', tone: BannerTone.warn, text: t('c38.exhausted')),
                // null у руководителя организации значит «без потолка», а не
                // «неизвестно»: прочерк на этом месте читался как пустое поле
                MoneyRow(
                  label: t('c38.myApproval'),
                  amount: data['myApprovalLimitTiyin'] == null
                      ? t('c38.noLimit')
                      : soums(data['myApprovalLimitTiyin']),
                ),
                Text(
                  (data['note'] as String?) ?? '',
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s12),
            SozoCard(
              children: [
                CardTitle(t('c38.access')),
                _row(t('c38.schedule'), access['schedule'] as String?),
                _row(t('c38.notes'), access['accessNotes'] as String?),
                _row(t('c38.hoa'), access['hoaContact'] as String?),
              ],
            ),
            const SizedBox(height: SozoSpace.s12),
            SozoCard(
              children: [
                CardTitle(t('c38.passport')),
                _row(t('c38.area'), passport['areaM2']?.toString()),
                _row(t('c38.objectType'), passport['objectType'] as String?),
                _row(t('c38.acUnits'), passport['acUnits']?.toString()),
                _row(t('c38.panels'), passport['electricPanels']?.toString()),
              ],
            ),

            // Отчёт и журнал ТО по точке (F-54): их спрашивают арендодатель,
            // проверяющие и собственный бухгалтер — нужен печатный вид
            if (data['organizationId'] != null) ...[
              const SizedBox(height: SozoSpace.s12),
              SecondaryButton(
                t('c44.locationReport'),
                icon: 'file-text',
                onTap: () => openDocument(
                  context,
                  session.api.documentUrl(
                    '/documents/organizations/${data['organizationId']}/locations/$locationId/report',
                  ),
                ),
              ),
              const SizedBox(height: SozoSpace.s8),
              TextAction(
                t('c44.maintenanceLog'),
                onTap: () => openDocument(
                  context,
                  session.api.documentUrl(
                    '/documents/organizations/${data['organizationId']}/locations/$locationId/maintenance-log',
                  ),
                ),
              ),
            ],
          ],
        );
      },
    );
    if (asTab) return TabScaffold(title: t('c38.title'), child: body);
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c38.title')),
      body: SafeArea(child: body),
    );
  }

  Widget _row(String label, String? value) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(label, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
          ),
          const SizedBox(width: SozoSpace.s8),
          Expanded(
            child: Text(
              value?.trim().isNotEmpty == true ? value! : '—',
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 14, color: SozoColors.text),
            ),
          ),
        ],
      );
}

/// C-39 / C-47. Отчёты точки и организации — одна композиция, разный разрез.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key, this.locationId, this.asTab = true});

  /// null — разрез по всей организации
  final String? locationId;
  final bool asTab;

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  late String? _locationId = widget.locationId;

  @override
  Widget build(BuildContext context) {
    final body = AsyncView<Map<String, dynamic>>(
      key: _key,
      load: () => session.api.reports(locationId: _locationId),
      builder: (context, data, reload) {
        final months = ((data['months'] as List?) ?? const []).cast<Map<String, dynamic>>();
        final locations = ((data['locations'] as List?) ?? const []).cast<Map<String, dynamic>>();
        return ListView(
          padding: const EdgeInsets.all(SozoSpace.s16),
          children: [
            if (locations.length > 1) ...[
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: locations.length + 1,
                  separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
                  itemBuilder: (context, i) {
                    if (i == 0) {
                      return SozoChip(
                        t('c47.wholeOrg'),
                        selected: _locationId == null,
                        onTap: () {
                          setState(() => _locationId = null);
                          _key.currentState?.reload();
                        },
                      );
                    }
                    final l = locations[i - 1];
                    return SozoChip(
                      (l['name'] as String?) ?? '',
                      selected: _locationId == l['id'],
                      onTap: () {
                        setState(() => _locationId = l['id'] as String?);
                        _key.currentState?.reload();
                      },
                    );
                  },
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
            ],
            if (months.isEmpty)
              EmptyState(icon: 'file-text', text: (data['empty'] as String?) ?? t('c39.empty'))
            else
              for (final m in months) ...[
                SozoCard(
                  children: [
                    CardTitle(_monthTitle(m['month'] as String?)),
                    MoneyRow(
                      label: t('c39.orders'),
                      sub: t('c39.emergencies', {'n': m['emergencies']}),
                      amount: '${m['ordersTotal']}',
                    ),
                    MoneyRow(label: t('c39.works'), amount: soums(m['worksTiyin'])),
                    MoneyRow(label: t('c39.materials'), amount: soums(m['materialsTiyin'])),
                    MoneyRow(label: t('c39.closed'), amount: '${m['closed']}'),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],
            if ((data['techDebtTiyin'] as num? ?? 0) > 0)
              SozoCard(
                children: [
                  MoneyRow(label: t('c39.techDebt'), amount: soums(data['techDebtTiyin']), bold: true),
                ],
              ),
            const SizedBox(height: SozoSpace.s16),
            // PDF собирает модуль документов; кнопка появится вместе с ним
            SozoBanner(icon: 'file-text', text: t('c39.pdfSoon')),
          ],
        );
      },
    );
    if (widget.asTab) return TabScaffold(title: t('c39.title'), child: body);
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c39.title')),
      body: SafeArea(child: body),
    );
  }

  static const _months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];

  String _monthTitle(String? ym) {
    if (ym == null || ym.length < 7) return '—';
    final m = int.tryParse(ym.substring(5, 7)) ?? 1;
    return '${_months[(m - 1).clamp(0, 11)]} ${ym.substring(0, 4)}';
  }
}
