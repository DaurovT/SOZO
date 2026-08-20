import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/common.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';

/// Режим «Обход»: маршрут и чек-лист (M-48), быстрая фиксация замечания
/// (M-49), «Мои замечания» (M-50). DEV-15 §7.7, DEV-09.
///
/// Обход офлайн-первый целиком (PRD-02 §6): чек-лист и открытые замечания
/// приезжают в устройство вместе с маршрутом, а отметки зон и снимки уходят
/// в очередь. Дедупликация обязана работать в подвале, где связи нет, —
/// поэтому список открытых замечаний кешируется, а не запрашивается в момент
/// съёмки.
///
/// Правило скорости — главное требование к экрану: одно замечание не более
/// трёх тапов. Фото → плитка категории → отправлено. Всё остальное (зона,
/// ответственный, срок, маршрутизация) дозаполняется в кабинете. Форма на
/// десять полей означает, что через неделю руководитель вернётся в WhatsApp.

class ObservationCategory {
  const ObservationCategory({required this.id, required this.label, required this.icon});

  final String id;
  final String label;
  final String icon;

  static ObservationCategory fromJson(Map<String, dynamic> j) => ObservationCategory(
    id: j['id'] as String,
    label: j['label'] as String? ?? j['id'] as String,
    icon: j['icon'] as String? ?? 'alert-circle',
  );
}

class WalkRoute {
  const WalkRoute({required this.id, required this.name, required this.zoneKeys});

  final String id;
  final String name;
  final List<String> zoneKeys;

  static WalkRoute fromJson(Map<String, dynamic> j) => WalkRoute(
    id: j['id'] as String,
    name: j['name'] as String? ?? '',
    zoneKeys: ((j['zoneKeys'] as List?) ?? const []).map((e) => '$e').toList(),
  );
}

class OpenObservation {
  const OpenObservation({required this.id, required this.zoneKey, required this.author, required this.createdAt});

  final String id;
  final String zoneKey;
  final String author;
  final String createdAt;

  static OpenObservation fromJson(Map<String, dynamic> j) => OpenObservation(
    id: j['id'] as String,
    zoneKey: j['zoneKey'] as String? ?? '',
    author: j['authorPhone'] as String? ?? '',
    createdAt: j['createdAt'] as String? ?? '',
  );
}

// ---------------------------------------------------------------------------
// Вход в режим: объекты, где человек в штате службы
// ---------------------------------------------------------------------------

/// Обход делает сотрудник эксплуатирующей организации, а не мастер платформы,
/// приехавший на заявку. Поэтому список объектов приходит с сервера по штату,
/// а не собирается из заявок в ленте.
class WalkBuildingsScreen extends StatefulWidget {
  const WalkBuildingsScreen({super.key, required this.session});

  final Session session;

  @override
  State<WalkBuildingsScreen> createState() => _WalkBuildingsScreenState();
}

