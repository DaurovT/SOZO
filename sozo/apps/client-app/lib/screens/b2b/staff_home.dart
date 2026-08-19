import 'package:flutter/material.dart';

import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../../widgets/figma_icon.dart';
import '../../widgets/order_card.dart';
import '../order_screen.dart';
import '../shell.dart';
import 'acceptance_screen.dart';
import 'org_screens.dart';
import 'phase2_screens.dart';
import 'site_screens.dart';
import 'points_screen.dart';
import 'report_screen.dart';

/// C-31 / C-35. Главный экран точки.
///
/// Сотрудник и руководитель точки видят один экран с разным наполнением:
/// суммы вырезает сервер по настройке договора, а не виджет — иначе они всё
/// равно уедут в приложение.
class SiteHomeScreen extends StatefulWidget {
  const SiteHomeScreen({super.key, this.showFilters = false, this.fixedFilter, this.titleKey});

  /// Лента заявок руководителя точки — с фильтрами по статусу (C-35)
  final bool showFilters;

  /// Жёсткий фильтр без переключателя: так же устроен экран «Мои обращения»
  /// сотрудника — на большой точке своя заявка теряется среди чужих
  final String? fixedFilter;

  /// Свой заголовок вкладки: тот же экран под другой задачей
  final String? titleKey;

  @override
  State<SiteHomeScreen> createState() => _SiteHomeScreenState();
}

