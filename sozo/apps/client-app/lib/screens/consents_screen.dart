import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';

/// C-04. Пересмотр согласий из профиля.
///
/// Согласие на обработку данных здесь только показывается: снять его в один
/// тап нельзя — это остановка обслуживания, и делается она через поддержку.
/// Маркетинг отключается сразу, без диалогов.
class ConsentsScreen extends StatefulWidget {
  const ConsentsScreen({super.key});

  @override
  State<ConsentsScreen> createState() => _ConsentsScreenState();
}

class _ConsentsScreenState extends State<ConsentsScreen> {
  late bool _marketing = ((session.me?['consents'] as Map?)?['marketing'] as bool?) ?? false;
  bool _busy = false;

  bool get _personal => ((session.me?['consents'] as Map?)?['personalData'] as bool?) ?? false;

  Future<void> _setMarketing(bool value) async {
    setState(() {
      _marketing = value;
      _busy = true;
    });
    try {
      await session.api.saveConsents({'marketing': value});
      await session.refreshMe();
      if (mounted) showSozoToast(context, value ? t('c04.subscribed') : t('c04.unsubscribed'));
    } on ApiError catch (e) {
      if (mounted) {
        setState(() => _marketing = !value);
        showSozoToast(context, e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c04.title')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(SozoSpace.s16),
          children: [
            SozoCard(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        t('c04.personal'),
                        style: const TextStyle(fontSize: 15, height: 1.4, color: SozoColors.text),
                      ),
                    ),
                    TagChip(
                      _personal ? t('c04.given') : t('c04.notGiven'),
                      bg: _personal ? softSuccessBg : SozoColors.chipGrey,
                      fg: _personal ? softSuccessFg : SozoColors.textSecondary,
                    ),
                  ],
                ),
                Text(
                  t('c04.withdrawNote'),
                  style: const TextStyle(fontSize: 12, height: 1.4, color: SozoColors.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s12),
            SozoCard(
              children: [
                SwitchRow(
                  title: t('c04.marketing'),
                  subtitle: t('c04.marketingNote'),
                  value: _marketing,
                  onChanged: _busy ? (_) {} : _setMarketing,
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s16),
            SecondaryButton(t('c04.readPolicy'), icon: 'file-text', onTap: () {}),
          ],
        ),
      ),
    );
  }
}
