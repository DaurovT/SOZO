import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../format.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../shell.dart';

/// C-41. Центр утверждений.
///
/// Вынужденные доп-работы и всё, что близко к эскалации, — всегда сверху:
/// порядок здесь не хронологический, а по цене промедления.
class ApprovalsInboxScreen extends StatefulWidget {
  const ApprovalsInboxScreen({super.key, this.asTab = true});

  final bool asTab;

  @override
  State<ApprovalsInboxScreen> createState() => _ApprovalsInboxScreenState();
}

class _ApprovalsInboxScreenState extends State<ApprovalsInboxScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();

  @override
  Widget build(BuildContext context) {
    final body = AsyncView<Map<String, dynamic>>(
      key: _key,
      load: () => session.api.approvals(),
      builder: (context, data, reload) {
        final items = ((data['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
        if (items.isEmpty) {
          return EmptyState(icon: 'check-done', text: (data['empty'] as String?) ?? t('c41.empty'));
        }
        return ListView.separated(
          padding: const EdgeInsets.all(SozoSpace.s16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s12),
          itemBuilder: (context, i) => _card(context, items[i], reload),
        );
      },
    );
    if (!widget.asTab) {
      return Scaffold(
        backgroundColor: SozoColors.bg,
        appBar: SozoAppBar(title: t('c41.title')),
        body: SafeArea(child: body),
      );
    }
    return TabScaffold(title: t('c41.title'), child: body);
  }

  Widget _card(BuildContext context, Map<String, dynamic> item, Future<void> Function() reload) {
    final forced = item['kind'] == 'forced';
    final above = item['aboveMyLimit'] == true;
    final hours = (item['waitingHours'] as num?)?.toInt() ?? 0;
    return SozoCard(
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => ApprovalScreen(item: item)),
        );
        await reload();
      },
      children: [
        Row(
          children: [
            // Flexible на метке: название услуги бывает длинным, и вместе со
            // сроком ожидания строка уезжала за край на 123 точки
            Flexible(
              child: TagChip(
                (item['title'] as String?) ?? '',
                icon: forced ? 'alert-triangle' : null,
                bg: forced ? softDangerBg : SozoColors.chipGrey,
                fg: forced ? softDangerFg : SozoColors.textSecondary,
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Text(
              t('c41.waiting', {'h': plural(hours, 'plural.hours')}),
              style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
            ),
          ],
        ),
        Text(
          (item['locationName'] as String?) ?? '',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
        ),
        Text(
          (item['description'] as String?) ?? '',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
        ),
        MoneyRow(label: (item['number'] as String?) ?? '', amount: soums(item['amountTiyin']), bold: true),
        // Выше своего потолка — решение принимает уровень выше (ТЗ 5.2)
        if (above) SozoBanner(icon: 'lock', tone: BannerTone.warn, text: t('c36.aboveLimit')),
      ],
    );
  }
}

/// C-36. Утверждение сметы или доп-сметы.
class ApprovalScreen extends StatefulWidget {
  const ApprovalScreen({super.key, required this.item});

  final Map<String, dynamic> item;

  @override
  State<ApprovalScreen> createState() => _ApprovalScreenState();
}

class _ApprovalScreenState extends State<ApprovalScreen> {
  String? _variant;
  bool _busy = false;
  String? _error;

  bool get _forced => widget.item['kind'] == 'forced';
  bool get _above => widget.item['aboveMyLimit'] == true;

  List<Map<String, dynamic>> get _variants =>
      ((widget.item['variants'] as List?) ?? const []).cast<Map<String, dynamic>>();

  Future<void> _send(bool approve, {String? confirmationCode}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await session.api.decideApproval(widget.item['orderId'] as String, {
        'approve': approve,
        'variant': _variant,
        'confirmationCode': ?confirmationCode,
      });
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      // Крупная сумма: сервер просит подтвердить личность (F-42). Это не
      // ошибка ввода, а ещё один шаг — показываем поле, а не красный текст
      if (e.code == 'CONFIRMATION_REQUIRED' && confirmationCode == null) {
        if (mounted) setState(() => _busy = false);
        await _confirmIdentity(approve, e.message);
        return;
      }
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmIdentity(bool approve, String message) async {
    final code = TextEditingController();
    final ok = await showSozoSheet<bool>(
      context,
      title: t('c36.confirmTitle'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SozoBanner(icon: 'shield-check', text: message),
            const SizedBox(height: SozoSpace.s12),
            SozoField(
              label: t('c36.confirmLabel'),
              controller: code,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: SozoSpace.s16),
            PrimaryButton(t('c36.confirmSend'), onTap: () => Navigator.of(context).pop(true)),
          ],
        ),
      ),
    );
    if (ok == true) await _send(approve, confirmationCode: code.text.trim());
  }

  Future<void> _decline() async {
    final ok = await showSozoConfirm(
      context,
      title: _forced ? t('c36.declineForcedTitle') : t('c36.declineTitle'),
      text: _forced ? t('c36.declineForcedText') : t('c36.declineText'),
      confirmLabel: t('c36.decline'),
      cancelLabel: t('c15.declineBack'),
      danger: true,
    );
    if (ok) await _send(false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(
        title: t('c36.title'),
        subtitle: (widget.item['title'] as String?) ?? '',
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  // Плашка типа задаёт тон экрана: вынужденную от обычной сметы
                  // нужно отличать с первого взгляда
                  SozoBanner(
                    icon: _forced ? 'alert-triangle' : 'file-text',
                    tone: _forced ? BannerTone.danger : BannerTone.neutral,
                    title: (widget.item['title'] as String?) ?? '',
                    text: _forced ? t('c16.blockText') : t('c36.estimateText'),
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  SozoCard(
                    children: [
                      Text(
                        (widget.item['locationName'] as String?) ?? '',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                      ),
                      Text(
                        (widget.item['number'] as String?) ?? '',
                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                      Text(
                        (widget.item['description'] as String?) ?? '',
                        style: const TextStyle(fontSize: 14, height: 1.4, color: SozoColors.text),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s12),

                  if (_variants.isNotEmpty)
                    for (final v in _variants) ...[
                      RadioCard(
                        title: (v['title'] as String?) ?? '',
                        subtitle: ((v['lines'] as List?) ?? const []).map((l) => (l as Map)['name']).join(', '),
                        trailing: soums(v['totalTiyin']),
                        selected: _variant == v['kind'],
                        onTap: () => setState(() => _variant = v['kind'] as String?),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                    ]
                  else
                    SozoCard(
                      children: [
                        MoneyRow(
                          label: t('c36.total'),
                          amount: soums(widget.item['amountTiyin']),
                          bold: true,
                        ),
                      ],
                    ),

                  if (_above) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(
                      icon: 'lock',
                      tone: BannerTone.warn,
                      title: t('c36.aboveLimitTitle'),
                      text: t('c36.aboveLimitText', {'limit': soums(widget.item['myLimitTiyin'])}),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
                  ],
                ],
              ),
            ),
            StickyFooter(
              children: [
                PrimaryButton(
                  t('c36.approve'),
                  busy: _busy,
                  // Выше потолка кнопка недоступна: сервер всё равно откажет,
                  // и лучше сказать об этом до нажатия
                  onTap: _above || (_variants.isNotEmpty && _variant == null) ? null : () => _send(true),
                ),
                DangerTextButton(t('c36.decline'), onTap: _busy ? null : _decline),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
