import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'context_screen.dart';
import 'create/wizard.dart';
import 'order_screen.dart';
import 'b2b/report_screen.dart';
import 'b2b/org_screens.dart';
import 'b2b/acceptance_inbox.dart';
import 'b2b/approvals_inbox.dart';
import 'b2b/points_screen.dart';
import 'b2b/site_screens.dart';
import 'b2b/staff_home.dart';
import 'history_screen.dart';
import 'home_screen.dart';
import 'notifications_screen.dart';
import 'profile_screen.dart';
import 'services_screen.dart';

/// Текущая вкладка. Вынесена из состояния экрана, чтобы deep-link из push
/// (DEV-08 §2.3) мог переключить её из любого места, не ища предка в дереве.
final shellTab = ValueNotifier<int>(0);

/// Фильтр, с которым открыть вкладку «Заявки».
///
/// Нужен, чтобы карточка на главной вела не просто в список, а в нужный его
/// срез: «на гарантии три работы» без фильтра означало бы «ищите сами среди
/// сорока». Сбрасывается экраном после применения — иначе фильтр прилипнет
/// и в следующий заход человек увидит непонятно откуда взявшуюся выборку.
final historyFilter = ValueNotifier<String?>(null);

/// Каркас вкладок. Набор собирается по роли контекста (DEV-08 §2.1):
/// сотрудник точки, её руководитель и руководитель организации решают разные
/// задачи, и один таббар с неработающими кнопками им не подходит.
class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) {
    // Слушаем сессию здесь: смена роли меняет и набор вкладок, и содержимое.
    // Без этого таббар оставался от прежней роли — переключение «не работало».
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        final tabs = _tabsFor(session.role, session.isB2C);
        return ValueListenableBuilder<int>(
          valueListenable: shellTab,
          builder: (context, raw, _) {
            final index = raw.clamp(0, tabs.length - 1);
            return Scaffold(
              backgroundColor: SozoColors.bg,
              // Ключ по контексту: у двух точек один и тот же экран, и без
              // пересоздания состояния он показал бы данные прошлой точки
              body: IndexedStack(
                key: ValueKey('shell-${session.contextId ?? 'personal'}'),
                index: index,
                children: [for (final tab in tabs) tab.screen],
              ),
              bottomNavigationBar: SozoTabBar(
                tabs: [for (final tab in tabs) (icon: tab.icon, label: t(tab.label), size: tab.size)],
                index: index,
                // Создание заявки — в центре футера, а не кнопкой на главной:
                // так до него один тап с любого экрана, а не «сначала вернись
                // на главную»
                onCreate: () => startOrderCreation(context),
                onSelect: (i) => shellTab.value = i,
              ),
            );
          },
        );
      },
    );
  }
}

/// Что делает центральная кнопка футера.
///
/// Заявка у физлица и у точки — разные вещи: физик выбирает услугу и адрес,
/// сотрудник точки сообщает о поломке на объекте, который уже известен.
/// Кнопка одна, потому что намерение одно — «мне нужна работа», а куда вести,
/// решает контекст, а не человек.
Future<void> startOrderCreation(BuildContext context) async {
  if (!session.isB2C) {
    final locationId = session.contextId;
    // Руководителю организации точку сначала надо выбрать: его заявка всегда
    // про конкретный объект, а он работает поверх всех
    if (locationId == null || session.role == 'org_manager') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const ContextScreen(canClose: true)),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => ReportScreen(locationId: locationId)),
    );
    return;
  }

  // Долг закрывает обычные заявки, но не аварию: перекрыть человеку воду
  // из-за неоплаченного счёта нельзя (ТЗ 4.4)
  final blocked = session.me?['blocked'] as Map<String, dynamic>?;
  if (blocked != null) {
    // Блокировку снимает поддержка — предлагать «оплатить и продолжить» нечего.
    // Аварийный вызов остаётся доступен с главной, он под своей кнопкой
    await showSozoConfirm(
      context,
      title: t('c06.blockedTitle'),
      text: t('c06.blockedText', {'reason': blocked['reason'] ?? ''}),
      confirmLabel: t('common.close'),
    );
    return;
  }
  if (session.debtTiyin > 0) {
    final pay = await showSozoConfirm(
      context,
      title: t('c06.debtTitle'),
      text: t('c06.debtText', {'sum': soums(session.debtTiyin)}),
      confirmLabel: t('c06.pay'),
    );
    if (!pay || !context.mounted) return;
  }
  if (!context.mounted) return;
  final created = await Navigator.of(context).push<String>(
    MaterialPageRoute<String>(builder: (_) => const CreateOrderFlow()),
  );
  if (created != null && context.mounted) {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created)),
    );
  }
}

typedef _Tab = ({String icon, String label, double size, Widget screen});

