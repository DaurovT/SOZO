import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/photo_grid.dart';
import 'order_screen.dart';

/// C-26. Гарантийное обращение — «Проблема вернулась».
///
/// Суммы здесь не показываются вообще: гарантийный выезд бесплатный,
/// и любое число на экране читалось бы как счёт.
class WarrantyScreen extends StatefulWidget {
  const WarrantyScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  State<WarrantyScreen> createState() => _WarrantyScreenState();
}

class _WarrantyScreenState extends State<WarrantyScreen> {
  final _description = TextEditingController();
  final List<String> _photos = [];
  bool _busy = false;
  bool _touched = false;
  String? _error;

  Map<String, dynamic>? _slots;
  String? _slotDate;
  int? _slotStartMin;

  @override
  void initState() {
    super.initState();
    _loadSlots();
  }

  Future<void> _loadSlots() async {
    try {
      final s = await session.api.slots();
      if (mounted) setState(() => _slots = s);
    } on ApiError {
      // Окна — удобство: диспетчер всё равно перезвонит и согласует время
    }
  }

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (_description.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final created = await session.api.warranty(widget.order['id'] as String, {
        'description': _description.text.trim(),
        'photos': _photos,
        'slotDate': _slotDate,
        'slotStartMin': _slotStartMin,
      });
      if (!mounted) return;
      showSozoToast(context, (created['message'] as String?) ?? '');
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created['id'] as String)),
      );
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = ((_slots?['days'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c26.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SozoBanner(
                    icon: 'shield-check',
                    tone: BannerTone.success,
                    title: t('c26.freeTitle'),
                    text: t('c26.freeText'),
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  SozoCard(
                    children: [
                      Text(
                        (widget.order['number'] as String?) ?? '',
                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                      Text(
                        (widget.order['category'] as String?) ?? '',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),
                  SozoField(
                    label: t('c26.what'),
                    controller: _description,
                    hint: t('c26.whatHint'),
                    maxLines: 4,
                    error: _touched && _description.text.trim().isEmpty ? t('c26.whatError') : null,
                    onChanged: (_) => setState(() {}),
                  ),
                  SectionHeading(t('c26.photos')),
                  const SizedBox(height: SozoSpace.s8),
                  PhotoGrid(
                    photos: [for (final p in _photos) PhotoRef(dataUrl: p)],
                    onAdd: () async {
                      final data = await pickPhoto(context);
                      if (data != null && mounted) setState(() => _photos.add(data));
                    },
                    onRemove: (i) => setState(() => _photos.removeAt(i)),
                  ),
                  if (days.isNotEmpty) ...[
                    const SizedBox(height: SozoSpace.s24),
                    SectionHeading(t('c26.when')),
                    const SizedBox(height: SozoSpace.s8),
                    for (final day in days.take(2)) ...[
                      Text(
                        relativeDay('${day['date']}T00:00:00'),
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                      Wrap(
                        spacing: SozoSpace.s8,
                        runSpacing: SozoSpace.s8,
                        children: [
                          for (final w in ((day['windows'] as List?) ?? const []).cast<Map<String, dynamic>>())
                            SozoChip(
                              (w['label'] as String?) ?? '',
                              selected: _slotDate == day['date'] && _slotStartMin == w['startMin'],
                              onTap: () => setState(() {
                                _slotDate = day['date'] as String?;
                                _slotStartMin = (w['startMin'] as num?)?.toInt();
                              }),
                            ),
                        ],
                      ),
                      const SizedBox(height: SozoSpace.s12),
                    ],
                  ],
                  const SizedBox(height: SozoSpace.s8),
                  Text(
                    t('c26.callNote'),
                    style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                  ),
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

/// C-27. Касание «Как дела» — приходит пушем через две недели после ремонта.
class HowAreThingsScreen extends StatelessWidget {
  const HowAreThingsScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: ''),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                t('c27.question', {'what': order['category'] ?? ''}),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
              const SizedBox(height: SozoSpace.s32),
              PrimaryButton(
                t('c27.allGood'),
                onTap: () {
                  showSozoToast(context, t('c27.thanks'));
                  Navigator.of(context).pop();
                },
              ),
              const SizedBox(height: SozoSpace.s12),
              SecondaryButton(
                t('c27.problem'),
                onTap: () => Navigator.of(context).pushReplacement(
                  MaterialPageRoute<void>(builder: (_) => WarrantyScreen(order: order)),
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
              Text(
                t('c27.why'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
