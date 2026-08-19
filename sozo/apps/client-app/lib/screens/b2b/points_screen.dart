import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';

/// C-49. Мои баллы и ваучеры.
///
/// Ваучер показывается QR-кодом на весь экран: на кассе его сканируют,
/// а не переписывают код руками.
class PointsScreen extends StatelessWidget {
  const PointsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c49.title')),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          load: () => session.api.points(),
          builder: (context, data, reload) {
            if (data['enabled'] != true) {
              return EmptyState(icon: 'star', text: t('c49.disabled'));
            }
            final vouchers = ((data['vouchers'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final history = ((data['history'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final balance = (data['balanceTiyin'] as num?)?.toInt() ?? 0;
            final next = (data['nextThresholdTiyin'] as num?)?.toInt();
            final toNext = (data['toNextTiyin'] as num?)?.toInt();

            return ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                SozoCard(
                  children: [
                    Text(
                      soums(balance),
                      style: const TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w700,
                        color: SozoColors.text,
                        fontFeatures: moneyFeatures,
                      ),
                    ),
                    if (next != null) ...[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(SozoRadius.badge),
                        child: LinearProgressIndicator(
                          value: (balance / next).clamp(0.0, 1.0),
                          minHeight: 8,
                          backgroundColor: trackGrey,
                          valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
                        ),
                      ),
                      Text(
                        t('c49.toNext', {'sum': soums(toNext), 'voucher': soums(next)}),
                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                    ],
                    // Отрицательный баланс — сторно за отменённую заявку
                    if (balance < 0)
                      Text(t('c49.negative'), style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                  ],
                ),

                if (vouchers.isNotEmpty) ...[
                  const SizedBox(height: SozoSpace.s24),
                  SectionHeading(t('c49.vouchers')),
                  const SizedBox(height: SozoSpace.s8),
                  for (final v in vouchers) ...[
                    SozoCard(
                      onTap: v['expired'] == true ? null : () => _showQr(context, v),
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                (v['code'] as String?) ?? '',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                              ),
                            ),
                            TagChip(
                              v['expired'] == true ? t('c49.expired') : t('c49.active'),
                              bg: v['expired'] == true ? SozoColors.chipGrey : softSuccessBg,
                              fg: v['expired'] == true ? SozoColors.textSecondary : softSuccessFg,
                            ),
                          ],
                        ),
                        MoneyRow(
                          label: t('c49.until', {'date': dayMonth(v['expiresAt'])}),
                          amount: soums(v['nominalTiyin']),
                          bold: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: SozoSpace.s8),
                  ],
                ],

                const SizedBox(height: SozoSpace.s24),
                SectionHeading(t('c49.history')),
                const SizedBox(height: SozoSpace.s8),
                if (history.isEmpty)
                  SozoCard(
                    children: [
                      Text(
                        (data['empty'] as String?) ?? '',
                        style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                      ),
                    ],
                  )
                else
                  SozoCard(
                    gap: SozoSpace.s8,
                    children: [
                      for (final h in history)
                        MoneyRow(
                          label: (h['note'] as String?) ?? '',
                          sub: dayMonth(h['at']),
                          amount: soums(h['amountTiyin']),
                          color: ((h['amountTiyin'] as num?) ?? 0) < 0 ? SozoColors.textSecondary : SozoColors.success,
                        ),
                    ],
                  ),

                const SizedBox(height: SozoSpace.s16),
                SozoBanner(icon: 'info', text: (data['rules'] as String?) ?? ''),
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _showQr(BuildContext context, Map<String, dynamic> voucher) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => Scaffold(
          backgroundColor: SozoColors.surface,
          appBar: SozoAppBar(title: (voucher['code'] as String?) ?? ''),
          body: SafeArea(
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Чёрный на белом: сканеру на кассе нужен максимальный контраст
                  Container(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    color: SozoColors.surface,
                    child: QrImageView(
                      data: (voucher['code'] as String?) ?? '',
                      size: 240,
                      backgroundColor: SozoColors.surface,
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s24),
                  Text(
                    soums(voucher['nominalTiyin']),
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: SozoColors.text,
                      fontFeatures: moneyFeatures,
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  Text(
                    t('c49.showAtCheckout'),
                    style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