/// Четыре вкладки в каждой роли и кнопка создания между ними:
/// «что сейчас» — «где посмотреть цены» — ➕ — «все мои заявки» — «я».
///
/// Уведомления вкладкой быть перестали: экран, куда заходят посмотреть и
/// выйти, занимал место в футере, которого всего пять. Он переехал под
/// колокольчик в шапке, а освободившееся место — под создание заявки, ради
/// которого приложение и открывают.
///
/// Одинаковая длина и одинаковые крайние вкладки: после смены роли ничего
/// не съезжает, а «Профиль» всегда там же, где был.
List<_Tab> _tabsFor(String role, bool isB2C) {
  if (isB2C) {
    return const [
      // Иконки и размер 20 — из макета таббара (190:71)
      (icon: 'home', label: 'tab.home', size: 20.0, screen: HomeScreen()),
      (icon: 'grid', label: 'tab.services', size: 20.0, screen: ServicesScreen()),
      (icon: 'clipboard-list', label: 'tab.orders', size: 20.0, screen: HistoryScreen()),
      (icon: 'user', label: 'tab.profile', size: 20.0, screen: ProfileScreen()),
    ];
  }
  final locationId = session.contextId ?? '';
  return switch (role) {
    // Руководитель организации работает поверх всех точек: своей ленты заявок
    // у него нет — он входит в точку с дашборда
    'org_manager' => [
        const (icon: 'home', label: 'tab.dashboard', size: 20.0, screen: OrgDashboardScreen()),
        const (icon: 'check-square', label: 'tab.approvals', size: 22.0, screen: ApprovalsInboxScreen()),
        const (icon: 'credit-card', label: 'tab.finance', size: 22.0, screen: OrgFinanceScreen()),
        const (icon: 'user', label: 'tab.profile', size: 22.0, screen: ProfileScreen()),
      ],
    'site_manager' => [
        const (icon: 'home', label: 'tab.home', size: 20.0, screen: SiteHomeScreen(showFilters: true)),
        const (icon: 'check-square', label: 'tab.approvals', size: 22.0, screen: ApprovalsInboxScreen()),
        (icon: 'line-chart', label: 'tab.reports', size: 22.0, screen: ReportsScreen(locationId: locationId)),
        const (icon: 'user', label: 'tab.profile', size: 22.0, screen: ProfileScreen()),
      ],
    // Сотрудник точки: сообщить о поломке, следить за своими обращениями,
    // принять работу. Каталога у него нет намеренно — организация чаще всего
    // прячет от сотрудников суммы, и вкладка с прайсом этому противоречила бы
    _ => [
        const (icon: 'home', label: 'tab.home', size: 20.0, screen: SiteHomeScreen()),
        const (
          icon: 'list',
          label: 'tab.myRequests',
          size: 22.0,
          screen: SiteHomeScreen(fixedFilter: 'mine', titleKey: 'tab.myRequests'),
        ),
        // Баллы — вкладкой только если программа включена договором. Иначе на
        // её месте приёмка: она у сотрудника бывает каждый день, а баллов
        // может не быть никогда
        if (session.currentContext?['loyaltyEnabled'] == true)
          const (icon: 'star', label: 'tab.points', size: 22.0, screen: PointsScreen())
        else
          const (icon: 'check-square', label: 'tab.acceptance', size: 22.0, screen: AcceptanceInboxScreen()),
        const (icon: 'user', label: 'tab.profile', size: 22.0, screen: ProfileScreen()),
      ],
  };
}

/// Колокольчик со счётчиком: вход в ленту уведомлений из шапки.
///
/// Раньше лента занимала пятую вкладку — место в футере, которого всего пять,
/// под экран, куда заходят посмотреть и выйти. Освободившееся место отдано
/// кнопке создания заявки: она нужна на каждом экране и по многу раз.
class NotificationsBell extends StatefulWidget {
  const NotificationsBell({super.key});

  @override
  State<NotificationsBell> createState() => _NotificationsBellState();
}

class _NotificationsBellState extends State<NotificationsBell> {
  @override
  Widget build(BuildContext context) {
    final unread = session.unreadNotifications;
    return IconButton(
      tooltip: t('tab.notifications'),
      onPressed: () async {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()),
        );
        // Вернулись — счётчик наверняка изменился
        await session.refreshMe();
        if (mounted) setState(() {});
      },
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          const FigmaIcon('bell', size: 22, color: SozoColors.text),
          if (unread > 0)
            Positioned(
              right: -4,
              top: -3,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: SozoColors.error,
                  borderRadius: BorderRadius.circular(SozoRadius.badge),
                ),
                constraints: const BoxConstraints(minWidth: 16),
                child: Text(
                  unread > 99 ? '99+' : '$unread',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: SozoColors.surface),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Обёртка вкладки: шапка + содержимое. Шапка не уезжает со скроллом —
/// в приложении мастера это уже ловили как «странный экран».
class TabScaffold extends StatelessWidget {
  const TabScaffold({
    super.key,
    required this.title,
    required this.child,
    this.action,
    this.leading,
    this.offline = false,
    this.switchable = false,
    this.titleSize = 17,
  });

  final String title;

  /// Размер заголовка вкладки: в макете профиля (256:13) он 18
  final double titleSize;
  final Widget child;
  final Widget? action;
  final Widget? leading;
  final bool offline;

  /// Заголовок ведёт к выбору роли: включаем там, где есть что переключать
  final bool switchable;

  @override
  Widget build(BuildContext context) {
    // Переключать нечего — заголовок остаётся обычным текстом
    final canSwitch = switchable && session.contexts.isNotEmpty;
    return Column(
      children: [
        SozoAppBar(
          title: title,
          titleSize: titleSize,
          showBack: false,
          // Колокольчик в шапке у каждой вкладки: уведомления перестали быть
          // вкладкой, но остались тем, что смотрят чаще всего остального.
          // Свой `action` экрана, если он есть, важнее — уступаем ему место
          action: action ?? const NotificationsBell(),
          leading: leading,
          bottom: offline ? const OfflineBar() : null,
          onTitleTap: canSwitch
              ? () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const ContextScreen()),
                  )
              : null,
        ),
        Expanded(child: child),
      ],
    );
  }
}
