import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/external_actions.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';

/// «Как это работает» — обучение, доступное всегда (M-39).
///
/// Раньше единственное объяснение работы жило в воронке кандидата: прошёл
/// её при оформлении — хорошо, не запомнил — второго шанса нет. Экран
/// намеренно локальный: ни сети, ни сервера ему не нужно, открывается в
/// подвале и в подъезде, когда нужнее всего.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('prof.kakEtoRabotaet')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
        children: [
          Text(t('help.intro'), style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary, height: 1.45)),
          const SizedBox(height: SozoSpace.s16),
          _block(icon: 'clock', title: t('help.smena'), text: t('help.smenaText')),
          const SizedBox(height: SozoSpace.s12),
          _block(icon: 'bell', title: t('help.zayavka'), text: t('help.zayavkaText')),
          const SizedBox(height: SozoSpace.s12),
          _steps(),
          const SizedBox(height: SozoSpace.s12),
          _block(icon: 'credit-card', title: t('help.dengi'), text: t('help.dengiText')),
          const SizedBox(height: SozoSpace.s12),
          _block(icon: 'alert-triangle', title: t('help.sboi'), text: t('help.sboiText')),
          const SizedBox(height: SozoSpace.s12),
          _block(icon: 'cloud-off', title: t('help.oflayn'), text: t('help.oflaynText')),
          const SizedBox(height: SozoSpace.s24),
          Text(
            t('help.vopros'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary, height: 1.4),
          ),
          if (session.dispatcherPhone != null) ...[
            const SizedBox(height: SozoSpace.s12),
            Builder(
              builder: (ctx) => SecondaryButton(
                label: t('order.pozvonitDispetcheru'),
                onPressed: () => callNumber(ctx, session.dispatcherPhone),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _block({required String icon, required String title, required String text}) {
    return FigmaCard(
      children: [
        Row(
          children: [
            FigmaIcon(icon, size: 20, color: SozoColors.accent),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        Text(text, style: const TextStyle(fontSize: 15, height: 1.45)),
      ],
    );
  }

  /// Тот же порядок шагов, что и в карточке заявки: мастер должен узнать
  /// на объекте ровно то, что прочитал здесь
  Widget _steps() {
    final steps = [
      t('help.shag1'),
      t('help.shag2'),
      t('help.shag3'),
      t('help.shag4'),
      t('help.shag5'),
      t('help.shag6'),
      t('help.shag7'),
    ];
    return FigmaCard(
      gap: SozoSpace.s16,
      children: [
        Row(
          children: [
            const FigmaIcon('list', size: 20, color: SozoColors.accent),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Text(t('help.poryadok'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        Column(
          children: [
            for (var i = 0; i < steps.length; i++) ...[
              if (i > 0) const SizedBox(height: SozoSpace.s12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: softWarnBg, borderRadius: BorderRadius.circular(12)),
                    child: Text(
                      '${i + 1}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: SozoColors.text),
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(child: Text(steps[i], style: const TextStyle(fontSize: 15, height: 1.4))),
                ],
              ),
            ],
          ],
        ),
      ],
    );
  }
}
