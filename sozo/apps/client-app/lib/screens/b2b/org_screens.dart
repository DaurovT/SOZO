import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../../widgets/figma_icon.dart';
import '../shell.dart';
import 'approvals_inbox.dart';
import 'phase2_screens.dart';
import 'site_screens.dart';
import 'staff_home.dart';

/// C-40. Дашборд организации — светофор точек.
///
/// Состояние точки дублируется подписью, а не только цветом: «Авария» должно
/// читаться и в чёрно-белом, и человеком, который не различает красный.
class OrgDashboardScreen extends StatelessWidget {
  const OrgDashboardScreen({super.key});

  String? get _orgId => session.currentContext?['organizationId'] as String?;

  @override
  Widget build(BuildContext context) {
    final orgId = _orgId;
    if (orgId == null) {
      return TabScaffold(title: t('tab.home'), child: EmptyState(icon: 'users', text: t('c31.noContext')));
    }
    return TabScaffold(
      title: (session.currentContext?['organizationName'] as String?) ?? t('c40.title'),
      switchable: true,
      child: AsyncView<Map<String, dynamic>>(
        load: () => session.api.orgDashboard(orgId),
        builder: (context, data, reload) {
          final tiles = ((data['tiles'] as List?) ?? const []).cast<Map<String, dynamic>>();
          final s = (data['summary'] as Map<String, dynamic>?) ?? const {};
          return ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              if (data['suspended'] == true) ...[
                SozoBanner(
                  icon: 'alert-triangle',
                  tone: BannerTone.danger,
                  title: t('c40.suspendedTitle'),
                  text: t('c40.suspendedText'),
                ),
                const SizedBox(height: SozoSpace.s12),
              ],
              SozoCard(
                children: [
                  MoneyRow(label: t('c40.pending'), amount: '${s['pendingApproval'] ?? 0}'),
                  MoneyRow(label: t('c40.subscription'), amount: soums(s['subscriptionTiyin'])),
                  MoneyRow(
                    label: t('c40.unpaid'),
                    sub: (s['unpaidInvoices'] as num? ?? 0) > 0 ? t('c40.invoices', {'n': s['unpaidInvoices']}) : null,
                    amount: soums(s['unpaidTiyin']),
                    color: (s['unpaidTiyin'] as num? ?? 0) > 0 ? SozoColors.error : null,
                  ),
                  MoneyRow(label: t('c40.techDebt'), amount: soums(s['techDebtTiyin'])),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),
              SozoCard(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const ApprovalsInboxScreen(asTab: false)),
                ),
                children: [
                  Row(
                    children: [
                      const FigmaIcon('check-square', size: 20, color: SozoColors.textSecondary),
                      const SizedBox(width: SozoSpace.s12),
                      Expanded(
                        child: Text(
                          t('c41.title'),
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                        ),
                      ),
                      if ((s['pendingApproval'] as num? ?? 0) > 0)
                        TagChip(
                          '${s['pendingApproval']}',
                          bg: SozoColors.accent.withValues(alpha: 0.18),
                          fg: SozoColors.text,
                        ),
                      const SizedBox(width: SozoSpace.s4),
                      const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                    ],
                  ),
                ],
              ),
              // Разделы сети: редкие, но не «мои» — место им здесь, а не в профиле
              const SizedBox(height: SozoSpace.s12),
              SozoCard(
                gap: 0,
                children: [
                  NavRow(
                    icon: 'line-chart',
                    title: t('c47.title'),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const ReportsScreen(asTab: false)),
                    ),
                  ),
                  const SozoDivider(),
                  NavRow(
                    icon: 'clipboard',
                    title: t('c43.title'),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const OrgDebtScreen()),
                    ),
                  ),
                  const SozoDivider(),
                  NavRow(
                    icon: 'calendar',
                    title: t('c46.title'),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const InspectionsScreen()),
                    ),
                  ),
                  const SozoDivider(),
                  NavRow(
                    icon: 'users',
                    title: t('c45.title'),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const OrgUsersScreen()),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: SozoSpace.s24),
              SectionHeading(t('c40.sites')),
              const SizedBox(height: SozoSpace.s12),
              for (final tile in tiles) ...[
                SozoCard(
                  onTap: () async {
                    await session.setContext(tile['id'] as String, remember: session.rememberContext);
                    if (!context.mounted) return;
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const SiteHomeScreen(showFilters: true)),
                    );
                    await reload();
                  },
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
                        const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                      ],
                    ),
                    Text(
                      (tile['label'] as String?) ?? '',
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                    ),
                    Text(
                      (tile['address'] as String?) ?? '',
                      style: const TextStyle(fontSize: 12, color: SozoColors.textTertiary),
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// C-44. Финансы организации.
class OrgFinanceScreen extends StatelessWidget {
  const OrgFinanceScreen({super.key, this.asTab = true});

  final bool asTab;

  @override
  Widget build(BuildContext context) {
    final orgId = session.currentContext?['organizationId'] as String?;
    final body = orgId == null
        ? EmptyState(icon: 'credit-card', text: t('c31.noContext'))
        : AsyncView<Map<String, dynamic>>(
            load: () => session.api.orgFinance(orgId),
            builder: (context, data, reload) {
              final contract = (data['contract'] as Map<String, dynamic>?) ?? const {};
              final invoices = ((data['invoices'] as List?) ?? const []).cast<Map<String, dynamic>>();
              final dunning = data['dunning'] as String?;
              return ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  // Дунинг называет срок и последствие: «оплатите» без даты не работает
                  if (dunning != null) ...[
                    SozoBanner(
                      icon: 'alert-triangle',
                      tone: dunning == 'suspend' ? BannerTone.danger : BannerTone.warn,
                      title: dunning == 'suspend' ? t('c44.dunningSuspendTitle') : t('c44.dunningWarnTitle'),
                      text: dunning == 'suspend'
                          ? t('c44.dunningSuspendText')
                          : t('c44.dunningWarnText', {'days': data['oldestUnpaidDays']}),
                    ),
                    const SizedBox(height: SozoSpace.s12),
                  ],
                  SozoCard(
                    children: [
                      CardTitle(t('c44.contract')),
                      MoneyRow(label: t('c44.subscription'), amount: soums(contract['subscriptionTiyin'])),
                      // Wrap: «Годовой» и «Цены заморожены» рядом не влезали
                      Wrap(
                        spacing: SozoSpace.s8,
                        runSpacing: SozoSpace.s8,
                        children: [
                          TagChip(
                            contract['kind'] == 'annual' ? t('c44.annual') : t('c44.monthly'),
                          ),
                          if (contract['pricesFrozen'] == true)
                            TagChip(t('c44.pricesFrozen'), bg: softSuccessBg, fg: softSuccessFg),
                        ],
                      ),
                      if (contract['penaltyEnabled'] == true)
                        Text(t('c44.penalty'), style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                    ],
                  ),
                  // Пени идут раньше остатка: это то, что растёт каждый день,
                  // и увидеть их надо до того, как придёт счёт
                  if (((data['penalty'] as Map<String, dynamic>?)?['amountTiyin'] as num? ?? 0) > 0) ...[
                    const SizedBox(height: SozoSpace.s12),
                    _penaltyCard(data['penalty'] as Map<String, dynamic>),
                  ],

                  // Остаток абонентки — то, ради чего этот экран открывают
                  if (data['balance'] != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    _balanceCard((data['balance'] as Map<String, dynamic>)),
                  ],

                  // Реквизиты — под договором: их спрашивают до того, как
                  // начинают разбираться со счетами
                  if (data['requisites'] != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    _requisitesCard(context, data['requisites'] as Map<String, dynamic>),
                  ],

                  const SizedBox(height: SozoSpace.s16),
                  SectionHeading(t('c44.invoices')),
                  const SizedBox(height: SozoSpace.s8),
                  if (invoices.isEmpty)
                    SozoCard(
                      children: [
                        Text(
                          (data['empty'] as String?) ?? '',
                          style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                        ),
                      ],
                    )
                  else
                    for (final i in invoices) ...[
                      SozoCard(
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  (i['number'] as String?) ?? '',
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                                ),
                              ),
                              TagChip(
                                i['status'] == 'paid' ? t('c44.paid') : t('c44.issued'),
                                bg: i['status'] == 'paid' ? softSuccessBg : softWarnBg,
                                fg: i['status'] == 'paid' ? softSuccessFg : softWarnFg,
                              ),
                            ],
                          ),
                          MoneyRow(
                            label: _kind(i['kind'] as String?),
                            sub: dayMonth(i['issuedAt']),
                            amount: soums(i['amountTiyin']),
                          ),
                          if (((i['vatTiyin'] as num?) ?? 0) > 0)
                            Text(
                              t('c44.vatIncluded', {
                                'rate': i['vatRatePercent'],
                                'sum': soums(i['vatTiyin']),
                              }),
                              style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                            ),
                          // Счёт нужен бухгалтерии в печатном виде — иначе
                          // руководитель фотографирует экран телефона
                          TextAction(
                            t('c44.openInvoice'),
                            onTap: () => openDocument(
                              context,
                              session.api.documentUrl('/documents/invoices/${i['id']}'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s12),
                    ],

                  // Акт сверки (F-51): раз в период его просят все бухгалтерии
                  const SizedBox(height: SozoSpace.s8),
                  SecondaryButton(
                    t('c44.reconciliation'),
                    icon: 'file-text',
                    onTap: () => openDocument(
                      context,
                      session.api.documentUrl('/documents/organizations/$orgId/reconciliation'),
                    ),
                  ),
                ],
              );
            },
          );
    if (asTab) return TabScaffold(title: t('c44.title'), child: body);
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c44.title')),
      body: SafeArea(child: body),
    );
  }

  /// Реквизиты сторон и способ расчёта.
  ///
  /// Реквизиты для оплаты можно скопировать одним касанием: их переносят
  /// в банк-клиент руками, и опечатка в номере счёта возвращает платёж
  /// через неделю.
  static Widget _requisitesCard(BuildContext context, Map<String, dynamic> r) {
    final org = (r['organization'] as Map<String, dynamic>?) ?? const {};
    final payTo = (r['payTo'] as String?) ?? '';
    return SozoCard(
      children: [
        CardTitle(t('c44.requisites')),
        MoneyRow(label: t('c44.orgName'), amount: (org['name'] as String?) ?? ''),
        MoneyRow(label: t('c44.inn'), amount: (org['inn'] as String?) ?? ''),
        MoneyRow(label: t('c44.contractType'), amount: (org['contractType'] as String?) ?? ''),
        MoneyRow(label: t('c44.contractKind'), amount: (org['contractKind'] as String?) ?? ''),
        MoneyRow(label: t('c44.vat'), amount: org['vatPayer'] == true ? t('common.yes') : t('common.no')),
        const SozoDivider(),
        Text(
          t('c44.settlement'),
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.textSecondary),
        ),
        Text(
          (r['settlement'] as String?) ?? '',
          style: const TextStyle(fontSize: 14, color: SozoColors.text, height: 1.35),
        ),
        if (payTo.isNotEmpty) ...[
          const SozoDivider(),
          Text(
            t('c44.payTo'),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.textSecondary),
          ),
          Text(payTo, style: const TextStyle(fontSize: 14, color: SozoColors.text, height: 1.35)),
          TextAction(
            t('c44.copyRequisites'),
            onTap: () async {
              await Clipboard.setData(ClipboardData(text: payTo));
              if (context.mounted) showSozoToast(context, t('c44.copied'));
            },
          ),
        ],
      ],
    );
  }

  /// Пени за просрочку: сколько набежало и по каким счетам.
  ///
  /// Показываем расчёт, а не выставленный счёт: пени начисляются каждый день
  /// сами, а предъявляют их по решению человека. Клиент должен видеть цену
  /// просрочки заранее — тогда это повод заплатить, а не повод поссориться.
  static Widget _penaltyCard(Map<String, dynamic> p) {
    final rows = ((p['rows'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return SozoCard(
      border: SozoColors.warning,
      children: [
        CardTitle(t('c44.penaltyTitle')),
        MoneyRow(
          label: t('c44.penaltyAccrued'),
          amount: soums(p['amountTiyin']),
          bold: true,
          color: SozoColors.warning,
        ),
        Text(
          t('c44.penaltyRule', {'rate': p['ratePercentPerDay'], 'cap': p['capPercent'], 'grace': p['graceDays']}),
          style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
        ),
        for (final r in rows)
          MoneyRow(
            label: (r['number'] as String?) ?? '',
            sub: t('c44.penaltyDays', {'days': r['overdueDays']}),
            amount: soums(r['penaltyTiyin']),
          ),
      ],
    );
  }

  /// Оплачено, израсходовано, остаток и «хватит примерно до N числа».
  ///
  /// Остаток — крупно и первым: это ответ на вопрос, с которым сюда пришли.
  /// Сверхлимит подсвечиваем красным, потому что он означает отдельный счёт.
  static Widget _balanceCard(Map<String, dynamic> b) {
    final over = b['overlimit'] == true;
    final forecastDay = (b['forecastDay'] as num?)?.toInt();
    final carryover = (b['carryoverTiyin'] as num?)?.toInt() ?? 0;
    return SozoCard(
      children: [
        CardTitle(t('c44.balanceTitle')),
        MoneyRow(
          label: over ? t('c44.overlimit') : t('c44.balance'),
          amount: soums((b['balanceTiyin'] as num?)?.abs()),
          bold: true,
          color: over ? SozoColors.error : null,
        ),
        MoneyRow(label: t('c44.paidIn'), amount: soums(b['paidTiyin'])),
        MoneyRow(label: t('c44.consumed'), amount: soums(b['consumedTiyin'])),
        if (forecastDay != null)
          Text(
            t('c44.forecast', {'day': forecastDay}),
            style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
          ),
        if (carryover > 0)
          MoneyRow(
            label: t('c44.carryover', {'percent': b['carryoverPercent']}),
            amount: soums(carryover),
          ),
        Text(
          (b['note'] as String?) ?? '',
          style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
        ),
      ],
    );
  }

  static String _kind(String? k) => switch (k) {
        'overlimit' => t('c44.kindOverlimit'),
        'one_off_prepayment' => t('c44.kindPrepayment'),
        _ => t('c44.kindSubscription'),
      };
}

/// C-45. Лимиты и пользователи организации.
class OrgUsersScreen extends StatelessWidget {
  const OrgUsersScreen({super.key});

  /// Завести человека на точку. Потолок утверждения спрашиваем сразу: без него
  /// непонятно, сотрудника заводят или второго руководителя.
  static Future<void> _addUser(BuildContext context, String locationId, Future<void> Function() reload) async {
    final name = TextEditingController();
    final phone = TextEditingController(text: '+998');
    final limit = TextEditingController(text: '0');
    final position = TextEditingController();
    final saved = await showSozoSheet<bool>(
      context,
      title: t('c45.addTitle'),
      child: StatefulBuilder(
        builder: (context, setState) => Padding(
          padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SozoField(label: t('c45.name'), controller: name),
              const SizedBox(height: SozoSpace.s12),
              SozoField(label: t('c02.phoneLabel'), controller: phone, keyboardType: TextInputType.phone),
              const SizedBox(height: SozoSpace.s12),
              SozoField(label: t('c45.position'), controller: position, hint: t('c45.positionHint')),
              const SizedBox(height: SozoSpace.s12),
              SozoField(
                label: t('c45.limit'),
                controller: limit,
                keyboardType: TextInputType.number,
                hint: t('c45.limitHint'),
              ),
              const SizedBox(height: SozoSpace.s16),
              PrimaryButton(t('common.add'), onTap: () => Navigator.of(context).pop(true)),
            ],
          ),
        ),
      ),
    );
    if (saved != true) return;
    try {
      final res = await session.api.addSiteUser(locationId, {
        'fullName': name.text.trim(),
        'phone': phone.text.trim(),
        'position': position.text.trim(),
        'approvalLimitTiyin': (int.tryParse(limit.text.trim()) ?? 0) * 100,
      });
      if (context.mounted) showSozoToast(context, (res['message'] as String?) ?? t('common.done'));
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  /// Пригласить кодом. Номер спрашивать не нужно — человек назовёт себя сам.
  static Future<void> _invite(BuildContext context, String locationId, Future<void> Function() reload) async {
    final limit = TextEditingController(text: '0');
    final position = TextEditingController();
    final ok = await showSozoSheet<bool>(
      context,
      title: t('c45.inviteBy'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SozoBanner(icon: 'info', text: t('c45.inviteHint')),
            const SizedBox(height: SozoSpace.s12),
            SozoField(label: t('c45.position'), controller: position, hint: t('c45.positionHint')),
            const SizedBox(height: SozoSpace.s12),
            SozoField(
              label: t('c45.limit'),
              controller: limit,
              keyboardType: TextInputType.number,
              hint: t('c45.limitHint'),
            ),
            const SizedBox(height: SozoSpace.s16),
            PrimaryButton(t('c45.inviteBy'), onTap: () => Navigator.of(context).pop(true)),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final res = await session.api.issueInvite({
        'locationId': locationId,
        'position': position.text.trim(),
        'approvalLimitTiyin': (int.tryParse(limit.text.trim()) ?? 0) * 100,
      });
      final code = (res['code'] as String?) ?? '';
      final until = ymd((res['expiresAt'] as String?) ?? '');
      if (!context.mounted) return;
      final copy = await showSozoConfirm(
        context,
        title: t('c45.inviteReady'),
        text: t('c45.inviteShare', {'code': code, 'until': until}),
        confirmLabel: t('c45.inviteCopy'),
        cancelLabel: t('common.close'),
      );
      if (copy && context.mounted) {
        await Clipboard.setData(ClipboardData(text: code));
        if (context.mounted) showSozoToast(context, t('c45.inviteCopied'));
      }
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  /// Отозвать выданный код.
  ///
  /// Приглашение живёт неделю, и человек, которому оно больше не нужно, всё
  /// это время может войти на точку. Спрашиваем подтверждение: код уже могли
  /// передать, и отзыв для получателя выглядит как отказ.
  static Future<void> _revokeInvite(BuildContext context, String id, Future<void> Function() reload) async {
    final ok = await showSozoConfirm(
      context,
      title: t('c45.inviteRevoke'),
      text: t('c45.inviteHint'),
      confirmLabel: t('c45.inviteRevoke'),
      danger: true,
    );
    if (!ok) return;
    try {
      await session.api.revokeInvite(id);
      if (context.mounted) showSozoToast(context, t('c45.inviteRevoked'));
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  /// Правка должности и потолка утверждения.
  ///
  /// Потолок показываем только там, где его вправе менять: руководителю точки
  /// сервер разрешает заводить лишь сотрудников без права утверждения, и поле,
  /// которое всё равно отвергнут, лучше не рисовать вовсе.
  static Future<void> _editUser(
    BuildContext context,
    Map<String, dynamic> location,
    Map<String, dynamic> user,
    Future<void> Function() reload,
  ) async {
    final canSetLimit = location['canManage'] == 'all';
    final position = TextEditingController(text: (user['position'] as String?) ?? '');
    final limit = TextEditingController(
      text: user['approvalLimitTiyin'] == null ? '' : ((user['approvalLimitTiyin'] as num) ~/ 100).toString(),
    );
    final ok = await showSozoSheet<bool>(
      context,
      title: t('c45.editTitle'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SozoField(label: t('c45.position'), controller: position, hint: t('c45.positionHint')),
            if (canSetLimit) ...[
              const SizedBox(height: SozoSpace.s12),
              SozoField(
                label: t('c45.limit'),
                controller: limit,
                keyboardType: TextInputType.number,
                helper: t('c45.limitHint'),
              ),
            ],
            const SizedBox(height: SozoSpace.s16),
            PrimaryButton(t('common.save'), onTap: () => Navigator.of(context).pop(true)),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await session.api.updateSiteUser(location['id'] as String, user['id'] as String, {
        'position': position.text.trim(),
        if (canSetLimit) 'approvalLimitTiyin': (int.tryParse(limit.text.trim()) ?? 0) * 100,
      });
      if (context.mounted) showSozoToast(context, t('c45.saved'));
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  static Future<void> _removeUser(
    BuildContext context,
    String locationId,
    Map<String, dynamic> user,
    Future<void> Function() reload,
  ) async {
    final ok = await showSozoConfirm(
      context,
      title: t('c45.removeTitle'),
      text: t('c45.removeText', {'name': (user['fullName'] as String?) ?? ''}),
      confirmLabel: t('c45.removeConfirm'),
      danger: true,
    );
    if (!ok) return;
    try {
      await session.api.removeSiteUser(locationId, user['id'] as String);
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final orgId = session.currentContext?['organizationId'] as String?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c45.title')),
      body: SafeArea(
        child: orgId == null
            ? EmptyState(icon: 'users', text: t('c31.noContext'))
            : AsyncView<Map<String, dynamic>>(
                load: () => session.api.orgUsers(orgId),
                builder: (context, data, reload) {
                  final locations = ((data['locations'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  return ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      SozoCard(
                        children: [
                          SwitchRow(
                            title: t('c45.showMoney'),
                            subtitle: t('c45.showMoneyHint'),
                            value: data['showMoneyToEmployees'] == true,
                            // Настройка договора — меняется через SOZO, здесь только видно
                            onChanged: (_) => showSozoToast(context, t('c45.viaSozo')),
                          ),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s16),
                      for (final l in locations) ...[
                        SectionHeading((l['name'] as String?) ?? ''),
                        const SizedBox(height: SozoSpace.s8),
                        SozoCard(
                          children: [
                            MoneyRow(label: t('c38.perOrder'), amount: soums(l['orderLimitTiyin'])),
                            MoneyRow(label: t('c38.monthLimit'), amount: soums(l['monthlyLimitTiyin'])),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s8),
                        for (final u in ((l['users'] as List?) ?? const []).cast<Map<String, dynamic>>()) ...[
                          SozoCard(
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          (u['fullName'] as String?) ?? '',
                                          style: const TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.w600,
                                            color: SozoColors.text,
                                          ),
                                        ),
                                        Text(
                                          prettyPhone(u['phone'] as String?),
                                          style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                                        ),
                                      ],
                                    ),
                                  ),
                                  TagChip(
                                    _role(u['role'] as String?),
                                    bg: u['role'] == 'staff'
                                        ? SozoColors.chipGrey
                                        : SozoColors.accent.withValues(alpha: 0.16),
                                    fg: u['role'] == 'staff' ? SozoColors.textSecondary : SozoColors.text,
                                  ),
                                ],
                              ),
                              if ((u['position'] as String?)?.isNotEmpty ?? false)
                                Text(
                                  u['position'] as String,
                                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                                ),
                              MoneyRow(
                                label: t('c38.myApproval'),
                                amount: u['approvalLimitTiyin'] == null
                                    ? t('c38.noLimit')
                                    : soums(u['approvalLimitTiyin']),
                              ),
                              Row(
                                children: [
                                  // Раньше должность и потолок правились только
                                  // через «снять доступ и завести заново» —
                                  // человек терял привязку к своим заявкам
                                  TextAction(
                                    t('c45.edit'),
                                    onTap: () => _editUser(context, l, u, reload),
                                  ),
                                  const Spacer(),
                                  // Себя снять нельзя — сервер откажет, кнопку не рисуем
                                  if (u['phone'] != session.phone)
                                    TextAction(
                                      t('c45.remove'),
                                      onTap: () => _removeUser(context, l['id'] as String, u, reload),
                                      danger: true,
                                    ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s8),
                        ],
                        SecondaryButton(
                          t('c45.add'),
                          onTap: () => _addUser(context, l['id'] as String, reload),
                        ),
                        const SizedBox(height: SozoSpace.s8),
                        // Второй путь, когда номера под рукой нет: код диктуют
                        // голосом или пересылают, человек вводит его при входе
                        SecondaryButton(
                          t('c45.inviteBy'),
                          onTap: () => _invite(context, l['id'] as String, reload),
                        ),
                        const SizedBox(height: SozoSpace.s8),
                        // Код, показанный один раз в диалоге, дальше было негде
                        // ни посмотреть, ни отозвать — а он живёт неделю
                        for (final inv in ((l['invites'] as List?) ?? const []).cast<Map<String, dynamic>>()) ...[
                          SozoCard(
                            gap: SozoSpace.s4,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      inv['code'] as String? ?? '',
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                        color: SozoColors.text,
                                        letterSpacing: 2,
                                      ),
                                    ),
                                  ),
                                  TagChip(t('c45.invitesTitle')),
                                ],
                              ),
                              Text(
                                [
                                  if ((inv['position'] as String?)?.isNotEmpty ?? false) inv['position'] as String,
                                  t('c45.inviteUntil', {'until': ymd(inv['expiresAt'] as String? ?? '')}),
                                ].join(' · '),
                                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                              ),
                              Row(
                                children: [
                                  TextAction(
                                    t('c45.inviteCopy'),
                                    onTap: () async {
                                      await Clipboard.setData(ClipboardData(text: inv['code'] as String? ?? ''));
                                      if (context.mounted) showSozoToast(context, t('c45.inviteCopied'));
                                    },
                                  ),
                                  const Spacer(),
                                  TextAction(
                                    t('c45.inviteRevoke'),
                                    danger: true,
                                    onTap: () => _revokeInvite(context, inv['id'] as String, reload),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s8),
                        ],
                      ],
                      SozoBanner(icon: 'info', text: (data['note'] as String?) ?? ''),
                    ],
                  );
                },
              ),
      ),
    );
  }

  static String _role(String? r) => switch (r) {
        'org_manager' => t('c05.roleOrgManager'),
        'site_manager' => t('c05.roleSiteManager'),
        _ => t('c05.roleStaff'),
      };
}