class _SiteHomeScreenState extends State<SiteHomeScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  late String _filter = widget.fixedFilter ?? 'all';

  static const _filters = [
    ('all', 'c24.all'),
    ('active', 'c24.active'),
    ('approval', 'c35.approval'),
    ('closed', 'c24.closed'),
  ];

  String? get _locationId => session.contextId;

  @override
  Widget build(BuildContext context) {
    final locationId = _locationId;
    if (locationId == null) {
      return TabScaffold(
        title: t('tab.home'),
        child: EmptyState(icon: 'shopping-bag', text: t('c31.noContext')),
      );
    }
    return TabScaffold(
      title: widget.titleKey != null
          ? t(widget.titleKey!)
          : (session.currentContext?['title'] as String?) ?? t('tab.home'),
      switchable: widget.titleKey == null,
      child: AsyncView<Map<String, dynamic>>(
        key: _key,
        load: () => session.api.site(locationId, filter: _filter == 'all' ? null : _filter),
        builder: (context, data, reload) => _content(context, data, reload),
      ),
    );
  }

  Widget _content(BuildContext context, Map<String, dynamic> data, Future<void> Function() reload) {
    final orders = ((data['orders'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final awaiting = ((data['awaitingAcceptance'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final showMoney = data['showMoney'] == true;
    final loyalty = (data['loyalty'] as Map<String, dynamic>?) ?? const {};
    final limits = (data['limits'] as Map<String, dynamic>?) ?? const {};
    final org = (data['organization'] as Map<String, dynamic>?) ?? const {};
    final suspended = org['status'] != null && org['status'] != 'active';

    return ListView(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s32),
      children: [
        if (suspended) ...[
          SozoBanner(
            icon: 'alert-triangle',
            tone: BannerTone.danger,
            title: t('c40.suspendedTitle'),
            text: t('c40.suspendedText'),
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        // Мастер закончил — нужен код приёмки (C-34)
        for (final o in awaiting) ...[
          SozoBanner(
            icon: 'check-done',
            tone: BannerTone.info,
            title: t('c31.acceptTitle'),
            text: '${o['number']} · ${o['address']}',
            actionLabel: t('c31.acceptOpen'),
            onAction: () async {
              await Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => AcceptanceScreen(orderId: o['id'] as String)),
              );
              await reload();
            },
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        PrimaryButton(
          t('c31.report'),
          icon: 'alert-triangle',
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => ReportScreen(locationId: _locationId!)),
            );
            await reload();
          },
        ),
        const SizedBox(height: SozoSpace.s12),

        SozoBanner(
          icon: 'alert-circle',
          tone: BannerTone.danger,
          title: t('c31.emergencyTitle'),
          text: t('c31.emergencyText'),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => EmergencyGuideScreen(locationId: _locationId!)),
          ),
        ),

        if (loyalty['enabled'] == true) ...[
          const SizedBox(height: SozoSpace.s12),
          SozoCard(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const PointsScreen()),
            ),
            children: [
              Row(
                children: [
                  const FigmaIcon('star', size: 20, color: SozoColors.accent),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Text(
                      t('c31.points'),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                    ),
                  ),
                  Text(
                    soums(loyalty['balanceTiyin']),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.text, fontFeatures: moneyFeatures),
                  ),
                  const SizedBox(width: SozoSpace.s4),
                  const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                ],
              ),
            ],
          ),
        ],

        if (showMoney && limits['monthlyLimitTiyin'] != null) ...[
          const SizedBox(height: SozoSpace.s12),
          _limitBar(limits),
        ],

        // Разделы точки: заходят в них редко, вкладку они не окупают,
        // но и прятать в профиль неправильно — это про точку, а не про меня
        const SizedBox(height: SozoSpace.s16),
        SozoCard(
          gap: 0,
          children: [
            NavRow(
              icon: 'clipboard',
              title: t('c37.title'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => DebtScreen(locationId: _locationId!)),
              ),
            ),
            const SozoDivider(),
            NavRow(
              icon: 'shield',
              title: t('c38.title'),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => LimitsScreen(locationId: _locationId!)),
              ),
            ),
            if (session.role != 'staff') ...[
              const SozoDivider(),
              NavRow(
                icon: 'calendar',
                title: t('c42.title'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const DefectPackageScreen()),
                ),
              ),
              const SozoDivider(),
              // Руководитель точки заводит людей и выдаёт коды приглашений —
              // сервер ему это разрешает. Экран же лежал только на дашборде
              // организации, которого у него во вкладках нет: право было,
              // входа не было
              NavRow(
                icon: 'users',
                title: t('c45.title'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const OrgUsersScreen()),
                ),
              ),
            ],
          ],
        ),

        const SizedBox(height: SozoSpace.s24),
        SectionHeading(t('c31.orders')),
        const SizedBox(height: SozoSpace.s8),

        if (widget.showFilters) ...[
          SizedBox(
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: SozoSpace.s8),
              itemBuilder: (context, i) => SozoChip(
                t(_filters[i].$2),
                selected: _filter == _filters[i].$1,
                onTap: () {
                  setState(() => _filter = _filters[i].$1);
                  _key.currentState?.reload();
                },
              ),
            ),
          ),
          const SizedBox(height: SozoSpace.s8),
        ],

        if (orders.isEmpty)
          SozoCard(
            children: [
              Text(
                (data['empty'] as String?) ?? t('c31.empty'),
                style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
              ),
            ],
          )
        else
          for (final o in orders) ...[
            OrderCard(
              order: o,
              showMoney: showMoney,
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: o['id'] as String)),
                );
                await reload();
              },
            ),
            const SizedBox(height: SozoSpace.s12),
          ],
      ],
    );
  }

  /// Расход месяца: при >90% полоса становится предупреждающей — лимит
  /// исчерпан значит «все заявки уходят на утверждение», это стоит увидеть заранее
  Widget _limitBar(Map<String, dynamic> limits) {
    final spent = (limits['monthSpentTiyin'] as num?)?.toInt() ?? 0;
    final total = (limits['monthlyLimitTiyin'] as num?)?.toInt() ?? 0;
    final ratio = total == 0 ? 0.0 : (spent / total).clamp(0.0, 1.0);
    final warn = ratio > 0.9;
    return SozoCard(
      children: [
        MoneyRow(
          label: t('c38.month'),
          amount: '${soums(spent, withUnit: false)} / ${soums(total)}',
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(SozoRadius.badge),
          child: LinearProgressIndicator(
            value: ratio,
            minHeight: 8,
            backgroundColor: trackGrey,
            valueColor: AlwaysStoppedAnimation(warn ? SozoColors.warning : SozoColors.accent),
          ),
        ),
        if (warn)
          Text(
            t('c38.limitWarn'),
            style: const TextStyle(fontSize: 12, color: softWarnFg),
          ),
      ],
    );
  }
}
