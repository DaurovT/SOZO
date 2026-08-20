import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../store/session.dart';
import '../widgets/common.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';
import 'walkthrough_screen.dart' show ObservationCategory, showObservationSheet;

/// M-47 «Плановое ТО на объекте» (DEV-09, DEV-15 §7.1).
///
/// Экран ведёт по регламенту: карточка оборудования с историей → чек-лист с
/// отметками и фото по пунктам → завершение. Замечание по ходу фиксируется тем
/// же листом, что и на обходе: заводить для ТО отдельный поток значит получить
/// два несовместимых способа сказать «здесь непорядок».
///
/// Завершение блокируется перечнем незакрытых пунктов, а не общей фразой:
/// мастер стоит у щитовой с телефоном в одной руке и не должен сверять
/// двенадцать пунктов глазами.
class MaintenanceScreen extends StatefulWidget {
  const MaintenanceScreen({
    super.key,
    required this.session,
    required this.buildingId,
    required this.buildingName,
  });

  final Session session;
  final String buildingId;
  final String buildingName;

  @override
  State<MaintenanceScreen> createState() => _MaintenanceScreenState();
}

class _MaintenanceScreenState extends State<MaintenanceScreen> {
  List<Map<String, dynamic>> _plan = const [];
  List<ObservationCategory> _cats = const [];
  bool _loading = true;
  String? _error;

