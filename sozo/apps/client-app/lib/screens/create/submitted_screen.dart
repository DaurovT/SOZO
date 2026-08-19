import 'package:flutter/material.dart';

import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/blocks.dart';
import '../../widgets/figma_icon.dart';

/// Момент «заявка принята».
///
/// Без него отправка выглядит как ничего: экран просто сменился на карточку,
/// и человек не понимает, случилось ли что-нибудь. Здесь сказано, что дальше
/// и когда ждать ответа — это снимает половину звонков «а вы приняли?».
class OrderSubmittedScreen extends StatelessWidget {
  const OrderSubmittedScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final emergency = order['urgency'] == 'emergency';
    final window = order['window'] as Map<String, dynamic>?;
    final requested = order['requestedWindow'] as Map<String, dynamic>?;

    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: '', showBack: false),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s24),
                children: [
                  const SizedBox(height: SozoSpace.s24),
                  Center(
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: SozoColors.success.withValues(alpha: 0.14),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: FigmaIcon('check-done', size: 32, color: SozoColors.success),
                      ),
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s24),
                  Text(
                    emergency ? t('submitted.emergencyTitle') : t('submitted.title'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: SozoColors.text),
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  Text(
                    (order['number'] as String?) ?? '',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary),
                  ),
                  const SizedBox(height: SozoSpace.s24),

                  SozoCard(
                    children: [
                      _step(1, t('submitted.step1'), emergency ? t('submitted.step1now') : t('submitted.step1soon')),
                      const SozoDivider(),
                      _step(
                        2,
                        t('submitted.step2'),
                        window != null
                            ? '${relativeDay(window['from'])} ${window['label']}'
                            : (requested?['mode'] == 'waitlist'
                                ? t('submitted.waitlist')
                                : t('submitted.step2hint')),
                      ),
                      const SozoDivider(),
                      _step(3, t('submitted.step3'), t('submitted.step3hint')),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),
                  SozoBanner(icon: 'info', text: t('submitted.note')),
                ],
              ),
            ),
            StickyFooter(
              children: [PrimaryButton(t('submitted.open'), onTap: () => Navigator.of(context).pop())],
            ),
          ],
        ),
      ),
    );
  }

  Widget _step(int n, String title, String hint) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: SozoColors.accent.withValues(alpha: 0.16),
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            '$n',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.text),
          ),
        ),
        const SizedBox(width: SozoSpace.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text)),
              const SizedBox(height: 2),
              Text(hint, style: const TextStyle(fontSize: 13, height: 1.35, color: SozoColors.textSecondary)),
            ],
          ),
        ),
      ],
    );
  }
}
