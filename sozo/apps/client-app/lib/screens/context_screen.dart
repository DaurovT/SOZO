import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'shell.dart';

/// Ворота между входом и приложением: тянут профиль и решают, показывать ли
/// выбор контекста (C-05). Один экран загрузки вместо мигания вкладками.
class ContextGate extends StatefulWidget {
  const ContextGate({super.key});

  @override
  State<ContextGate> createState() => _ContextGateState();
}

class _ContextGateState extends State<ContextGate> {
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await session.refreshMe();
    } on ApiError catch (e) {
      if (e.isUnauthorized) {
        await session.signOut();
        return;
      }
      // Офлайн на старте — не повод не пускать в приложение: экраны покажут кеш
      if (!e.isOffline) {
        if (mounted) setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: SozoColors.bg,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        backgroundColor: SozoColors.bg,
        body: SafeArea(
          child: ErrorState(
            message: _error!,
            onRetry: _load,
            onEditServer: () async {
              await showServerAddressSheet(context);
              await _load();
            },
          ),
        ),
      );
    }
    // Спрашиваем один раз за вход: у личного аккаунта contextId пустой,
    // и по нему нельзя отличить «не выбрал» от «выбрал личный»
    final needChoice = session.contexts.isNotEmpty && !session.contextChosen;
    if (needChoice) return const ContextScreen(canClose: false);
    return const AppShell();
  }
}

/// C-05. Выбор роли/контекста.
class ContextScreen extends StatefulWidget {
  const ContextScreen({super.key, this.canClose = true});

  /// Из профиля экран открывается поверх приложения и закрывается «назад»;
  /// после входа закрывать некуда — выбор обязателен
  final bool canClose;

  @override
  State<ContextScreen> createState() => _ContextScreenState();
}

class _ContextScreenState extends State<ContextScreen> {
  bool _remember = false;

  /// Вход в организацию по коду от руководителя
  Future<void> _enterInvite() async {
    final ctrl = TextEditingController();
    final code = await showSozoPrompt(
      context,
      title: t('c05.inviteTitle'),
      hint: t('c05.inviteHint'),
      controller: ctrl,
      confirmLabel: t('common.next'),
    );
    ctrl.dispose();
    if (code == null || code.trim().isEmpty || !mounted) return;
    try {
      final res = await session.api.acceptInvite(code.trim());
      await session.refreshMe();
      if (!mounted) return;
      setState(() {});
      showSozoToast(
        context,
        t('c05.inviteJoined', {'org': res['organization'] ?? '', 'loc': res['location'] ?? ''}),
      );
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    }
  }

  Future<void> _pick(String? id) async {
    await session.setContext(id, remember: _remember);
    // Смена контекста пересобирает таббар: третья вкладка новой роли —
    // не та же, что была у старой, и оставлять индекс нельзя
    shellTab.value = 0;
    if (!mounted) return;
    if (widget.canClose) {
      Navigator.of(context).pop();
    } else {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const AppShell()),
        (_) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final contexts = session.contexts;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c05.title'), showBack: widget.canClose),
      body: SafeArea(
        child: contexts.isEmpty && !widget.canClose
            ? EmptyState(
                icon: 'user-x',
                text: t('c05.emptyTitle'),
                actionLabel: t('c05.callSupport'),
                onAction: () {},
              )
            : ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  _card(
                    icon: 'user',
                    title: t('c05.personal'),
                    subtitle: t('c05.personalSub'),
                    selected: session.contextId == null,
                    onTap: () => _pick(null),
                  ),
                  for (final c in contexts) ...[
                    const SizedBox(height: SozoSpace.s12),
                    _card(
                      icon: _iconFor(c['role'] as String?),
                      title: (c['title'] as String?) ?? '',
                      subtitle: _roleLabel(c['role'] as String?),
                      selected: session.contextId == c['id'],
                      badge: (c['pending'] as num?)?.toInt() ?? 0,
                      onTap: () => _pick(c['id'] as String),
                    ),
                  ],
                  const SizedBox(height: SozoSpace.s16),
                  // Вход по коду — здесь, а не в профиле: человек с кодом ещё
                  // ни в какой организации не состоит, и профиль ему ничего
                  // про организации не покажет
                  SecondaryButton(t('c05.haveInvite'), onTap: _enterInvite),
                  const SizedBox(height: SozoSpace.s16),
                  SozoCard(
                    children: [
                      SwitchRow(
                        title: t('c05.remember'),
                        value: _remember,
                        onChanged: (v) => setState(() => _remember = v),
                      ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }

  String _iconFor(String? role) => switch (role) {
        'site_manager' => 'shopping-bag',
        'org_manager' => 'users',
        'owner' => 'shield',
        _ => 'user',
      };

  String _roleLabel(String? role) => switch (role) {
        'site_manager' => t('c05.roleSiteManager'),
        'org_manager' => t('c05.roleOrgManager'),
        'owner' => t('c05.roleOwner'),
        _ => t('c05.roleStaff'),
      };

  Widget _card({
    required String icon,
    required String title,
    required String subtitle,
    required bool selected,
    required VoidCallback onTap,
    int badge = 0,
  }) {
    return SozoCard(
      onTap: onTap,
      border: selected ? SozoColors.accent : null,
      children: [
        Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: SozoColors.accent.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(SozoRadius.tile),
              ),
              child: Center(child: FigmaIcon(icon, size: 22, color: SozoColors.text)),
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                  ),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                ],
              ),
            ),
            if (badge > 0)
              TagChip('$badge', bg: SozoColors.accent.withValues(alpha: 0.18), fg: SozoColors.text),
          ],
        ),
      ],
    );
  }
}