  /// Открытая единица оборудования; null — список
  Map<String, dynamic>? _current;
  String? _sessionId;
  final Map<String, Map<String, dynamic>> _marks = {};
  List<Map<String, dynamic>> _missing = const [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await widget.session.api.maintenancePlan(widget.buildingId);
      final c = (await widget.session.api.get('/master/observation-categories')) as List;
      if (!mounted) return;
      setState(() {
        _plan = ((r['equipment'] as List?) ?? const []).cast<Map<String, dynamic>>();
        _cats = c.cast<Map<String, dynamic>>().map(ObservationCategory.fromJson).toList();
        _loading = false;
        _error = null;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  Future<void> _open(Map<String, dynamic> item) async {
    if (item['regulation'] == null) {
      showError(context, t('to.reglamentaNet'));
      return;
    }
    setState(() => _busy = true);
    try {
      final s = await widget.session.api.startMaintenance((item['equipment'] as Map)['id'].toString());
      if (!mounted) return;
      // Отметки уже начатой сессии подтягиваем: мастер мог уйти и вернуться
      final marks = <String, Map<String, dynamic>>{};
      for (final m in ((s['items'] as List?) ?? const []).cast<Map<String, dynamic>>()) {
        marks[m['itemId'].toString()] = m;
      }
      setState(() {
        _current = item;
        _sessionId = s['id'].toString();
        _marks
          ..clear()
          ..addAll(marks);
        _missing = const [];
      });
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _mark(Map<String, dynamic> regItem, {required bool done}) async {
    final id = regItem['id'].toString();
    final needsPhoto = regItem['photo'] == true;
    final photos = <String>[];

    if (done && needsPhoto) {
      final shot = await showPhotoCapture(
        context,
        title: regItem['label'].toString(),
        stage: 'maintenance',
        alreadyTaken: 0,
        minRequired: 1,
        maxPhotos: 3,
        onUpload: (dataUrl) async {
          photos.add(dataUrl);
          return true;
        },
      );
      // Отказ от съёмки не должен ставить галочку: пункт с обязательным фото
      // без фото сервер всё равно не примет, и молчаливая галочка обманет
      if (!shot || photos.isEmpty) return;
    }

    try {
      final s = await widget.session.api.markMaintenanceItem(
        _sessionId!,
        itemId: id,
        done: done,
        photoIds: photos,
      );
      if (!mounted) return;
      setState(() {
        _marks[id] = {'itemId': id, 'done': done, 'photoIds': photos};
        // Пункт закрыт — убираем его из перечня незакрытых, чтобы список
        // таял по мере работы, а не висел до следующей попытки завершить
        _missing = _missing.where((m) => m['itemId'] != id).toList();
        final items = ((s['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
        for (final m in items) {
          _marks[m['itemId'].toString()] = m;
        }
      });
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  Future<void> _observe() async {
    final eq = (_current!['equipment'] as Map);
    final created = await showObservationSheet(
      context,
      session: widget.session,
      buildingId: widget.buildingId,
      zoneKey: (eq['equipmentType'] ?? '').toString(),
      categories: _cats,
    );
    if (created && mounted) showOk(context, t('to.zamechanieZafiksirovano'));
  }

  Future<void> _finish() async {
    setState(() => _busy = true);
    try {
      await widget.session.api.finishMaintenance(_sessionId!);
      if (!mounted) return;
      showOk(context, t('to.zavercheno'));
      setState(() {
        _current = null;
        _sessionId = null;
        _missing = const [];
      });
      await _load();
    } on ApiError catch (e) {
      // Перечень приходит от сервера: экран его показывает, а не пересчитывает
      // сам — иначе правило начнёт жить в двух местах и разойдётся
      final list = (e.payload?['missing'] as List?)?.cast<Map<String, dynamic>>();
      if (!mounted) return;
      if (list != null && list.isNotEmpty) {
        setState(() => _missing = list);
      } else {
        showError(context, e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: AppBar(
        title: Text(_current == null ? t('to.title') : t('to.chekList')),
        backgroundColor: SozoColors.surface,
        leading: _current != null
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _current = null))
            : null,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? EmptyView(title: t('to.neUdalosZagruzit'), subtitle: _error, icon: 'cloud-off')
              : _current == null
                  ? _list()
                  : _checklist(),
    );
  }

  Widget _list() {
    if (_plan.isEmpty) {
      return EmptyView(title: t('to.oborudovaniyaNet'), subtitle: t('to.zavoditsyaVKabinete'), icon: 'toolbox');
    }
    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: [
        SectionTitle(widget.buildingName),
        for (final item in _plan) _equipmentCard(item),
      ],
    );
  }

  Widget _equipmentCard(Map<String, dynamic> item) {
    final eq = (item['equipment'] as Map);
    final reg = item['regulation'] as Map?;
    final overdue = item['overdue'] == true;
    final dueSoon = item['dueSoon'] == true;
    final history = ((item['history'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final last = history.isNotEmpty ? history.first : null;

    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s12),
      child: SozoCard(
        onTap: _busy ? null : () => _open(item),
        leftStripe: overdue ? SozoColors.error : (dueSoon ? SozoColors.warning : null),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              (reg?['label'] ?? eq['equipmentType'] ?? '').toString(),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            if (eq['model'] != null) InfoRow(label: t('to.model'), value: eq['model'].toString()),
            if (eq['serial'] != null) InfoRow(label: t('to.serijnik'), value: eq['serial'].toString()),
            if (eq['commissionedAt'] != null)
              InfoRow(label: t('to.vvedeno'), value: eq['commissionedAt'].toString().split('T').first),
            InfoRow(
              label: t('to.srok'),
              value: item['dueAt'] == null
                  ? t('to.poFaktu')
                  : item['dueAt'].toString().split('T').first,
              valueColor: overdue ? SozoColors.error : (dueSoon ? SozoColors.warning : null),
            ),
            if (last != null)
              InfoRow(
                label: t('to.proshlyjRaz'),
                value: (last['finishedAt'] ?? last['startedAt']).toString().split('T').first,
              ),
            if (reg == null) ...[
              const SizedBox(height: SozoSpace.s8),
              BlockerNote(text: t('to.reglamentaNet'), icon: 'info'),
            ],
          ],
        ),
      ),
    );
  }

  Widget _checklist() {
    final item = _current!;
    final eq = (item['equipment'] as Map);
    final reg = (item['regulation'] as Map);
    final items = ((reg['items'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: [
        SozoCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text((reg['label'] ?? '').toString(), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              if (eq['model'] != null) InfoRow(label: t('to.model'), value: eq['model'].toString()),
              if (eq['serial'] != null) InfoRow(label: t('to.serijnik'), value: eq['serial'].toString()),
            ],
          ),
        ),
        if (_missing.isNotEmpty) ...[
          const SizedBox(height: SozoSpace.s12),
          SozoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t('to.neZakryto'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.error)),
                const SizedBox(height: 4),
                for (final m in _missing)
                  Text(
                    m['reason'] == 'photo_required'
                        ? '· ${m['label']} — ${t('to.nuzhnoFoto')}'
                        : '· ${m['label']}',
                    style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: SozoSpace.s12),
        for (final i in items) _checkItem(i),
        const SizedBox(height: SozoSpace.s12),
        SecondaryButton(label: t('to.zafiksirovatZamechanie'), onPressed: _observe),
        const SizedBox(height: SozoSpace.s8),
        PrimaryButton(label: t('to.zavershitTo'), onPressed: _busy ? null : _finish),
      ],
    );
  }

  Widget _checkItem(Map<String, dynamic> i) {
    final id = i['id'].toString();
    final mark = _marks[id];
    final done = mark?['done'] == true;
    final required = i['required'] == true;
    final needsPhoto = i['photo'] == true;
    final hasPhoto = ((mark?['photoIds'] as List?) ?? const []).isNotEmpty;

    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
      child: SozoCard(
        onTap: _busy ? null : () => _mark(i, done: !done),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              done ? Icons.check_circle : Icons.radio_button_unchecked,
              color: done ? SozoColors.success : SozoColors.textTertiary,
              size: 22,
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(i['label'].toString(), style: const TextStyle(fontSize: 15)),
                  if (required || needsPhoto)
                    Text(
                      [
                        if (required) t('to.obyazatelno'),
                        if (needsPhoto) (hasPhoto ? t('to.fotoEst') : t('to.nuzhnoFoto')),
                      ].join(' · '),
                      style: TextStyle(
                        fontSize: 12,
                        color: needsPhoto && done && !hasPhoto ? SozoColors.error : SozoColors.textTertiary,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Выбор объекта перед ТО
// ---------------------------------------------------------------------------

/// Тот же список объектов штата, что у обхода, но ведёт в план ТО.
/// Разделены сознательно: обход — маршрут по зонам, ТО — работа по конкретной
/// единице оборудования, и общий вход заставлял бы выбирать режим после объекта.
class MaintenanceBuildingsScreen extends StatefulWidget {
  const MaintenanceBuildingsScreen({super.key, required this.session});

  final Session session;

  @override
  State<MaintenanceBuildingsScreen> createState() => _MaintenanceBuildingsScreenState();
}

class _MaintenanceBuildingsScreenState extends State<MaintenanceBuildingsScreen> {
  bool _loading = true;
  List<Map<String, dynamic>> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = (await widget.session.api.get('/master/buildings')) as List;
      if (!mounted) return;
      setState(() {
        _items = r.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: AppBar(title: Text(t('to.title')), backgroundColor: SozoColors.surface),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? EmptyView(title: t('walk.obyektovNet'), subtitle: t('walk.obhodTolkoDlyaShtata'), icon: 'home')
              : ListView(
                  padding: const EdgeInsets.all(SozoSpace.s16),
                  children: [
                    for (final b in _items)
                      Padding(
                        padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                        child: SozoCard(
                          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                            builder: (_) => MaintenanceScreen(
                              session: widget.session,
                              buildingId: b['id'] as String,
                              buildingName: b['name'] as String? ?? '',
                            ),
                          )),
                          child: Row(
                            children: [
                              const FigmaIcon('toolbox', size: 20),
                              const SizedBox(width: SozoSpace.s12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(b['name'] as String? ?? '',
                                        style: const TextStyle(fontWeight: FontWeight.w700, color: SozoColors.text)),
                                    const SizedBox(height: 2),
                                    Text(b['address'] as String? ?? '',
                                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                                  ],
                                ),
                              ),
                              const FigmaIcon('chevron-right', size: 20),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
    );
  }
}
