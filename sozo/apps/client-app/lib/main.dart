import 'dart:async';

import 'package:flutter/material.dart';

import 'design_tokens.dart';
import 'i18n.dart';
import 'push/deep_link.dart';
import 'screens/context_screen.dart';
import 'screens/login_screen.dart';
import 'store/session.dart';
import 'widgets/figma_icon.dart';

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

/// Ключ ScaffoldMessenger — тем же способом показывается уведомление,
/// пришедшее при открытом приложении: экрана-получателя у него нет.
final messengerKey = GlobalKey<ScaffoldMessengerState>();

/// Открыть экран по ссылке из уведомления, дождавшись навигатора.
///
/// Ссылка из холодного старта приходит раньше первого кадра: `_startPush`
/// работает параллельно с `runApp`, и `navigatorKey.currentState` в этот
/// момент ещё null. Прежний код в таком случае просто ничего не делал —
/// человек, ткнувший в «смета готова, подтвердите», попадал на главную.
///
/// Ждём следующий кадр и пробуем снова. Не бесконечно: если навигатора нет
/// и через секунду, значит приложение не поднялось, и настаивать не на чем.
void _openWhenReady(String link, {int attempt = 0}) {
  final nav = navigatorKey.currentState;
  if (nav != null) {
    // Не вошедшему открывать нечего: экраны заявки требуют сессии, а вход
    // человек всё равно пройдёт — и увидит ту же заявку на главной
    if (session.signedIn) unawaited(openDeepLink(nav, link));
    return;
  }
  if (attempt >= 20) return;
  WidgetsBinding.instance.addPostFrameCallback((_) => _openWhenReady(link, attempt: attempt + 1));
}

/// Поднять канал уведомлений и связать его с навигацией.
///
/// Если человек уже вошёл, устройство регистрируется сразу: сессия живёт
/// между запусками, а токен поставщик меняет когда захочет.
Future<void> _startPush() async {
  await session.push.init();
  session.push.onDeepLink = _openWhenReady;
  // Уведомление, пришедшее при открытом приложении. Обработчик объявлен в
  // PushService с самого начала, но никогда не присваивался: iOS баннер на
  // переднем плане не показывает, Android показывает не всегда, и «мастер
  // выехал» человек узнавал из опроса раз в двадцать секунд — или не узнавал.
  //
  // Плашка, а не диалог: она не перекрывает экран, с которым человек работает,
  // и уводит по той же ссылке, что и тап по системному уведомлению
  session.push.onForeground = (title, body, deepLink) {
    final messenger = messengerKey.currentState;
    if (messenger == null) return;
    final text = [title, body].where((s) => s.trim().isNotEmpty).join(' · ');
    if (text.isEmpty) return;
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const FigmaIcon('bell', size: 18, color: SozoColors.surface),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Text(text, style: const TextStyle(fontSize: 14, color: SozoColors.surface)),
            ),
          ],
        ),
        backgroundColor: toastBg,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(SozoSpace.s16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.field)),
        duration: const Duration(seconds: 6),
        action: deepLink == null || deepLink.isEmpty
            ? null
            : SnackBarAction(
                label: t('common.open'),
                textColor: SozoColors.accent,
                onPressed: () => _openWhenReady(deepLink),
              ),
      ),
    );
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
        scaffoldMessengerKey: messengerKey,
        title: 'SOZO',
        theme: sozoTheme(),
        debugShowCheckedModeBanner: false,
        // Крупный системный шрифт не должен ломать экран, но и растягивать
        // вёрстку бесконечно нельзя (чек-лист DEV-08 §6 п.8).
        //
        // Потолок 1.6, а не 1.3: 1.3 — это меньше, чем ставит себе человек,
        // которому трудно читать, и приложение молча отказывалось выполнять
        // его настройку. Экраны собраны на Column и Wrap с переносом, крупный
        // шрифт им не страшен; жёсткие высоты подняты вместе с этим потолком
        //
        // Направление письма задаём здесь, а не через flutter_localizations:
        // делегаты тянут перевод системных виджетов, которых в экранах нет
        // (DEV-12 правило 3 запрещает Material-иконки и Material-диалоги), а
        // переворачивать раскладку для арабского всё равно нужно всему дереву.
        builder: (context, child) => Directionality(
          textDirection: l10n.direction,
          child: MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.6,
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
