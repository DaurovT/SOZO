import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'address_details_screen.dart';
import 'addresses_screen.dart';
import 'b2b/acceptance_screen.dart';
import 'b2b/approvals_inbox.dart';
import 'b2b/org_screens.dart';
import 'b2b/phase2_screens.dart';
import 'b2b/points_screen.dart';
import 'b2b/report_screen.dart';
import 'b2b/site_screens.dart';
import 'b2b/staff_home.dart';
import 'complaints_screen.dart';
import 'consents_screen.dart';
import 'context_screen.dart';
import 'create/wizard.dart';
import 'decisions_screen.dart';
import 'dispute_screen.dart';
import 'equipment_screen.dart';
import 'finish_screens.dart';
import 'order_screen.dart';
import 'warranty_screen.dart';

/// Витрина экранов — инструмент показа и приёмки, не часть продукта.
///
/// Половина экранов достижима только в редком состоянии заявки: смету видно,
/// пока мастер её прислал, приёмку — пока работа не принята. Проверять их,
/// подгоняя данные, — час на экран. Отсюда открывается любой напрямую.
class ShowcaseScreen extends StatelessWidget {
  const ShowcaseScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('showcase.title')),
      body: SafeArea(
        child: AsyncView<_Data>(
          load: _load,
          builder: (context, data, reload) => _list(context, data, reload),
        ),
      ),
    );
  }

  static Future<_Data> _load() async {
    final orders = await session.api.orders();
    final list = ((orders['orders'] as List?) ?? const []).cast<Map<String, dynamic>>();
    Map<String, dynamic>? pick(bool Function(Map<String, dynamic>) test) =>
        list.where(test).firstOrNull;
    return _Data(
      orders: list,
      active: pick((o) => ['assigned', 'master_departed', 'in_progress'].contains(o['status'])),
      needsDecision: pick((o) => o['needsDecision'] == true),
      completed: pick((o) => o['status'] == 'completed'),
      closed: pick((o) => ['closed', 'rated'].contains(o['status'])),
      dispute: pick((o) => o['status'] == 'dispute'),
    );
  }

  Widget _list(BuildContext context, _Data d, Future<void> Function() reload) {
    // Экранам решений нужна полная карточка, а не строка списка
    Future<void> openDecision(BuildContext context, DecisionKind kind) async {
      final id = (d.needsDecision ?? d.active)?['id'] as String?;
      if (id == null) return _noData(context);
      final order = await session.api.order(id);
      if (!context.mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => DecisionScreen(order: order, kind: kind)),
      );
    }

    Future<void> openFull(BuildContext context, String? id, Widget Function(Map<String, dynamic>) build) async {
      if (id == null) return _noData(context);
      final order = await session.api.order(id);
      if (!context.mounted) return;
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => build(order)));
    }

    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: [
        SozoBanner(icon: 'info', text: t('showcase.note')),
        const SizedBox(height: SozoSpace.s12),
        _DemoSeedCard(onDone: reload),
        const SizedBox(height: SozoSpace.s16),

        _group(t('showcase.entry'), [
          _row('C-04', t('c04.title'), () => const ConsentsScreen()),
          _row('C-05', t('c05.title'), () => const ContextScreen()),
        ]),
        _group(t('showcase.b2c'), [
          _row('C-07…13', t('showcase.wizard'), () => const CreateOrderFlow()),
          _row('C-07', t('showcase.wizardEmergency'), () => const CreateOrderFlow(emergency: true)),
          _rowAsync('C-14', t('c14.works'), () async {
            final id = (d.active ?? d.orders.firstOrNull)?['id'] as String?;
            if (id == null) return _noData(context);
            if (!context.mounted) return;
            await Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: id)),
            );
          }),
          _rowAsync('C-50', t('c50.title'), () => openFull(context, (d.active ?? d.orders.firstOrNull)?['id'] as String?, (o) => AddressDetailsScreen(order: o))),
          _rowAsync('C-15', t('c15.title'), () => openDecision(context, DecisionKind.estimate)),
          _rowAsync('C-15', t('c15.tierTitle'), () => openDecision(context, DecisionKind.spareTier)),
          _rowAsync('C-16', t('c16.title'), () => openDecision(context, DecisionKind.addwork)),
          _rowAsync('C-17', t('c17.title'), () => openDecision(context, DecisionKind.recommendation)),
          _rowAsync('C-18', t('c18.title'), () => openDecision(context, DecisionKind.stages)),
          _rowAsync('C-19', t('c19.title'), () {
            final id = (d.completed ?? d.closed)?['id'] as String?;
            return openFull(context, id, (o) => Scaffold(
                  backgroundColor: SozoColors.bg,
                  body: SafeArea(child: FinishScreenBody(order: o, reload: () async {})),
                ));
          }),
          _rowAsync('C-20', t('c20.title'), () {
            final id = (d.completed ?? d.closed)?['id'] as String?;
            return openFull(context, id, (o) => PaymentScreen(
                  order: o,
                  totalTiyin: ((o['totalFromTiyin'] as num?)?.toInt() ?? 0) +
                      ((o['totalMaterialTiyin'] as num?)?.toInt() ?? 0),
                ));
          }),
          _rowAsync('C-21', t('c21.title'), () => openFull(context, (d.completed ?? d.closed)?['id'] as String?, (o) => ThanksScreen(order: o))),
          _rowAsync('C-22', t('c22.title'), () => openFull(context, (d.closed ?? d.dispute)?['id'] as String?, (o) => DisputeScreen(order: o))),
          _row('C-23', t('c23.title'), () => const ComplaintsScreen()),
          _rowAsync('C-25', t('showcase.closedOrder'), () {
            final id = d.closed?['id'] as String?;
            return openFull(context, id, (o) => Scaffold(
                  backgroundColor: SozoColors.bg,
                  body: SafeArea(child: FinishScreenBody(order: o, reload: () async {})),
                ));
          }),
          _rowAsync('C-26', t('c26.title'), () => openFull(context, d.closed?['id'] as String?, (o) => WarrantyScreen(order: o))),
          _rowAsync('C-27', t('showcase.howAreThings'), () => openFull(context, d.closed?['id'] as String?, (o) => HowAreThingsScreen(order: o))),
          _row('C-29', t('c29.title'), () => const AddressesScreen()),
          _row('C-28', t('c28.title'), () => const EquipmentScreen()),
        ]),
        _group(t('showcase.site'), [
          _row('C-31', t('showcase.staffHome'), () => const SiteHomeScreen()),
          _row('C-35', t('showcase.siteOrders'), () => const SiteHomeScreen(showFilters: true)),
          _rowContext('C-32', t('c32.title'), (loc) => ReportScreen(locationId: loc)),
          _rowContext('C-33', t('c33.title'), (loc) => EmergencyGuideScreen(locationId: loc)),
          _rowAsync('C-34', t('c34.title'), () async {
            final id = (d.completed ?? d.orders.firstOrNull)?['id'] as String?;
            if (id == null) return _noData(context);
            if (!context.mounted) return;
            await Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => AcceptanceScreen(orderId: id)),
            );
          }),
          _row('C-36/41', t('c41.title'), () => const ApprovalsInboxScreen(asTab: false)),
          _rowContext('C-37', t('c37.title'), (loc) => DebtScreen(locationId: loc)),
          _rowContext('C-38', t('c38.title'), (loc) => LimitsScreen(locationId: loc)),
          _row('C-39', t('c39.title'), () => const ReportsScreen(asTab: false)),
        ]),
        _group(t('showcase.org'), [
          _row('C-40', t('c40.title'), () => const OrgDashboardScreen()),
          _row('C-44', t('c44.title'), () => const OrgFinanceScreen(asTab: false)),
          _row('C-45', t('c45.title'), () => const OrgUsersScreen()),
          _row('C-49', t('c49.title'), () => const PointsScreen()),
        ]),
        _group(t('showcase.phase2'), [
          _row('C-42', t('c42.title'), () => const DefectPackageScreen()),
          _row('C-43', t('c43.title'), () => const OrgDebtScreen()),
          _row('C-46', t('c46.title'), () => const InspectionsScreen()),
          _row('C-48', t('c48.title'), () => const OwnerDashboardScreen()),
        ]),
      ],
    );
  }

  static void _noData(BuildContext context) {
    showSozoToast(context, t('showcase.noData'));
  }

  Widget _group(String title, List<Widget> rows) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeading(title),
          const SizedBox(height: SozoSpace.s8),
          SozoCard(gap: 0, children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const SozoDivider(),
              rows[i],
            ],
          ]),
        ],
      ),
    );
  }

  Widget _row(String code, String title, Widget Function() build) {
    return Builder(
      builder: (context) => _ShowcaseRow(
        code: code,
        title: title,
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => build())),
      ),
    );
  }

  Widget _rowAsync(String code, String title, Future<void> Function() open) {
    return _ShowcaseRow(code: code, title: title, onTap: open);
  }

  /// Экран точки: нужен выбранный контекст, иначе открывать нечего
  Widget _rowContext(String code, String title, Widget Function(String locationId) build) {
    return Builder(
      builder: (context) => _ShowcaseRow(
        code: code,
        title: title,
        onTap: () {
          final loc = session.contextId;
          if (loc == null) {
            showSozoToast(context, t('showcase.needContext'));
            return;
          }
          Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => build(loc)));
        },
      ),
    );
  }
}

