import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/photo_grid.dart';

/// C-22. Спор по заявке.
///
/// Последствие названо до отправки: спор замораживает расчёты. Клиент должен
/// понимать, что это не «пожаловаться», а формальная процедура.
class DisputeScreen extends StatefulWidget {
  const DisputeScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  State<DisputeScreen> createState() => _DisputeScreenState();
}

class _DisputeScreenState extends State<DisputeScreen> {
  final _description = TextEditingController();
  final List<String> _photos = [];
  String? _reason;
  List<String> _reasons = const [];
  bool _busy = false;
  bool _touched = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadReasons();
  }

  Future<void> _loadReasons() async {
    try {
      final d = await session.api.dictionaries();
      if (mounted) setState(() => _reasons = ((d['disputeReasons'] as List?) ?? const []).cast<String>());
    } on ApiError {
      // Справочник причин не загрузился — экран остаётся рабочим с полем описания
    }
  }

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (_reason == null || _description.text.trim().length < 10) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await session.api.dispute(widget.order['id'] as String, {
        'reason': _reason,
        'description': _description.text.trim(),
        'photos': _photos,
      });
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c22.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SozoCard(
                    children: [
                      Text(
                        (widget.order['number'] as String?) ?? '',
                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                      MoneyRow(
                        label: t('c22.orderTotal'),
                        amount: soums(
                          ((widget.order['totalFromTiyin'] as num?)?.toInt() ?? 0) +
                              ((widget.order['totalMaterialTiyin'] as num?)?.toInt() ?? 0),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),
                  SectionHeading(t('c22.reason')),
                  const SizedBox(height: SozoSpace.s8),
                  for (final r in _reasons) ...[
                    RadioCard(
                      title: r,
                      selected: _reason == r,
                      onTap: () => setState(() => _reason = r),
                    ),
                    const SizedBox(height: SozoSpace.s8),
                  ],
                  if (_touched && _reason == null)
                    Text(t('c22.reasonError'), style: const TextStyle(fontSize: 12, color: SozoColors.error)),
                  const SizedBox(height: SozoSpace.s12),
                  SozoField(
                    label: t('c22.description'),
                    controller: _description,
                    hint: t('c22.descriptionHint'),
                    maxLines: 4,
                    error: _touched && _description.text.trim().length < 10 ? t('c22.descriptionError') : null,
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
                  const SizedBox(height: SozoSpace.s16),
                  SozoBanner(icon: 'info', text: t('c22.consequence')),
                  if (_error != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
                  ],
                ],
              ),
            ),
            StickyFooter(children: [PrimaryButton(t('c22.submit'), busy: _busy, onTap: _submit)]),
          ],
        ),
      ),
    );
  }
}
