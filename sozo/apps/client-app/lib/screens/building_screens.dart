import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_grid.dart';

/// C-52 «Сообщить о проблеме в доме» и C-53 «Отключения и работы»
/// (PRD-01 §3.N, DEV-15 §10.3).
///
/// Обращение жителя — то же `BUILDING_OBSERVATION`, что фиксирует мастер на
/// обходе, только источник другой. Один механизм, разные источники: житель
/// видит статус и фото устранения, а оператор — единую очередь.

// ---------------------------------------------------------------------------
// C-52. Сообщить о проблеме
// ---------------------------------------------------------------------------

class BuildingReportScreen extends StatefulWidget {
  const BuildingReportScreen({super.key});

  @override
  State<BuildingReportScreen> createState() => _BuildingReportScreenState();
}

class _BuildingReportScreenState extends State<BuildingReportScreen> {
  List<Map<String, dynamic>> _cats = const [];
  final List<String> _photos = [];
  String? _categoryId;
  final _where = TextEditingController();
  final _comment = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _where.dispose();
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.buildingCategories();
      if (!mounted) return;
      setState(() => _cats = r.cast<Map<String, dynamic>>());
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _addPhoto() async {
    final data = await pickPhoto(context);
    if (data != null && mounted) setState(() => _photos.add(data));
  }