class _WalkBuildingsScreenState extends State<WalkBuildingsScreen> {
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
      appBar: AppBar(title: Text(t('walk.obhod')), backgroundColor: SozoColors.surface),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? EmptyView(
                  title: t('walk.obyektovNet'),
                  subtitle: t('walk.obhodTolkoDlyaShtata'),
                  icon: 'home',
                )
              : ListView(
                  padding: const EdgeInsets.all(SozoSpace.s16),
                  children: [
                    for (final b in _items)
                      Padding(
                        padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                        child: SozoCard(
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => WalkthroughScreen(
                              session: widget.session,
                              buildingId: b['id'] as String,
                              buildingName: b['name'] as String? ?? '',
                            ),
                          )),
                          child: Row(
                            children: [
                              const FigmaIcon('home', size: 20),
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

// ---------------------------------------------------------------------------
// M-48. Маршрут и чек-лист
// ---------------------------------------------------------------------------

class WalkthroughScreen extends StatefulWidget {
  const WalkthroughScreen({super.key, required this.session, required this.buildingId, required this.buildingName});

  final Session session;
  final String buildingId;
  final String buildingName;

  @override
  State<WalkthroughScreen> createState() => _WalkthroughScreenState();
}

class _WalkthroughScreenState extends State<WalkthroughScreen> {
  bool _loading = true;
  String? _error;
  List<WalkRoute> _routes = const [];
  List<ObservationCategory> _cats = const [];
  List<OpenObservation> _open = const [];

  WalkRoute? _route;
  String? _walkId;
  final Set<String> _passed = {};
  int _observations = 0;
  bool _busy = false;

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
      final api = widget.session.api;
      final r = (await api.get('/master/buildings/${widget.buildingId}/routes')) as Map<String, dynamic>;
      final c = (await api.get('/master/observation-categories')) as List;
      if (!mounted) return;
      setState(() {
        _routes = ((r['routes'] as List?) ?? const [])
            .map((e) => WalkRoute.fromJson(e as Map<String, dynamic>))
            .toList();
        _open = ((r['openObservations'] as List?) ?? const [])
            .map((e) => OpenObservation.fromJson(e as Map<String, dynamic>))
            .toList();
        _cats = c.map((e) => ObservationCategory.fromJson(e as Map<String, dynamic>)).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _start(WalkRoute r) async {
    setState(() => _busy = true);
    try {
      final res = (await widget.session.api.post('/master/routes/${r.id}/walks', const {})) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _route = r;
        _walkId = res['id'] as String?;
        _passed.clear();
        _observations = 0;
      });
    } catch (_) {
      // Обход начинают на месте, и связи там может не быть. Без идентификатора
      // с сервера отметки зон некуда привязать, поэтому честно говорим об этом
      // вместо того, чтобы делать вид, что обход идёт.
      if (mounted) _toast(t('walk.nachatObhodNuzhnaSvyaz'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Отметка зоны уходит в очередь: в подвале сервера нет, а зону мастер
  /// проходит именно там.
  Future<void> _passZone(String zone) async {
    if (_walkId == null) return;
    setState(() => _passed.add(zone));
    await widget.session.outbox.enqueue(
      orderId: widget.buildingId,
      kind: 'walk_zone',
      payload: {'walkId': _walkId, 'zoneKey': zone},
      title: t('walk.zonaProydena', {'p1': zone}),
    );
  }

  Future<void> _finish() async {
    if (_walkId == null) return;
    final missed = (_route?.zoneKeys ?? const []).where((z) => !_passed.contains(z)).length;
    await widget.session.outbox.enqueue(
      orderId: widget.buildingId,
      kind: 'walk_finish',
      payload: {'walkId': _walkId},
      title: t('walk.obhodZavershen'),
    );
    if (!mounted) return;
    // Незакрытые зоны обход не блокируют: обход, в котором прошли половину
    // зон, — это факт, который правление должно видеть, а не повод не дать
    // сохранить результат.
    _toast(missed == 0
        ? t('walk.itogVsePro', {'p1': _passed.length, 'p2': _observations})
        : t('walk.itogSPropuskami', {'p1': _passed.length, 'p2': missed, 'p3': _observations}));
    setState(() {
      _route = null;
      _walkId = null;
    });
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _observe(String zone) async {
    final created = await showObservationSheet(
      context,
      session: widget.session,
      buildingId: widget.buildingId,
      zoneKey: zone,
      categories: _cats,
      openInZone: _open.where((o) => o.zoneKey == zone).toList(),
      walkId: _walkId,
    );
    if (created && mounted) {
      setState(() => _observations += 1);
      await _passZone(zone);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: AppBar(title: Text(t('walk.obhod')), backgroundColor: SozoColors.surface),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? EmptyView(title: t('walk.neUdalosZagruzit'), subtitle: _error, icon: 'cloud-off')
              : _route == null
                  ? _routeList()
                  : _checklist(),
    );
  }

  Widget _routeList() {
    if (_routes.isEmpty) {
      return EmptyView(
        title: t('walk.marshrutovNet'),
        subtitle: t('walk.marshrutySozdayutsyaVKabinete'),
        icon: 'map',
      );
    }
    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: [
        SectionTitle(widget.buildingName),
        for (final r in _routes)
          Padding(
            padding: const EdgeInsets.only(bottom: SozoSpace.s12),
            child: SozoCard(
              onTap: _busy ? null : () => _start(r),
              child: Row(
                children: [
                  const FigmaIcon('map-pin', size: 20),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.name, style: const TextStyle(fontWeight: FontWeight.w700, color: SozoColors.text)),
                        const SizedBox(height: 2),
                        Text(t('walk.zonShtuk', {'p1': r.zoneKeys.length}),
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
    );
  }

  Widget _checklist() {
    final zones = _route!.zoneKeys;
    final done = _passed.length;
    return Column(
      children: [
        // Прогресс-бар зон: сколько пройдено — единственное, что мастеру нужно
        // видеть постоянно, остальное он листает
        Container(
          color: SozoColors.surface,
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_route!.name, style: const TextStyle(fontWeight: FontWeight.w700, color: SozoColors.text)),
              const SizedBox(height: SozoSpace.s8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: zones.isEmpty ? 0 : done / zones.length,
                  minHeight: 6,
                  backgroundColor: SozoColors.bg,
                  valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
                ),
              ),
              const SizedBox(height: SozoSpace.s8),
              Text(t('walk.progress', {'p1': done, 'p2': zones.length, 'p3': _observations}),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(SozoSpace.s16),
            children: [
              for (final z in zones)
                Padding(
                  padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                  child: SozoCard(
                    child: Row(
                      children: [
                        FigmaIcon(_passed.contains(z) ? 'check-done' : 'circle', size: 20),
                        const SizedBox(width: SozoSpace.s12),
                        Expanded(child: Text(z, style: const TextStyle(color: SozoColors.text))),
                        TextButton(
                          onPressed: () => _observe(z),
                          child: Text(t('walk.zamechanie')),
                        ),
                        if (!_passed.contains(z))
                          TextButton(
                            onPressed: () => _passZone(z),
                            child: Text(t('walk.chisto')),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: PrimaryButton(label: t('walk.zavershitObhod'), onPressed: _finish),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// M-49. Замечание — быстрая фиксация
// ---------------------------------------------------------------------------

/// Возвращает true, если замечание создано или мастер присоединился к чужому.
Future<bool> showObservationSheet(
  BuildContext context, {
  required Session session,
  required String buildingId,
  required String zoneKey,
  required List<ObservationCategory> categories,
  List<OpenObservation> openInZone = const [],
  String? walkId,
}) async {
  // Шаг 1 — фото. Съёмка первой, а не последней: мастер уже стоит перед тем,
  // что снимает, и уводить его сначала в форму значит потерять кадр.
  final photos = <String>[];
  final shot = await showPhotoCapture(
    context,
    title: t('walk.zamechanie'),
    stage: 'observation',
    alreadyTaken: 0,
    minRequired: 1,
    maxPhotos: 3,
    hint: zoneKey,
    onUpload: (dataUrl) async {
      photos.add(dataUrl);
      return true;
    },
  );
  if (!shot || photos.isEmpty || !context.mounted) return false;

  // Шаг 2 — дубликаты. Показываем ПОСЛЕ съёмки: спрашивать до того, как
  // человек снял, значит отнять у него кадр ради вопроса, на который он
  // ответит «всё равно создать».
  String? joinId;
  if (openInZone.isNotEmpty) {
    joinId = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: SozoColors.surface,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SectionTitle(t('walk.zdesUzheEstZamechanie')),
            for (final o in openInZone)
              SozoCard(
                onTap: () => Navigator.pop(ctx, o.id),
                child: Text(t('walk.otAvtoraOtDaty', {'p1': o.author, 'p2': o.createdAt.split('T').first}),
                    style: const TextStyle(color: SozoColors.text)),
              ),
            const SizedBox(height: SozoSpace.s12),
            SecondaryButton(label: t('walk.vseRavnoSozdat'), onPressed: () => Navigator.pop(ctx, null)),
          ],
        ),
      ),
    );
  }

  if (!context.mounted) return false;

  // Шаг 3 — плитка категории. Единственное обязательное поле, кроме фото.
  String? categoryId;
  if (joinId == null) {
    categoryId = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: SozoColors.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SectionTitle(t('walk.chtoZafiksirovali')),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: SozoSpace.s8,
              crossAxisSpacing: SozoSpace.s8,
              childAspectRatio: 0.95,
              children: [
                for (final c in categories)
                  InkWell(
                    onTap: () => Navigator.pop(ctx, c.id),
                    child: Container(
                      decoration: BoxDecoration(
                        color: SozoColors.bg,
                        borderRadius: BorderRadius.circular(SozoRadius.card),
                      ),
                      padding: const EdgeInsets.all(SozoSpace.s8),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          FigmaIcon(c.icon, size: 24),
                          const SizedBox(height: SozoSpace.s8),
                          Text(
                            c.label,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: SozoColors.text),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
    if (categoryId == null) return false;
  }

  // Отправка через очередь: связи в подвале нет, а снимок терять нельзя
  await session.outbox.enqueue(
    orderId: buildingId,
    kind: 'observation',
    payload: {
      'zoneKey': zoneKey,
      'categoryId': ?categoryId,
      'joinObservationId': ?joinId,
      'photoIds': photos,
      'walkId': ?walkId,
    },
    title: t('walk.zamechanieVZone', {'p1': zoneKey}),
  );
  return true;
}

// ---------------------------------------------------------------------------
// M-50. Мои замечания
// ---------------------------------------------------------------------------

class MyObservationsScreen extends StatefulWidget {
  const MyObservationsScreen({super.key, required this.session});

  final Session session;

  @override
  State<MyObservationsScreen> createState() => _MyObservationsScreenState();
}

class _MyObservationsScreenState extends State<MyObservationsScreen> {
  String _tab = 'open';
  bool _loading = true;
  List<Map<String, dynamic>> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = (await widget.session.api.get('/master/observations')) as List;
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
    final shown = _items.where((o) {
      final s = o['status'] as String? ?? 'open';
      if (_tab == 'resolved') return s == 'resolved';
      if (_tab == 'routed') return s == 'routed';
      return s == 'open';
    }).toList();

    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: AppBar(title: Text(t('walk.moiZamechaniya')), backgroundColor: SozoColors.surface),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'open', label: Text(t('walk.otkrytye'))),
                ButtonSegment(value: 'routed', label: Text(t('walk.vRabote'))),
                ButtonSegment(value: 'resolved', label: Text(t('walk.ustraneny'))),
              ],
              selected: {_tab},
              onSelectionChanged: (v) => setState(() => _tab = v.first),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : shown.isEmpty
                    ? EmptyView(title: t('walk.zamechaniyNet'), icon: 'check-done')
                    : ListView(
                        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
                        children: [
                          for (final o in shown)
                            Padding(
                              padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                              child: SozoCard(
                                leftStripe: o['severity'] == 'emergency' ? SozoColors.error : null,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('${o['buildingName'] ?? ''} · ${o['zoneKey'] ?? ''}',
                                        style: const TextStyle(fontWeight: FontWeight.w700, color: SozoColors.text)),
                                    const SizedBox(height: 2),
                                    Text(
                                      t('walk.fotoShtuk', {'p1': ((o['photoIds'] as List?) ?? const []).length}),
                                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                                    ),
                                    if (o['routedEntityId'] != null) ...[
                                      const SizedBox(height: SozoSpace.s8),
                                      Text(t('walk.zayavkaSozdana'),
                                          style: const TextStyle(fontSize: 13, color: SozoColors.error)),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
          ),
        ],
      ),
    );
  }
}
