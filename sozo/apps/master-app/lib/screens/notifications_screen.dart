import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';
import 'order_screen.dart';
import '../i18n.dart';

/// Лента уведомлений (PRD-02 §7).
///
/// Пока push не подключён, это единственное место, где видно всё, что произошло,
/// пока приложение было закрыто. Группировка по дням приходит с сервера:
/// телефон с ушедшими часами показал бы чужие даты.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.notifications();
      if (!mounted) return;
      setState(() {
        _data = r;
        _error = null;
      });
      // Открыл ленту — значит увидел. Помечаем прочитанным сразу, без кнопки.
      if ((r['unread'] as num?) != null && (r['unread'] as num) > 0) {
        await session.api.markNotificationsRead();
        await session.refreshUnread();
      }
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final groups = ((_data?['groups'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: SozoAppBar(title: t('notif.uvedomleniya')),
      body: _data == null
          ? (_error != null
                ? EmptyView(title: t('notif.lentaNedostupna'), subtitle: _error, icon: 'alert-circle')
                : const Center(child: CircularProgressIndicator()))
          : groups.isEmpty
          ? EmptyView(title: t('notif.pokaTiho'), subtitle: t('notif.zdesPoyavyatsyaOfferyResheniya'), icon: 'bell')
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 20, SozoSpace.s16, 40),
                children: [
                  for (final g in groups) ...[
                    Padding(
                      padding: const EdgeInsets.only(left: SozoSpace.s4, bottom: SozoSpace.s4),
                      child: Text(
                        g['label'].toString(),
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
                      ),
                    ),
                    _dayCard(((g['items'] as List?) ?? const []).cast<Map<String, dynamic>>()),
                    const SizedBox(height: SozoSpace.s12),
                  ],
                ],
              ),
            ),
    );
  }

  /// Карточка одного дня (макет 74:19): события внутри разделены линиями,
  /// а не разнесены по отдельным плашкам — так день читается одним куском
  Widget _dayCard(List<Map<String, dynamic>> items) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) ...[
              const SizedBox(height: SozoSpace.s12),
              const FigmaDivider(),
              const SizedBox(height: SozoSpace.s16),
            ],
            _row(items[i]),
          ],
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> n) {
    final kind = n['kind'].toString();
    final unread = n['read'] != true;
    return InkWell(
      onTap: n['orderId'] != null
          ? () => Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: n['orderId'].toString())))
          : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconBadge(_icon(kind), round: true),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  n['title'].toString(),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
                const SizedBox(height: SozoSpace.s4),
                Text(
                  n['body'].toString(),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
                ),
              ],
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Row(
              children: [
                Text(
                  hhmm(n['createdAt']),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
                ),
                // Непрочитанное помечаем точкой: список смешанный, а не «новые сверху»
                if (unread) ...[
                  const SizedBox(width: 6),
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Значок события. В макете здесь эмодзи, но на остальных двадцати экранах
  /// иконки набора — эмодзи выбивался бы и по стилю, и по толщине штриха.
  String _icon(String kind) => switch (kind) {
    'offer' => 'toolbox',
    'offer_expired' => 'alert-circle',
    'order_changed' => 'calendar',
    'departure_reminder' => 'calendar',
    'addwork_resolved' => 'check-square',
    'upsell_answered' => 'sparkles',
    'spare_tier_chosen' => 'wrench',
    'payment' => 'credit-card',
    'tips' => 'star',
    'cash_debt' => 'alert-triangle',
    'payout' => 'banknote',
    'rating_changed' => 'trending-up',
    'complaint' => 'megaphone',
    'appeal_resolved' => 'shield-check',
    'skill_suspended' => 'lock',
    'tomorrow_ready' => 'calendar',
    'onboarding' => 'user',
    _ => 'info',
  };
}

/// Колокольчик со счётчиком непрочитанного — в шапке «Главной»
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key, required this.unread, this.onReturn});

  final int unread;
  final VoidCallback? onReturn;

  @override
  Widget build(BuildContext context) {
    // Геометрия из макета (node 25:210): коробка 40, скругление 20,
    // белый фон, граница #E5E7EB, иконка листом 24
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
          onReturn?.call();
        },
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: SozoColors.border),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const FigmaIcon('bell', size: 24),
              if (unread > 0)
                Positioned(
                  top: 5,
                  right: 5,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: unread > 9 ? 4 : 0),
                    constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                    decoration: BoxDecoration(
                      color: SozoColors.error,
                      borderRadius: BorderRadius.circular(SozoRadius.chip),
                      border: Border.all(color: SozoColors.surface, width: 1.5),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      unread > 99 ? '99+' : '$unread',
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: SozoColors.surface,
                        height: 1.1,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