class _ShowcaseRow extends StatelessWidget {
  const _ShowcaseRow({required this.code, required this.title, required this.onTap});

  final String code;
  final String title;
  final FutureOr<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onTap(),
      child: Container(
        constraints: const BoxConstraints(minHeight: SozoSize.buttonSecondary),
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
        child: Row(
          children: [
            SizedBox(
              width: 62,
              child: Text(
                code,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.textTertiary),
              ),
            ),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 15, color: SozoColors.text),
              ),
            ),
            const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
          ],
        ),
      ),
    );
  }
}

/// Кнопка наполнения демо-данными: без них половина экранов пустая
class _DemoSeedCard extends StatefulWidget {
  const _DemoSeedCard({required this.onDone});

  final Future<void> Function() onDone;

  @override
  State<_DemoSeedCard> createState() => _DemoSeedCardState();
}

class _DemoSeedCardState extends State<_DemoSeedCard> {
  bool _busy = false;

  Future<void> _seed() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.seedDemo();
      await session.refreshMe();
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      await widget.onDone();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SozoCard(
      children: [
        CardTitle(t('showcase.seedTitle')),
        Text(
          t('showcase.seedText'),
          style: const TextStyle(fontSize: 13, height: 1.4, color: SozoColors.textSecondary),
        ),
        SecondaryButton(t('showcase.seed'), icon: 'sparkles', busy: _busy, onTap: _seed),
      ],
    );
  }
}

class _Data {
  _Data({
    required this.orders,
    this.active,
    this.needsDecision,
    this.completed,
    this.closed,
    this.dispute,
  });

  final List<Map<String, dynamic>> orders;
  final Map<String, dynamic>? active;
  final Map<String, dynamic>? needsDecision;
  final Map<String, dynamic>? completed;
  final Map<String, dynamic>? closed;
  final Map<String, dynamic>? dispute;
}
