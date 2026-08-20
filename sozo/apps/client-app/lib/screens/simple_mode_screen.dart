import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';

/// C-57. Простой режим (PRD-01 §3.N, DEV-15 §10.3.1).
///
/// Режим внутри того же приложения, а не вторая сборка: две сборки клиента
/// одна команда не потянет.
///
/// Правила режима жёсткие и намеренные: не больше трёх действий на экране,
/// шрифт от 20, цель нажатия 64, статусы словами, только тапы. Телефонные
/// кнопки работают без сети и без авторизации — это tel:, а не запрос к API.
class SimpleModeScreen extends StatelessWidget {
  const SimpleModeScreen({super.key});

  static const _minTarget = 64.0;
  static const _bigButton = 104.0;

  Future<void> _call(String phone) async {
    if (phone.isEmpty) return;
    await launchUrl(Uri.parse('tel:$phone'));
  }

  @override
  Widget build(BuildContext context) {
    final name = session.fullName;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(SozoSpace.s24),
          children: [
            const SizedBox(height: SozoSpace.s16),
            Text(
              name.isEmpty ? t('simple.zdravstvuyte') : t('simple.zdravstvuyteImya', {'p1': name}),
              style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w600, height: 1.3),
            ),
            const SizedBox(height: SozoSpace.s32),

            _bigAction(
              label: t('simple.vyzvatMastera'),
              icon: 'phone',
              background: SozoColors.accent,
              foreground: SozoColors.onAccent,
              onTap: () => _call(session.supportPhone ?? ''),
            ),
            const SizedBox(height: SozoSpace.s32),

            _bigAction(
              label: t('simple.avariyaVDome'),
              icon: 'alert-triangle',
              background: SozoColors.surface,
              foreground: SozoColors.error,
              border: SozoColors.error,
              onTap: () => _call(session.buildingEmergencyPhone ?? session.supportPhone ?? ''),
            ),
            const SizedBox(height: SozoSpace.s32),

            Text(t('simple.moiZayavki'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
            const SizedBox(height: SozoSpace.s16),
            for (final o in session.simpleOrders) _orderCard(o),
            if (session.simpleOrders.isEmpty)
              Text(t('simple.zayavokNet'), style: const TextStyle(fontSize: 17, color: SozoColors.textSecondary)),

            const SizedBox(height: SozoSpace.s32),
            Center(
              child: InkWell(
                onTap: () => session.setSimpleMode(false),
                child: Padding(
                  padding: const EdgeInsets.all(SozoSpace.s16),
                  child: Text(
                    t('simple.obychnyyRezhim'),
                    style: const TextStyle(
                      fontSize: 17,
                      color: SozoColors.textSecondary,
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bigAction({
    required String label,
    required String icon,
    required Color background,
    required Color foreground,
    required VoidCallback onTap,
    Color? border,
  }) {
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        child: Container(
          height: _bigButton,
          constraints: const BoxConstraints(minHeight: _minTarget),
          decoration: border == null
              ? null
              : BoxDecoration(
                  borderRadius: BorderRadius.circular(SozoRadius.card),
                  border: Border.all(color: border, width: 2),
                ),
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FigmaIcon(icon, size: 32, color: foreground),
              const SizedBox(width: SozoSpace.s16),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: foreground),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Статус словами, без цветовых кодов и иконок: в этом режиме цвет
  /// не должен нести смысл, который человек может не различить.
  Widget _orderCard(Map<String, dynamic> o) => Padding(
        padding: const EdgeInsets.only(bottom: SozoSpace.s16),
        child: SozoCard(
          padding: const EdgeInsets.all(SozoSpace.s24),
          children: [
            Text('${o['statusWords'] ?? ''}', style: const TextStyle(fontSize: 20)),
            const SizedBox(height: SozoSpace.s8),
            Text('${o['title'] ?? ''}',
                style: const TextStyle(fontSize: 17, color: SozoColors.textSecondary)),
            const SizedBox(height: SozoSpace.s4),
            Text('${o['whenWords'] ?? ''}',
                style: const TextStyle(fontSize: 17, color: SozoColors.textSecondary)),
          ],
        ),
      );
}
