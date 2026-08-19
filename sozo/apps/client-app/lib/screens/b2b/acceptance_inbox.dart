import 'package:flutter/material.dart';

import '../../design_tokens.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../shell.dart';
import 'acceptance_screen.dart';

/// Что ждёт приёмки на точке.
///
/// Отдельной вкладкой у сотрудника, потому что это его главная обязанность:
/// мастер закончил и стоит рядом, а подтвердить работу может только человек
/// с точки. Раньше это была карточка на главной, которая уезжала вниз, как
/// только на точке появлялось несколько заявок.
class AcceptanceInboxScreen extends StatelessWidget {
  const AcceptanceInboxScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final locationId = session.contextId;
    if (locationId == null) {
      return TabScaffold(
        title: t('tab.acceptance'),
        child: EmptyState(icon: 'check-square', text: t('c31.noContext')),
      );
    }

    return TabScaffold(
      title: t('tab.acceptance'),
      child: AsyncView<Map<String, dynamic>>(
        load: () => session.api.site(locationId),
        builder: (context, data, reload) {
          final awaiting = ((data['awaitingAcceptance'] as List?) ?? const []).cast<Map<String, dynamic>>();
          if (awaiting.isEmpty) {
            return EmptyState(icon: 'check-done', text: t('c34.inboxEmpty'));
          }
          return ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              SozoBanner(icon: 'info', text: t('c34.inboxNote')),
              const SizedBox(height: SozoSpace.s12),
              for (final o in awaiting) ...[
                SozoCard(
                  border: SozoColors.accent,
                  children: [
                    CardTitle(t('c31.acceptTitle')),
                    Text(
                      [o['number'], o['address']].where((v) => v != null).join(' · '),
                      style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                    ),
                    PrimaryButton(
                      t('c31.acceptOpen'),
                      onTap: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => AcceptanceScreen(orderId: o['id'] as String),
                          ),
                        );
                        await reload();
                      },
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],
            ],
          );
        },
      ),
    );
  }
}
