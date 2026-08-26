import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/photo_grid.dart';

/// C-23. Жалобы: список и форма.
class ComplaintsScreen extends StatelessWidget {
  const ComplaintsScreen({super.key, this.orderId, this.orderNumber});

  /// Открыта из карточки заявки — жалоба сразу привязана к ней
  final String? orderId;
  final String? orderNumber;

  @override
  Widget build(BuildContext context) {
    final key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c23.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: AsyncView<Map<String, dynamic>>(
                key: key,
                load: () => session.api.complaints(),
                builder: (context, data, reload) {
                  final items = ((data['complaints'] as List?) ?? const []).cast<Map<String, dynamic>>();
                  if (items.isEmpty) {
                    return EmptyState(icon: 'face', text: (data['empty'] as String?) ?? t('c23.empty'));
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s12),
                    itemBuilder: (context, i) => _card(items[i]),
                  );
                },
              ),
            ),
            StickyFooter(
              children: [
                PrimaryButton(
                  t('c23.new'),
                  onTap: () async {
                    final types = ((await session.api.complaints())['types'] as List? ?? const []).cast<String>();
                    if (!context.mounted) return;
                    final sent = await Navigator.of(context).push<bool>(
                      MaterialPageRoute<bool>(
                        builder: (_) => ComplaintFormScreen(
                          types: types,
                          orderId: orderId,
                          orderNumber: orderNumber,
                        ),
                      ),
                    );
                    if (sent == true) key.currentState?.reload();
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(Map<String, dynamic> c) {
    final status = (c['status'] as String?) ?? 'new';
    return SozoCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                (c['type'] as String?) ?? '',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
            ),
            TagChip(
              switch (status) {
                'in_progress' => t('c23.inProgress'),
                'resolved' => t('c23.resolved'),
                'closed' => t('c23.closed'),
                _ => t('c23.new_'),
              },
              bg: switch (status) {
                'in_progress' => SozoColors.accent.withValues(alpha: 0.16),
                'resolved' || 'closed' => softSuccessBg,
                _ => SozoColors.chipGrey,
              },
              fg: switch (status) {
                'resolved' || 'closed' => softSuccessFg,
                _ => SozoColors.textSecondary,
              },
            ),
          ],
        ),
        Text(
          (c['text'] as String?) ?? '',
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
        ),
        Text(
          [
            dayMonth(c['createdAt']),
            if ((c['orderNumber'] as String?)?.isNotEmpty ?? false) c['orderNumber'],
          ].join(' · '),
          style: const TextStyle(fontSize: 12, color: SozoColors.textTertiary),
        ),
        if ((c['resolution'] as String?)?.isNotEmpty ?? false)
          SozoBanner(icon: 'check-done', tone: BannerTone.success, text: (c['resolution'] as String?) ?? ''),
      ],
    );
  }
}

/// Форма новой жалобы
class ComplaintFormScreen extends StatefulWidget {
  const ComplaintFormScreen({super.key, required this.types, this.orderId, this.orderNumber});

  final List<String> types;
  final String? orderId;
  final String? orderNumber;

  @override
  State<ComplaintFormScreen> createState() => _ComplaintFormScreenState();
}

class _ComplaintFormScreenState extends State<ComplaintFormScreen> {
  final _text = TextEditingController();
  final List<String> _photos = [];
  String? _type;
  bool _busy = false;
  bool _touched = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (_type == null || _text.text.trim().length < 10) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await session.api.fileComplaint({
        'type': _type,
        'text': _text.text.trim(),
        'orderId': widget.orderId,
        'orderNumber': widget.orderNumber,
        'photos': _photos,
      });
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // «Деньги» — это чаще спор, чем жалоба: подсказываем правильный путь
    final moneyType = _type == 'Деньги';
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c23.new')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SectionHeading(t('c23.type')),
                  const SizedBox(height: SozoSpace.s8),
                  for (final ty in widget.types) ...[
                    RadioCard(title: ty, selected: _type == ty, onTap: () => setState(() => _type = ty)),
                    const SizedBox(height: SozoSpace.s8),
                  ],
                  if (_touched && _type == null)
                    Text(t('c23.typeError'), style: const TextStyle(fontSize: 12, color: SozoColors.error)),
                  if (moneyType) ...[
                    const SizedBox(height: SozoSpace.s8),
                    SozoBanner(icon: 'info', tone: BannerTone.warn, text: t('c23.moneyHint')),
                  ],
                  const SizedBox(height: SozoSpace.s12),
                  SozoField(
                    label: t('c23.text'),
                    controller: _text,
                    hint: t('c23.textHint'),
                    maxLines: 5,
                    error: _touched && _text.text.trim().length < 10 ? t('c23.textError') : null,
                    onChanged: (_) => setState(() {}),
                  ),
                  PhotoGrid(
                    photos: [for (final p in _photos) PhotoRef(dataUrl: p)],
                    onAdd: () async {
                      final data = await pickPhoto(context);
                      if (data != null && mounted) setState(() => _photos.add(data));
                    },
                    onRemove: (i) => setState(() => _photos.removeAt(i)),
                  ),
                  if (widget.orderNumber != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(icon: 'link', text: t('c23.linkedTo', {'number': widget.orderNumber})),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
                  ],
                ],
              ),
            ),
            StickyFooter(children: [PrimaryButton(t('common.send'), busy: _busy, onTap: _submit)]),
          ],
        ),
      ),
    );
  }
}
