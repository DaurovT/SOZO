import 'package:flutter/material.dart';

import 'design_tokens.dart';
import 'i18n.dart';
import 'screens/context_screen.dart';
import 'screens/login_screen.dart';
import 'store/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await l10n.load();
  await session.load();
  runApp(const SozoClientApp());
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
        title: 'SOZO',
        theme: sozoTheme(),
        debugShowCheckedModeBanner: false,
        // Крупный системный шрифт не должен ломать экран, но и растягивать
        // вёрстку бесконечно нельзя (чек-лист DEV-08 §6 п.8)
        builder: (context, child) => MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.3,
          child: child ?? const SizedBox.shrink(),
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
