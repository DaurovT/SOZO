import 'package:flutter/material.dart';

import 'dart:async';

import 'design_tokens.dart';
import 'widgets/figma_icon.dart';
import 'i18n.dart';
import 'screens/output_screen.dart';
import 'screens/login_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/outbox_screen.dart';
import 'screens/profile_extras.dart';
import 'screens/profile_screen.dart';
import 'screens/today_screen.dart';
import 'push/deep_link.dart';
import 'store/session.dart';
import 'widgets/app_chrome.dart';
import 'widgets/common.dart';

/// Единая сессия приложения: токен, профиль, офлайн-очередь.
/// Один объект на процесс — приложение мастера однопользовательское по определению.
final session = Session();

/// Ключ навигатора: тап по уведомлению приходит вне дерева виджетов, и
/// открыть по нему экран больше нечем — контекста у такого события нет.
final navigatorKey = GlobalKey<NavigatorState>();

/// Активная вкладка оболочки.
///
/// Вынесена наружу ради дедлинков: «Сегодня», «Деньги» и «График» живут
/// внутри `MasterShell` и своего `Scaffold` не имеют. Push таких экранов
/// новым роутом давал прозрачный фон, полосатый текст и экран без таббара —
/// именно то, что мастер видел, тапнув по уведомлению. Теперь уведомление
/// переключает вкладку, а не открывает второй экземпляр ленты.
final shellTab = ValueNotifier<int>(0);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MasterApp());
}

/// Поднять канал уведомлений и связать его с навигацией
Future<void> _startPush() async {
  await session.push.init();
  session.push.onDeepLink = (link) {
    final nav = navigatorKey.currentState;
    if (nav != null) unawaited(openDeepLink(nav, link));
  };
}

class MasterApp extends StatefulWidget {
  const MasterApp({super.key});

  @override
  State<MasterApp> createState() => _MasterAppState();
}

class _MasterAppState extends State<MasterApp> {
  @override
  void initState() {
    super.initState();
    l10n.load();
    session.boot();
    // Канал поднимаем отдельно от загрузки сессии: инициализация Firebase
    // ходит в сеть, а лента дня ждать этого не должна
    unawaited(_startPush());
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: t('common.sozoMaster'),
      debugShowCheckedModeBanner: false,
      theme: sozoTheme(),
      // Крупный системный шрифт приложение обязано пережить: у мастера
      // за пятьдесят он включён почти всегда. Потолок 1.6 — граница, за
      // которой кнопка шага перестаёт помещаться на экране 5,5″ целиком;
      // ниже единицы не опускаемся, мельче макета делать нечего.
      builder: (context, child) => MediaQuery.withClampedTextScaling(
        minScaleFactor: 1.0,
        maxScaleFactor: 1.6,
        child: child ?? const SizedBox.shrink(),
      ),
      // Слушаем и язык: он переключается на ходу, и перерисоваться должно
      // всё дерево, а не только экран с переключателем.
      // Ключ по языку: при переключении дерево пересоздаётся целиком, и экраны
      // заново запрашивают справочники. Без этого подписи стали бы узбекскими,
      // а причины отказа и вопросы экзамена остались бы в языке, на котором их
      // загрузили при открытии экрана.
      home: AnimatedBuilder(
        key: ValueKey(l10n.code),
        animation: Listenable.merge([session, l10n]),
        builder: (context, _) {
          if (!session.ready) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          if (session.forceUpdate) return const _ForceUpdateScreen();
          if (session.isAuthorized) return const MasterShell();
          // Доступ закрыт или его ещё не открыли — причина показывается на
          // экране входа. Воронки онбординга в приложении больше нет:
          // мастера заводит и допускает к заявкам админ
          return const LoginScreen();
        },
      ),
    );
  }
}

/// F-60: сломанную сборку закрывают с сервера, не дожидаясь, пока все обновятся
class _ForceUpdateScreen extends StatelessWidget {
  const _ForceUpdateScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const FigmaIcon('upload', size: 64, color: SozoColors.accent),
              const SizedBox(height: SozoSpace.s16),
              Text(
                session.updateMessage ?? t('common.obnovitePrilojenieChtobyProdol'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, height: 1.35),
              ),
              const SizedBox(height: SozoSpace.s8),
              Text(
                t('common.ustanovlenaNujna', {'p1': Session.appVersion, 'p2': session.minVersion ?? t('common.novee')}),
                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Оболочка с вкладками (DEV-09 §2.1). У «Главной» своя шапка с аватаром —
/// системный заголовок над ней был бы вторым названием подряд.
class MasterShell extends StatefulWidget {
  const MasterShell({super.key});

  @override
  State<MasterShell> createState() => _MasterShellState();
}

class _MasterShellState extends State<MasterShell> with WidgetsBindingObserver {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    shellTab.addListener(_onTabRequested);
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    shellTab.removeListener(_onTabRequested);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Возврат в приложение — единственный надёжный момент, когда связь могла
  /// появиться незаметно: мастер вышел из подвала, посмотрел в телефон.
  /// Раньше очередь уходила только по тику ленты «Сегодня», и вернувшийся
  /// из «Профиля» или «Заявок» синхронизацию не запускал вовсе.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    unawaited(session.outbox.flush());
    // Токен устройства мог не выдаться при старте: без него не приходят офферы
    unawaited(session.push.ensureRegistered());
  }

  /// Вкладку просит дедлинк уведомления
  void _onTabRequested() {
    if (mounted && shellTab.value != _tab) setState(() => _tab = shellTab.value);
  }

  void _select(int i) {
    setState(() => _tab = i);
    shellTab.value = i;
  }

  @override
  Widget build(BuildContext context) {
    // Шапку каждая вкладка рисует сама — в макете они разной высоты
    // и с разным содержимым (аватар на главной, заголовок 45 в графике).
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            OfflineBar(
              outbox: session.outbox,
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OutboxScreen())),
            ),
            Expanded(
              child: IndexedStack(
                index: _tab,
                children: [
                  TodayScreen(onOpenWallet: () => _select(3)),
                  const OrdersScreen(),
                  const ScheduleTab(),
                  // M-34 или M-46 — решает аффилиация, не пользователь (DEV-09)
                  const WalletOrOutputScreen(),
                  const ProfileScreen(),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SozoTabBar(index: _tab, onSelect: _select),
    );
  }
}
