import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import 'blocks.dart';

/// Выбор языка — один лист на всё приложение.
///
/// Языков десять, и семь из них не лежат в сборке: они приезжают с сервера
/// при первом выборе (см. `L10n`). Отсюда всё поведение этого листа —
/// строка «нужна сеть» рядом с такими языками, крутилка на нажатой строке,
/// и сообщение об ошибке вместо молчаливого возврата к прежнему языку.
///
/// Лист один на экран входа и на профиль намеренно: язык ищут дважды — при
/// первом запуске и потом в настройках, — и оба раза он должен выглядеть
/// одинаково, иначе второй поиск начинается заново.
///
/// [onChanged] зовётся только при удавшейся смене: в профиле язык уходит
/// ещё и в учётную запись, а на экране входа отправлять его некуда.
Future<void> showLanguageSheet(
  BuildContext context, {
  Future<void> Function(String code)? onChanged,
}) async {
  await showSozoSheet<void>(
    context,
    title: t('c30.language'),
    child: _LanguageSheetBody(onChanged: onChanged),
  );
  l10n.clearError(); // закрыли лист — сообщение о неудаче больше не к месту
}

class _LanguageSheetBody extends StatefulWidget {
  const _LanguageSheetBody({this.onChanged});

  final Future<void> Function(String code)? onChanged;

  @override
  State<_LanguageSheetBody> createState() => _LanguageSheetBodyState();
}

class _LanguageSheetBodyState extends State<_LanguageSheetBody> {
  /// Язык, который сейчас качается. Держим здесь, а не только в `L10n`:
  /// лист должен погасить остальные строки, пока идёт загрузка, иначе
  /// человек нажмёт второй язык поверх первого и получит две гонки
  String? _busy;

  Future<void> _pick(String code) async {
    if (_busy != null || code == l10n.code) return;
    setState(() => _busy = code);
    final ok = await l10n.set(code);
    if (!mounted) return;
    setState(() => _busy = null);
    if (!ok) return; // текст ошибки покажет `l10n.status`, лист остаётся открытым
    await widget.onChanged?.call(code);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    // Перерисовка по `l10n`: пока лист открыт, меняются и подписи (после
    // успешной смены), и состояние ошибки
    return ListenableBuilder(
      listenable: l10n,
      builder: (context, _) => SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (l10n.status == LocaleStatus.failed)
              Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                child: Text(
                  t('c30.langFailed'),
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.4,
                    color: SozoColors.error,
                  ),
                ),
              ),
            for (final code in L10n.codes)
              Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                child: _LanguageRow(
                  code: code,
                  current: code == l10n.code,
                  busy: _busy == code,
                  // Пока один язык качается, остальные не нажимаются: две
                  // загрузки подряд закончились бы тем, что применится не та
                  enabled: _busy == null,
                  onTap: () => _pick(code),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LanguageRow extends StatelessWidget {
  const _LanguageRow({
    required this.code,
    required this.current,
    required this.busy,
    required this.enabled,
    required this.onTap,
  });

  final String code;
  final bool current;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = L10n.names[code] ?? code;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SecondaryButton(
          busy ? t('c30.langLoading') : name,
          icon: current ? 'check' : null,
          busy: busy,
          onTap: enabled ? onTap : null,
        ),
        // Подпись «нужна сеть» — только у тех языков, которых ещё нет на
        // устройстве. У скачанного она сбивала бы с толку: он уже работает
        // без сети, как встроенный
        if (L10n.isRemote(code) && !current && !busy)
          Padding(
            padding: const EdgeInsets.only(top: 2, left: SozoSpace.s12),
            child: Text(
              t('c30.langNeedsNetwork'),
              style: const TextStyle(fontSize: 11, color: SozoColors.textTertiary),
            ),
          ),
      ],
    );
  }
}
