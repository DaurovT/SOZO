import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'b2b/org_screens.dart';
import 'b2b/phase2_screens.dart';
import 'complaints_screen.dart';
import 'order_screen.dart';

/// Лента уведомлений.
///
/// Без неё человек узнаёт новости, только если сам откроет заявку, — а мастер
/// в это время стоит и ждёт подтверждения. Пуши появятся с FCM, но лента
/// нужна и с ними: пуш пропускают, лента остаётся.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();

  Future<void> _markAll() async {
    try {
      await session.api.markNotificationsRead();
      await session.refreshMe();
    } on ApiError catch (e) {
      if (!mounted) return;
      showSozoToast(context, e.message);
    }
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    // Не вкладка, а отдельный экран под колокольчиком: значит нужна стрелка
    // назад — без неё из ленты некуда деться
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(
        title: t('notif.title'),
        titleSize: 18,
        // Кнопка «прочитано» янтарная, как «назад» (249:15)
        action: SozoAppBarAction(icon: 'check-done', filled: true, onTap: _markAll),
      ),
      body: AsyncView<Map<String, dynamic>>(
        key: _key,
        load: () => session.api.notifications(),
        builder: (context, data, reload) {
          final items = ((data['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
          if (items.isEmpty) {
            return EmptyState(icon: 'bell', text: t('notif.empty'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s32),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s8),
            itemBuilder: (context, i) => _row(context, items[i], reload),
          );
        },
      ),
    );
  }

  Widget _row(BuildContext context, Map<String, dynamic> n, Future<void> Function() reload) {
    final read = n['read'] == true;
    final actionable = n['actionable'] == true;

    return SozoCard(
      // Непрочитанное обведено янтарным на 40% (249:18) — чтобы не пролистать
      border: read ? null : SozoColors.accent.withValues(alpha: 0.4),
      onTap: () async {
        await session.api.markNotificationsRead(ids: [n['id'] as String]);
        final target = _target(n);
        if (target != null && context.mounted) {
          await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => target));
        }
        await session.refreshMe();
        await reload();
      },
      gap: SozoSpace.s4,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Значок в квадратной плитке 40 (249:19), а не сам по себе
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: SozoColors.accent.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              alignment: Alignment.center,
              child: FigmaIcon(
                _icon(n['kind'] as String?),
                size: 20,
                color: _color(n['kind'] as String?, actionable),
              ),
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (n['title'] as String?) ?? '',
                    style: TextStyle(
                      fontSize: 15,
                      // Непрочитанное — жирнее: это единственное отличие,
                      // которое читается боковым зрением при пролистывании
                      fontWeight: read ? FontWeight.w500 : FontWeight.w700,
                      color: authInk,
                    ),
                  ),
                  if ((n['body'] as String?)?.isNotEmpty ?? false) ...[
                    const SizedBox(height: 2),
                    Text(
                      (n['body'] as String?) ?? '',
                      style: const TextStyle(fontSize: 13, height: 1.35, color: authHint),
                    ),
                  ],
                  const SizedBox(height: SozoSpace.s4),
                  Text(
                    '${relativeDay(n['at'])} ${hhmm(n['at'])}',
                    style: const TextStyle(fontSize: 12, color: authHint),
                  ),
                ],
              ),
            ),
            if (!read)
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: SozoSpace.s4),
                decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
              ),
          ],
        ),
      ],
    );
  }

  /// Куда ведёт уведомление.
  ///
  /// Заявка — самый частый случай, но не единственный: акт осмотра, жалоба и
  /// счёт заявки не имеют, и раньше тап по ним только помечал прочитанным —
  /// тупик на восьмой части ленты. Цель зашита в сам идентификатор
  /// (`act:…`, `complaint:…`, `invoice:…`), им и пользуемся.
  static Widget? _target(Map<String, dynamic> n) {
    final orderId = n['orderId'] as String?;
    if (orderId != null) return OrderScreen(orderId: orderId);
    final id = (n['id'] as String?) ?? '';
    if (id.startsWith('act:')) return const DefectPackageScreen();
    if (id.startsWith('complaint:')) return const ComplaintsScreen();
    if (id.startsWith('invoice:')) return const OrgFinanceScreen();
    return null;
  }

  static String _icon(String? kind) => switch (kind) {
        'decision' => 'alert-circle',
        'money' => 'credit-card',
        'warranty' => 'shield-check',
        'complaint' => 'megaphone',
        'site' => 'clipboard',
        _ => 'bell',
      };

  static Color _color(String? kind, bool actionable) {
    if (kind == 'decision') return SozoColors.error;
    if (kind == 'money') return SozoColors.warning;
    if (kind == 'warranty') return SozoColors.success;
    return actionable ? SozoColors.accent : SozoColors.textSecondary;
  }
}
