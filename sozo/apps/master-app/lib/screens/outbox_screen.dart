import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../i18n.dart';

/// Очередь отправки (M-40). Мастер должен видеть, что именно не ушло —
/// иначе «всё сохранилось» превращается в необоснованную веру.
class OutboxScreen extends StatefulWidget {
  const OutboxScreen({super.key});

  @override
  State<OutboxScreen> createState() => _OutboxScreenState();
}

class _OutboxScreenState extends State<OutboxScreen> {
  @override
  Widget build(BuildContext context) {
    final outbox = session.outbox;
    return Scaffold(
      appBar: SozoAppBar(title: t('sync.ocheredOtpravki')),
      body: AnimatedBuilder(
        animation: outbox,
        builder: (context, _) {
          if (outbox.ops.isEmpty) {
            return EmptyView(
              title: t('sync.vseOtpravleno'),
              subtitle: t('sync.operaciiUhodyatSrazuEsli'),
              icon: 'check-square',
            );
          }
          return ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              if (outbox.hasBlocked)
                Padding(
                  padding: EdgeInsets.only(bottom: SozoSpace.s16),
                  child: BlockerNote(text: t('sync.odnaIzOperaciyOtvergnuta')),
                ),
              ...outbox.ops.map(
                (op) => Padding(
                  padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                  child: SozoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            FigmaIcon(
                              op.lastError != null ? 'alert-circle' : 'clock',
                              size: 18,
                              color: op.lastError != null ? SozoColors.error : SozoColors.textSecondary,
                            ),
                            const SizedBox(width: SozoSpace.s8),
                            Expanded(
                              child: Text(
                                op.title.isEmpty ? op.kind : op.title,
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: SozoSpace.s4),
                        Text(
                          t('sync.snyatoNaUstroystve', {
                            'p1': op.deviceTime.length >= 19
                                ? op.deviceTime.substring(0, 19).replaceAll('T', ' ')
                                : op.deviceTime,
                          }),
                          style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                        ),
                        if (op.lastError != null) ...[
                          const SizedBox(height: SozoSpace.s8),
                          Text(
                            op.lastError!,
                            style: const TextStyle(fontSize: 13, color: SozoColors.error, height: 1.35),
                          ),
                          const SizedBox(height: SozoSpace.s8),
                          // «Повторить» стоит первой: у застрявшей операции
                          // единственной кнопкой было «убрать», то есть стереть
                          // работу за день. Половина причин — временные
                          // (сессия, шлюз, слишком большой пакет)
                          PrimaryButton(
                            label: t('sync.povtorit'),
                            busy: outbox.syncing,
                            onPressed: () => outbox.retry(op.clientOpUuid),
                          ),
                          const SizedBox(height: SozoSpace.s8),
                          SecondaryButton(
                            label: t('sync.ubratIzOcheredi'),
                            onPressed: () async {
                              final ok = await showDialog<bool>(
                                context: context,
                                builder: (ctx) => AlertDialog(
                                  title: Text(t('sync.ubratOperaciyu')),
                                  content: Text(t('sync.dannyeNeVosstanovyatsyaShag')),
                                  actions: [
                                    TextButton(
                                      onPressed: () => Navigator.of(ctx).pop(false),
                                      child: Text(t('common.otmena')),
                                    ),
                                    FilledButton(
                                      onPressed: () => Navigator.of(ctx).pop(true),
                                      child: Text(t('sync.ubrat')),
                                    ),
                                  ],
                                ),
                              );
                              if (ok == true) await outbox.drop(op.clientOpUuid);
                            },
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
              PrimaryButton(
                label: t('sync.otpravitSeychas'),
                busy: outbox.syncing,
                onPressed: () async {
                  final r = await outbox.flush();
                  if (!context.mounted) return;
                  if (r.applied > 0) {
                    showOk(context, t('sync.otpravleno', {'p1': r.applied}));
                  } else if (r.failed > 0) {
                    showError(context, t('sync.serverNePrinyalOperaciy', {'p1': r.failed}));
                  } else {
                    showError(context, t('sync.svyaziVseEscheNet'));
                  }
                },
              ),
            ],
          );
        },
      ),
    );
  }
}
