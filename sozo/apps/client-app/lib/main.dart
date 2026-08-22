import 'dart:async';

import 'package:flutter/material.dart';

import 'design_tokens.dart';
import 'i18n.dart';
import 'push/deep_link.dart';
import 'screens/context_screen.dart';
import 'screens/login_screen.dart';
import 'store/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await l10n.load();
  await session.load();
  // Push поднимаем до runApp, но не ждём: инициализация Firebase ходит в
  // сеть, а запуск приложения ждать этого не должен. Если канала нет —
  // приложение работает как прежде, события видно в ленте
  unawaited(_startPush());
  runApp(const SozoClientApp());
  // Догружаемый словарь мог устареть — сверяем отпечаток и обновляем в фоне.
  // После `runApp`, а не до: запуск не должен ждать сети ради перевода,
  // который уже лежит в кеше и работает
  unawaited(l10n.refreshInBackground());
}

/// Ключ навигатора — единственный способ открыть экран по тапу на
/// уведомление: тап приходит вне дерева виджетов, контекста у него нет.
final navigatorKey = GlobalKey<NavigatorState>();

/// Поднять канал уведомлений и связать его с навигацией.
///
/// Если человек уже вошёл, устройство регистрируется сразу: сессия живёт
/// между запусками, а токен поставщик меняет когда захочет.
Future<void> _startPush() async {
  await session.push.init();
  session.push.onDeepLink = (link) {
    final nav = navigatorKey.currentState;
    if (nav != null) unawaited(openDeepLink(nav, link));
  };
  if (session.signedIn) await session.push.register();
}

class SozoClientApp extends StatelessWidget {
  const SozoClientApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Перерисовка на смену языка и сессии: C-30 требует мгновенного
    // применения языка без перезапуска
    return AnimatedBuilder(
      animation: Listenable.merge([l10n, session]),
      builder: (context, _) => MaterialApp(
        navigatorKey: navigatorKey,
        title: 'SOZO',
        theme: sozoTheme(),
        debugShowCheckedModeBanner: false,
        // Крупный системный шрифт не должен ломать экран, но и растягивать
        // вёрстку бесконечно нельзя (чек-лист DEV-08 §6 п.8)
        //
        // Направление письма задаём здесь, а не через flutter_localizations:
        // делегаты тянут перевод системных виджетов, которых в экранах нет
        // (DEV-12 правило 3 запрещает Material-иконки и Material-диалоги), а
        // переворачивать раскладку для арабского всё равно нужно всему дереву.
        builder: (context, child) => Directionality(
          textDirection: l10n.direction,
          child: MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.3,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
        // Куда попадает пользователь: вход → выбор контекста → приложение.
        //
        // Слушаем сессию здесь, а не через const-виджет уровнем ниже: Flutter
        // пропускает обновление ребёнка, если новый виджет идентичен старому,
        // а два `const _Root()` — это один и тот же объект. Из-за этого после
        // успешного входа экран оставался на форме входа, хотя сессия уже была.
        //
        // Ключ по языку — та же история, но глубже: корень перестраивал
        // `MaterialApp`, а ниже стояли `const ContextGate` → `const AppShell`
        // → `const HomeScreen`, и Flutter пропускал всё поддерево. Язык в
        // настройках менялся, а главная оставалась на прежнем. Ключ заставляет
        // пересобрать дерево — на переключении языка это и нужно, а происходит
        // оно раз в жизни аккаунта.
        home: KeyedSubtree(
          key: ValueKey(l10n.code),
          child: ListenableBuilder(
            listenable: session,
            builder: (context, _) => session.signedIn ? const ContextGate() : const LoginFlow(),
          ),
        ),
      ),
    );
  }
}