  Future<void> _send({String? joinId}) async {
    setState(() => _sending = true);
    try {
      final r = await session.api.reportBuildingProblem(
        categoryId: _categoryId!,
        photos: _photos,
        zoneKey: _where.text,
        comment: _comment.text,
        joinObservationId: joinId,
      );
      if (!mounted) return;

      // Дубль показываем ПОСЛЕ съёмки и только один раз: спрашивать до того,
      // как человек снял, значит отнять кадр ради вопроса
      final dups = ((r['duplicates'] as List?) ?? const []).cast<Map<String, dynamic>>();
      if (joinId == null && dups.isNotEmpty) {
        final join = await _askJoin(dups.first);
        if (join == true) {
          await _send(joinId: dups.first['id'].toString());
          return;
        }
      }
      if (!mounted) return;
      showSozoToast(context, t('c52.otpravleno'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<bool?> _askJoin(Map<String, dynamic> dup) => showSozoConfirm(
        context,
        title: t('c52.uzheEst'),
        text: t('c52.uzheEstText', {'p1': '${dup['createdAt'] ?? ''}'.split('T').first}),
        confirmLabel: t('c52.prisoedinitsya'),
        cancelLabel: t('c52.vsyoRavnoSozdat'),
      );

  @override
  Widget build(BuildContext context) {
    final ready = _photos.isNotEmpty && _categoryId != null;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c52.title')),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(SozoSpace.s24), child: Text(_error!)))
          : ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                // Шаг 1 — фото: человек уже стоит перед тем, что снимает
                SozoCard(
                  children: [
                    CardTitle(t('c52.shag1Foto')),
                    PhotoGrid(
                      photos: [for (final p in _photos) PhotoRef(dataUrl: p)],
                      onAdd: _addPhoto,
                      onRemove: (i) => setState(() => _photos.removeAt(i)),
                      max: 3,
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),

                // Шаг 2 — категория плиткой в три колонки
                SozoCard(
                  children: [
                    CardTitle(t('c52.shag2Chto')),
                    GridView.count(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 3,
                      childAspectRatio: 0.95,
                      mainAxisSpacing: SozoSpace.s8,
                      crossAxisSpacing: SozoSpace.s8,
                      children: [
                        for (final c in _cats) _tile(c),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),

                // Шаг 3 — где и комментарий; оба необязательные
                SozoCard(
                  children: [
                    CardTitle(t('c52.shag3Gde')),
                    SozoField(label: t('c52.gde'), controller: _where, hint: t('c52.gdeHint')),
                    const SizedBox(height: SozoSpace.s8),
                    SozoField(label: t('c52.kommentarij'), controller: _comment, hint: t('c52.neobyazatelno')),
                  ],
                ),
                const SizedBox(height: SozoSpace.s16),
                PrimaryButton(t('c52.otpravit'), onTap: ready && !_sending ? _send : null),
                const SizedBox(height: SozoSpace.s8),
                Text(
                  t('c52.besplatno'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
              ],
            ),
    );
  }

  Widget _tile(Map<String, dynamic> c) {
    final id = c['id'].toString();
    final selected = _categoryId == id;
    // Аварийная категория ведёт не в форму, а к звонку: заполнять три шага,
    // когда в подъезде пахнет газом, — худшее, что может предложить экран
    final emergency = c['defaultSeverity'] == 'emergency';
    return InkWell(
      borderRadius: BorderRadius.circular(SozoRadius.card),
      onTap: () {
        if (emergency) {
          Navigator.of(context).pop('emergency');
          return;
        }
        setState(() => _categoryId = id);
      },
      child: Container(
        decoration: BoxDecoration(
          color: selected ? SozoColors.accent.withValues(alpha: 0.15) : SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.card),
          border: Border.all(
            color: emergency ? SozoColors.error : (selected ? SozoColors.accent : SozoColors.border),
          ),
        ),
        padding: const EdgeInsets.all(SozoSpace.s8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FigmaIcon('${c['icon'] ?? 'info'}', size: 22,
                color: emergency ? SozoColors.error : SozoColors.text),
            const SizedBox(height: SozoSpace.s4),
            Text(
              '${c['label'] ?? ''}',
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, height: 1.2),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// C-53. Отключения и работы в доме
// ---------------------------------------------------------------------------

class BuildingShutdownsScreen extends StatefulWidget {
  const BuildingShutdownsScreen({super.key});

  @override
  State<BuildingShutdownsScreen> createState() => _BuildingShutdownsScreenState();
}

class _BuildingShutdownsScreenState extends State<BuildingShutdownsScreen> {
  String _scope = 'upcoming';
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await session.api.buildingShutdowns(scope: _scope);
      if (!mounted) return;
      setState(() {
        _items = ((r['shutdowns'] as List?) ?? const []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } on ApiError {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c53.title')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: Row(
              children: [
                for (final s in const ['upcoming', 'history'])
                  Padding(
                    padding: const EdgeInsets.only(right: SozoSpace.s8),
                    child: SozoChip(
                      s == 'upcoming' ? t('c53.blizhajshie') : t('c53.istoriya'),
                      selected: _scope == s,
                      onTap: () {
                        setState(() => _scope = s);
                        _load();
                      },
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _items.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(SozoSpace.s24),
                          child: Text(
                            _scope == 'upcoming' ? t('c53.pustoBlizhajshie') : t('c53.pustoIstoriya'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: SozoColors.textSecondary),
                          ),
                        ),
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s24),
                        children: [for (final x in _items) _card(x)],
                      ),
          ),
        ],
      ),
    );
  }

  Widget _card(Map<String, dynamic> x) {
    final active = x['status'] == 'active';
    final hoursLeft = (x['hoursLeft'] as num?)?.toInt();
    final affects = x['affectsMe'] == true;
    final from = '${x['plannedFrom'] ?? ''}';
    final to = '${x['plannedTo'] ?? ''}';

    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s12),
      child: SozoCard(
        children: [
          Row(
            children: [
              FigmaIcon('zap', size: 18, color: active ? SozoColors.error : SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s8),
              Expanded(
                child: Text(
                  '${x['resourceLabel'] ?? x['resourceType'] ?? ''}',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
              ),
              // «Касается вас» — то единственное, что житель хочет знать сразу
              if (affects) TagChip(t('c53.kasaetsyaVas')),
            ],
          ),
          const SizedBox(height: SozoSpace.s4),
          Text(
            '${from.split('T').first} ${from.split('T').length > 1 ? from.split('T')[1].substring(0, 5) : ''}'
            ' — ${to.split('T').length > 1 ? to.split('T')[1].substring(0, 5) : ''}',
            style: const TextStyle(fontSize: 14),
          ),
          if (active && hoursLeft != null)
            Text(t('c53.ostalos', {'p1': '$hoursLeft'}),
                style: const TextStyle(fontSize: 13, color: SozoColors.error)),
          if ('${x['reason'] ?? ''}'.isNotEmpty)
            Text('${x['reason']}',
                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
        ],
      ),
    );
  }
}
