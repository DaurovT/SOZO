import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../../widgets/photo_grid.dart';

/// C-32. «Сообщить о поломке» — один экран вместо визарда.
///
/// Сотруднику точки не нужны ни адрес, ни выбор времени: точка известна,
/// а время согласует диспетчер. Всё, что от него требуется, — показать проблему.
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, required this.locationId});

  final String locationId;

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _description = TextEditingController();
  final List<String> _photos = [];
  String? _category;
  String _urgency = 'normal';
  bool _needRiser = false;
  bool _needCommonArea = false;
  bool _busy = false;
  bool _touched = false;
  String? _error;

  static const _categories = [
    'Сантехника',
    'Электрика',
    'Кондиционеры',
    'Двери и окна',
    'Бытовая техника',
    'Не знаю',
  ];

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (_description.text.trim().isEmpty) return;

    // Фото не обязательны, но без них мастер едет вслепую — предлагаем один раз.
    // Для аварии не спрашиваем вовсе: там дорога каждая минута.
    if (_photos.isEmpty && _urgency != 'emergency') {
      final add = await showSozoConfirm(
        context,
        title: t('c32.noPhotoTitle'),
        text: t('c32.noPhotoText'),
        confirmLabel: t('c32.addPhoto'),
        cancelLabel: t('c32.sendWithout'),
      );
      if (add) {
        await _pick();
        return;
      }
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await session.api.reportIssue(widget.locationId, {
        'description': _description.text.trim(),
        'category': _category,
        'photos': _photos,
        'urgency': _urgency,
        'needRiser': _needRiser,
        'needCommonArea': _needCommonArea,
      });
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      // После аварийной заявки сразу открываем инструкцию: ждать, пока
      // человек сам её найдёт, в аварии нельзя
      if (r['emergency'] == true) {
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => EmergencyGuideScreen(locationId: widget.locationId)),
        );
      } else {
        Navigator.of(context).pop();
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick() async {
    final data = await pickPhoto(context);
    if (data != null && mounted) setState(() => _photos.add(data));
  }

  @override
  Widget build(BuildContext context) {
    final site = session.currentContext?['title'] as String?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c32.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  if (site != null) SozoBanner(icon: 'shopping-bag', text: site),
                  const SizedBox(height: SozoSpace.s16),

                  SectionHeading(t('c32.photos'), subtitle: t('c32.photosHint')),
                  const SizedBox(height: SozoSpace.s8),
                  PhotoGrid(
                    photos: [for (final p in _photos) PhotoRef(dataUrl: p)],
                    onAdd: _pick,
                    onRemove: (i) => setState(() => _photos.removeAt(i)),
                  ),

                  const SizedBox(height: SozoSpace.s24),
                  SozoField(
                    label: t('c32.what'),
                    controller: _description,
                    hint: t('c32.whatHint'),
                    maxLines: 4,
                    error: _touched && _description.text.trim().isEmpty ? t('c32.whatError') : null,
                    onChanged: (_) => setState(() {}),
                  ),

                  SectionHeading(t('c32.category')),
                  const SizedBox(height: SozoSpace.s8),
                  Wrap(
                    spacing: SozoSpace.s8,
                    runSpacing: SozoSpace.s8,
                    children: [
                      for (final c in _categories)
                        SozoChip(c, selected: _category == c, onTap: () => setState(() => _category = c)),
                    ],
                  ),

                  const SizedBox(height: SozoSpace.s24),
                  SectionHeading(t('c32.urgency')),
                  const SizedBox(height: SozoSpace.s8),
                  RadioCard(
                    title: t('c32.normal'),
                    selected: _urgency == 'normal',
                    onTap: () => setState(() => _urgency = 'normal'),
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  RadioCard(
                    icon: 'alert-triangle',
                    iconColor: SozoColors.error,
                    title: t('c32.emergency'),
                    subtitle: t('c32.emergencyHint'),
                    selected: _urgency == 'emergency',
                    onTap: () => setState(() => _urgency = 'emergency'),
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  RadioCard(
                    icon: 'bolt',
                    iconColor: SozoColors.accent,
                    title: t('c32.urgent'),
                    subtitle: t('c32.urgentHint'),
                    selected: _urgency == 'urgent',
                    onTap: () => setState(() => _urgency = 'urgent'),
                  ),

                  const SizedBox(height: SozoSpace.s16),
                  SozoCard(
                    children: [
                      SwitchRow(
                        title: t('c11.riserQ'),
                        value: _needRiser,
                        onChanged: (v) => setState(() => _needRiser = v),
                      ),
                      const SozoDivider(),
                      SwitchRow(
                        title: t('c11.commonAreaQ'),
                        value: _needCommonArea,
                        onChanged: (v) => setState(() => _needCommonArea = v),
                      ),
                    ],
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

/// C-33. Что делать сейчас — инструкция при аварии.
///
/// Открывается автоматически после аварийной заявки. Подсказки берутся из
/// паспорта точки: «кран — в подсобке за стеллажом» полезнее, чем «перекройте кран».
class EmergencyGuideScreen extends StatelessWidget {
  const EmergencyGuideScreen({super.key, required this.locationId});

  final String locationId;

  /// Вызвать бригаду.
  ///
  /// Спрашиваем только вид аварии — в такой момент форма из пяти полей
  /// не заполняется. Остальное диспетчер уточнит по телефону.
  Future<void> _call(BuildContext context, Map<String, dynamic> data, Future<void> Function() reload) async {
    final kinds = ((data['kinds'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final kind = await showSozoSheet<String>(
      context,
      title: t('c33.callTitle'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (data['slaNote'] != null) ...[
              SozoBanner(icon: 'clock', text: data['slaNote'] as String),
              const SizedBox(height: SozoSpace.s12),
            ],
            for (final k in kinds)
              Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                child: SecondaryButton(
                  (k['title'] as String?) ?? '',
                  onTap: () => Navigator.of(context).pop(k['kind'] as String?),
                ),
              ),
          ],
        ),
      ),
    );
    if (kind == null) return;
    try {
      final res = await session.api.callEmergency(locationId, kind);
      if (context.mounted) showSozoToast(context, (res['message'] as String?) ?? '');
      await reload();
    } on ApiError catch (e) {
      if (context.mounted) showSozoToast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c33.title')),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          load: () => session.api.emergencyGuide(locationId),
          builder: (context, data, reload) {
            final kinds = ((data['kinds'] as List?) ?? const []).cast<Map<String, dynamic>>();
            return Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      for (final k in kinds) ...[
                        SectionHeading((k['title'] as String?) ?? ''),
                        const SizedBox(height: SozoSpace.s8),
                        for (final (i, s) in ((k['steps'] as List?) ?? const [])
                            .cast<Map<String, dynamic>>()
                            .indexed) ...[
                          SozoCard(
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    width: 28,
                                    height: 28,
                                    decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
                                    alignment: Alignment.center,
                                    child: Text(
                                      '${i + 1}',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700,
                                        color: SozoColors.onAccent,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: SozoSpace.s12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          (s['text'] as String?) ?? '',
                                          style: const TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.w600,
                                            color: SozoColors.text,
                                          ),
                                        ),
                                        if ((s['hint'] as String?)?.isNotEmpty ?? false) ...[
                                          const SizedBox(height: SozoSpace.s4),
                                          Text(
                                            s['hint'] as String,
                                            style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s8),
                        ],
                        const SizedBox(height: SozoSpace.s16),
                      ],
                    ],
                  ),
                ),
                StickyFooter(
                  children: [
                    // Заявка первым действием: звонок быстрее, но заявка
                    // запускает срок по договору и остаётся в системе
                    PrimaryButton(
                      t('c33.call'),
                      icon: 'alert-triangle',
                      onTap: () => _call(context, data, reload),
                    ),
                    const SizedBox(height: SozoSpace.s8),
                    TextAction(
                      t('common.callDispatcher'),
                      onTap: () => callPhone(context, data['dispatcherPhone'] as String?),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
