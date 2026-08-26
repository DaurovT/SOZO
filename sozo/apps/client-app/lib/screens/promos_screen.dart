import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';

/// Промокоды клиента.
///
/// Кошелёк, а не витрина акций: человек кладёт сюда код, который где-то
/// услышал, и дальше не держит его в голове — при оплате код уже под рукой.
/// Раньше ввести код можно было ровно в одном месте, на последнем шаге
/// оформления: услышал в рекламе — записывай на бумажку до следующей заявки.
class PromosScreen extends StatefulWidget {
  const PromosScreen({super.key});

  @override
  State<PromosScreen> createState() => _PromosScreenState();
}

class _PromosScreenState extends State<PromosScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();

  Future<void> _add(String code) async {
    if (code.trim().isEmpty) return;
    try {
      final r = await session.api.addPromo(code.trim());
      if (mounted) showSozoToast(context, (r['message'] as String?) ?? t('promo.saved'));
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    }
  }

  Future<void> _askCode() async {
    final ctrl = TextEditingController();
    final code = await showSozoPrompt(
      context,
      title: t('promo.add'),
      hint: t('promo.hint'),
      controller: ctrl,
      confirmLabel: t('common.apply'),
    );
    ctrl.dispose();
    if (code != null) await _add(code);
  }

  Future<void> _remove(String code) async {
    try {
      await session.api.removePromo(code);
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('promo.title'), titleSize: 18),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          key: _key,
          load: () => session.api.promos(),
          builder: (context, data, reload) {
            final items = ((data['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final welcome = data['welcome'] as Map<String, dynamic>?;
            return ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s32),
              children: [
                // Приветственный код показываем сами, а не ждём, что человек
                // его где-то найдёт: скидка, о которой не сказали, никого
                // не приводит
                // Код без строки — не карточка: `as String` на пустом поле
                // ронял весь экран кошелька
                if (welcome != null && (welcome['code'] as String?)?.isNotEmpty == true) ...[
                  _WelcomeCard(
                    code: welcome['code'] as String,
                    percent: (welcome['discountPercent'] as num?)?.toInt() ?? 0,
                    onSave: () => _add(welcome['code'] as String),
                  ),
                  const SizedBox(height: SozoSpace.s16),
                ],

                SecondaryButton(t('promo.add'), icon: 'plus', onTap: _askCode),
                const SizedBox(height: SozoSpace.s16),

                if (items.isEmpty && welcome == null)
                  EmptyState(icon: 'star', text: t('promo.empty'))
                else
                  for (final p in items) ...[
                    _PromoCard(promo: p, onRemove: () => _remove('${p['code'] ?? ''}')),
                    const SizedBox(height: SozoSpace.s8),
                  ],

                const SizedBox(height: SozoSpace.s8),
                Text(
                  (data['note'] as String?) ?? '',
                  style: const TextStyle(fontSize: 12, color: authHint),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Предложение приветственного кода — единственное место, где мы что-то дарим,
/// поэтому карточка янтарная, а не белая как остальные
class _WelcomeCard extends StatelessWidget {
  const _WelcomeCard({required this.code, required this.percent, required this.onSave});

  final String code;
  final int percent;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: SozoColors.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: SozoColors.accent.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('star', size: 20, color: SozoColors.accent),
              const SizedBox(width: SozoSpace.s8),
              Expanded(
                child: Text(
                  t('promo.welcomeTitle', {'percent': percent}),
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
          Text(
            t('promo.welcomeText', {'code': code, 'percent': percent}),
            style: const TextStyle(fontSize: 13, height: 1.35, color: authInk),
          ),
          const SizedBox(height: SozoSpace.s12),
          PrimaryButton(t('promo.welcomeSave'), onTap: onSave),
        ],
      ),
    );
  }
}

class _PromoCard extends StatelessWidget {
  const _PromoCard({required this.promo, required this.onRemove});

  final Map<String, dynamic> promo;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final used = promo['usedAt'] != null;
    final usable = promo['usable'] == true;
    return SozoCard(
      radius: SozoRadius.tile,
      gap: SozoSpace.s4,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                (promo['code'] as String?) ?? '',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2,
                  // Потраченный код читается бледнее: он уже не предложение,
                  // а запись в истории
                  color: usable ? authInk : SozoColors.textTertiary,
                ),
              ),
            ),
            if (used)
              TagChip(t('promo.used'))
            else if (usable)
              TagChip(
                t('promo.discount', {'percent': promo['discountPercent']}),
                bg: SozoColors.accent.withValues(alpha: 0.16),
                fg: authInk,
              ),
          ],
        ),
        Text(
          (promo['note'] as String?) ?? '',
          style: const TextStyle(fontSize: 13, color: authHint),
        ),
        if (promo['firstOrderOnly'] == true && !used)
          Text(
            t('promo.firstOnly'),
            style: const TextStyle(fontSize: 12, color: authHint),
          ),
        if (!used)
          Align(
            alignment: Alignment.centerRight,
            child: TextAction(t('promo.remove'), onTap: onRemove),
          ),
      ],
    );
  }
}
