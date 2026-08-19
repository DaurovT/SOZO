import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// M-05 «Статус кандидата» — точка входа для тех, кого ещё не выпустили на линию.
///
/// Показывает, где человек находится в воронке и что делать прямо сейчас.
/// Обучение открыто с момента анкеты: кандидат учится, пока идёт проверка документов,
/// иначе воронка простаивает неделю на ожидании.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  Map<String, dynamic> get _d => session.onboarding ?? const {};
  Map<String, dynamic>? get _app => _d['application'] as Map<String, dynamic>?;

  /// Обновление — потягиванием списка: отдельная кнопка в шапке заняла бы
  /// место выхода, а других действий у кандидата здесь нет
  Future<void> _reload() async {
    await session.refreshOnboarding();
    if (mounted) setState(() {});
  }

  /// Выход стоит в шапке рядом с ходом оформления — без вопроса его слишком
  /// легко задеть и вылететь с середины воронки
  Future<void> _confirmLogout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('onb.vyytiIzAkkaunta')),
        content: Text(t('onb.proydennyeShagiSohranyatsyaVoy')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('onb.vyyti'))),
        ],
      ),
    );
    if (ok == true) await session.logout();
  }

  @override
  Widget build(BuildContext context) {
    final stages = ((_d['stages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final stage = _d['stage']?.toString() ?? 'application';
    final currentIndex = stages.indexWhere((s) => s['code'] == stage);
    final app = _app;
    final rejection = app?['rejectionReason'] as String?;

    return Scaffold(
      appBar: SozoAppBar(
        title: t('onb.oformlenie'),
        showBack: false,
        // Выход — единственное, что кандидату здесь может понадобиться:
        // назад из воронки идти некуда. Цвет из макета красный, но в шапке это
        // единственное красное пятно и читается как ошибка — гасим до вторичного,
        // а от случайного нажатия защищает подтверждение.
        action: SozoAppBarAction(icon: 'arrow-left-to-line', color: SozoColors.textSecondary, onTap: _confirmLogout),
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          padding: const EdgeInsets.all(SozoSpace.s16),
          children: [
            if (rejection != null) ...[
              BlockerNote(text: t('onb.anketaOtklonena', {'p1': rejection}), icon: 'alert-triangle'),
              const SizedBox(height: SozoSpace.s16),
            ],
            SozoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: stages.asMap().entries.map((e) {
                  final done = currentIndex > e.key;
                  final current = currentIndex == e.key;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                    child: Row(
                      children: [
                        StepMarker(
                          done
                              ? SozoStepState.done
                              : current
                              ? SozoStepState.current
                              : SozoStepState.pending,
                        ),
                        const SizedBox(width: SozoSpace.s12),
                        Text(
                          e.value['title'].toString(),
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: current ? FontWeight.w700 : FontWeight.w400,
                            color: done || current ? SozoColors.text : SozoColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
            SozoCard(
              accent: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionTitle(t('onb.sleduyuschiyShag')),
                  Text(_d['nextStep']?.toString() ?? '', style: const TextStyle(fontSize: 16, height: 1.4)),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
            if (app == null || rejection != null)
              PrimaryButton(
                label: app == null ? t('onb.zapolnitAnketu') : t('onb.ispravitAnketu'),
                onPressed: () async {
                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ApplicationScreen()));
                  await _reload();
                },
              )
            else ...[
              NavGroup(
                children: [
                  NavRow(
                    icon: 'user',
                    title: t('onb.anketaINavyki'),
                    subtitle: t('onb.ktoVyIChto'),
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ApplicationScreen()));
                      await _reload();
                    },
                  ),
                  NavRow(
                    icon: 'list',
                    title: t('onb.dokumentyIInstrument'),
                    subtitle: t('onb.pasportStatusFotoNabora'),
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const DocumentsScreen()));
                      await _reload();
                    },
                  ),
                  NavRow(
                    icon: 'check-square',
                    title: t('onb.obuchenieIEkzamen'),
                    subtitle: t('onb.otkrytoSrazuUchitesPoka'),
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TrainingScreen()));
                      await _reload();
                    },
                  ),
                ],
              ),
            ],
            const SizedBox(height: SozoSpace.s24),
            SozoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionTitle(t('onb.komplektNovichka')),
                  Text(
                    t('onb.formaBeydjSpecialistaI'),
                    style: TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s32),
          ],
        ),
      ),
    );
  }
}

/// M-02 «Анкета кандидата». Навыки — не декларация, а заявка на экзамен:
/// по каждому отмеченному придётся подтвердить инструмент и сдать вопросы.
class ApplicationScreen extends StatefulWidget {
  const ApplicationScreen({super.key});

  @override
  State<ApplicationScreen> createState() => _ApplicationScreenState();
}

class _ApplicationScreenState extends State<ApplicationScreen> {
  final _nameCtrl = TextEditingController();
  final _aboutCtrl = TextEditingController();
  final _refCtrl = TextEditingController();
  int _years = 0;
  final Set<String> _skills = {};
  final Set<String> _zones = {};
  String _transport = 'public';
  String _taxMode = 'self_employed';
  String? _face;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final app = session.onboarding?['application'] as Map<String, dynamic>?;
    if (app != null) {
      _nameCtrl.text = app['fullName']?.toString() ?? '';
      _aboutCtrl.text = app['about']?.toString() ?? '';
      _refCtrl.text = app['referralCode']?.toString() ?? '';
      _years = (app['experienceYears'] as num?)?.toInt() ?? 0;
      _skills.addAll(((app['skillTags'] as List?) ?? const []).map((e) => e.toString()));
      _zones.addAll(((app['zones'] as List?) ?? const []).map((e) => e.toString()));
      _transport = app['transport']?.toString() ?? 'public';
      _taxMode = app['taxMode']?.toString() ?? 'self_employed';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _aboutCtrl.dispose();
    _refCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await session.api.submitApplication({
        'fullName': _nameCtrl.text.trim(),
        'experienceYears': _years,
        'about': _aboutCtrl.text.trim(),
        'skillTags': _skills.toList(),
        'zones': _zones.toList(),
        'transport': _transport,
        'taxMode': _taxMode,
        'referralCode': _refCtrl.text.trim(),
        'facePhotoDataUrl': _face,
      });
      if (!mounted) return;
      showOk(context, t('onb.anketaSohranenaUchebnyeModuli'));
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final skillOptions = ((session.onboarding?['skillOptions'] as List?) ?? const []).map((e) => e.toString()).toList();
    final zones = ((session.onboarding?['zones'] as List?) ?? const []).map((e) => e.toString()).toList();
    final ready = _nameCtrl.text.trim().isNotEmpty && _skills.isNotEmpty && _zones.isNotEmpty;

    return Scaffold(
      appBar: SozoAppBar(title: t('onb.anketaMastera')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          TextField(
            controller: _nameCtrl,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: t('onb.fio'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Row(
              children: [
                Expanded(child: Text(t('onb.opytRabotyLet'), style: TextStyle(fontSize: 15))),
                QtyStepper(
                  qty: _years,
                  onMinus: () => setState(() => _years = (_years - 1).clamp(0, 50)),
                  onPlus: () => setState(() => _years = (_years + 1).clamp(0, 50)),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.navyki')),
          Wrap(
            spacing: SozoSpace.s8,
            runSpacing: SozoSpace.s8,
            children: skillOptions
                .map(
                  (s) => FilterChip(
                    // Значение уходит в анкету как есть — переводим подпись
                    label: Text(tv(s)),
                    selected: _skills.contains(s),
                    onSelected: (v) => setState(() => v ? _skills.add(s) : _skills.remove(s)),
                    selectedColor: SozoColors.accent.withValues(alpha: 0.14),
                  ),
                )
                .toList(),
          ),
          Padding(
            padding: EdgeInsets.only(top: SozoSpace.s8),
            child: Text(
              t('onb.navykiPodtverjdayutsyaEkzameno'),
              style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.35),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.kudaGotovyVyezjat')),
          Wrap(
            spacing: SozoSpace.s8,
            runSpacing: SozoSpace.s8,
            children: zones
                .map(
                  (z) => FilterChip(
                    label: Text(tv(z)),
                    selected: _zones.contains(z),
                    onSelected: (v) => setState(() => v ? _zones.add(z) : _zones.remove(z)),
                    selectedColor: SozoColors.accent.withValues(alpha: 0.14),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.transport')),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'own_car', label: Text(t('onb.svoyAvto'))),
              ButtonSegment(value: 'public', label: Text(t('onb.bezAvto'))),
            ],
            selected: {_transport},
            onSelectionChanged: (s) => setState(() => _transport = s.first),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.nalogovyyStatus')),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'self_employed', label: Text(t('onb.samozanyatyy'))),
              ButtonSegment(value: 'gph', label: Text(t('onb.gph'))),
            ],
            selected: {_taxMode},
            onSelectionChanged: (s) => setState(() => _taxMode = s.first),
          ),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Row(
              children: [
                FigmaIcon(
                  _face != null ? 'check-done' : 'face',
                  color: _face != null ? SozoColors.success : SozoColors.textSecondary,
                  size: 20,
                ),
                const SizedBox(width: SozoSpace.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t('onb.fotoLica')),
                      Text(t('onb.egoUviditKlientV'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => showPhotoCapture(
                    context,
                    title: t('onb.fotoDlyaKlienta'),
                    stage: 'before',
                    // Фото лица одно: счётчик «1 из 10» обещал галерею, которой тут нет.
                    // alreadyTaken 0 — чтобы уже снятое можно было переснять.
                    alreadyTaken: 0,
                    maxPhotos: 1,
                    minRequired: _face != null ? 0 : 1,
                    frontCamera: true,
                    hint: t('onb.snimayteSebyaPriDnevnom'),
                    onUpload: (dataUrl) async {
                      setState(() => _face = dataUrl);
                      return true;
                    },
                  ),
                  child: Text(t('common.snyat')),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          TextField(
            controller: _aboutCtrl,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: t('onb.oSebePoJelaniyu'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
          TextField(
            controller: _refCtrl,
            decoration: InputDecoration(
              labelText: t('onb.kodPriglasivshegoEsliEst'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('onb.sohranitAnketu'), busy: _busy, onPressed: ready ? _submit : null),
          if (!ready)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s8),
              child: Text(
                t('onb.zapolniteFioOtmetteNavyki'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// M-03 «Документы и инструмент». На проверку уходит только полный комплект —
/// иначе воронка забивается недоделками, а кандидат ждёт непонятно чего.
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  bool _busy = false;

  Map<String, dynamic>? get _app => session.onboarding?['application'] as Map<String, dynamic>?;

  Future<void> _upload(String code, String title) async {
    await showPhotoCapture(
      context,
      title: title,
      stage: 'before',
      alreadyTaken: 0,
      hint: t('onb.snimiteDokumentCelikomChtoby'),
      onUpload: (dataUrl) async {
        try {
          await session.api.uploadDocument(code, title, dataUrl);
          await session.refreshOnboarding();
          if (mounted) setState(() {});
          return true;
        } on ApiError catch (e) {
          if (mounted) showError(context, e.message);
          return false;
        }
      },
    );
  }

  Future<void> _confirmTools(String skill) async {
    await showPhotoCapture(
      context,
      title: t('onb.instrument', {'p1': skill}),
      stage: 'before',
      alreadyTaken: 0,
      hint: t('onb.razlojiteNaborISnimite'),
      onUpload: (dataUrl) async {
        try {
          await session.api.confirmTools(skill, dataUrl);
          await session.refreshOnboarding();
          if (mounted) setState(() {});
          return true;
        } on ApiError catch (e) {
          if (mounted) showError(context, e.message);
          return false;
        }
      },
    );
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.submitForReview();
      await session.refreshOnboarding();
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('common.otpravleno')).toString());
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = _app;
    final docs = ((app?['documents'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final tools = ((app?['toolChecklist'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final ready =
        docs.every((d) => d['status'] != 'missing' && d['status'] != 'rejected') &&
        tools.every((tool) => tool['confirmed'] == true);

    return Scaffold(
      appBar: SozoAppBar(title: t('onb.dokumenty')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          SectionTitle(t('onb.dokumenty')),
          ...docs.map((d) {
            final status = d['status'].toString();
            return Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SozoCard(
                child: Row(
                  children: [
                    FigmaIcon(
                      switch (status) {
                        'verified' => 'shield-check',
                        'uploaded' => 'hourglass',
                        'rejected' => 'alert-circle',
                        _ => 'upload',
                      },
                      color: switch (status) {
                        'verified' => SozoColors.success,
                        'uploaded' => SozoColors.accent,
                        'rejected' => SozoColors.error,
                        _ => SozoColors.textSecondary,
                      },
                      size: 20,
                    ),
                    const SizedBox(width: SozoSpace.s12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(d['name'].toString(), style: const TextStyle(fontSize: 15)),
                          Text(
                            switch (status) {
                              'verified' => t('onb.prinyat'),
                              'uploaded' => t('onb.naProverke'),
                              'rejected' => d['comment']?.toString() ?? t('onb.otklonen'),
                              _ => t('onb.neZagrujen'),
                            },
                            style: TextStyle(
                              fontSize: 12,
                              color: status == 'rejected' ? SozoColors.error : SozoColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () => _upload(d['code']?.toString() ?? d['name'].toString(), d['name'].toString()),
                      child: Text(status == 'missing' ? t('common.snyat') : t('onb.peresnyat')),
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.instrument2')),
          Padding(
            padding: EdgeInsets.only(bottom: SozoSpace.s8),
            child: Text(
              t('onb.bezPolnogoNaboraNavyk'),
              style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.35),
            ),
          ),
          ...tools.map((tool) {
            final items = ((tool['items'] as List?) ?? const []).map((e) => e.toString()).toList();
            final confirmed = tool['confirmed'] == true;
            return Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SozoCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        StepMarker(confirmed ? SozoStepState.done : SozoStepState.pending),
                        const SizedBox(width: SozoSpace.s8),
                        Expanded(
                          child: Text(
                            tool['skill'].toString(),
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                          ),
                        ),
                        TextButton(
                          onPressed: () => _confirmTools(tool['skill'].toString()),
                          child: Text(confirmed ? t('onb.peresnyat') : t('onb.snyatNabor')),
                        ),
                      ],
                    ),
                    const SizedBox(height: SozoSpace.s4),
                    Text(
                      items.join(' · '),
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.35),
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('onb.otpravitNaProverku'), busy: _busy, onPressed: ready ? _submit : null),
          if (!ready)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s8),
              child: Text(
                t('onb.knopkaOtkroetsyaKogdaBudut'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// M-04 «Обучение и мини-экзамен». Модули читаются офлайн, экзамен — только при сети:
/// офлайн-экзамен нельзя защитить от списывания.
class TrainingScreen extends StatefulWidget {
  const TrainingScreen({super.key});

  @override
  State<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends State<TrainingScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.examQuestions();
      final modules = session.onboarding?['modules'];
      if (mounted) setState(() => _data = {'exam': r, 'modules': modules});
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
      if (mounted) setState(() => _data = {'modules': session.onboarding?['modules']});
    }
  }

  Future<void> _openModule(Map<String, dynamic> m) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(m['title'].toString(), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: SozoSpace.s12),
              Text(m['summary'].toString(), style: const TextStyle(fontSize: 16, height: 1.5)),
              const SizedBox(height: SozoSpace.s24),
              PrimaryButton(
                label: t('onb.izuchil'),
                onPressed: () async {
                  Navigator.of(ctx).pop();
                  try {
                    await session.api.completeModule(m['id'].toString());
                    await session.refreshOnboarding();
                    await _load();
                  } on ApiError catch (e) {
                    if (mounted) showError(context, e.message);
                  }
                },
              ),
              const SizedBox(height: SozoSpace.s8),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final modules = ((_data?['modules'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final exam = _data?['exam'] as Map<String, dynamic>?;
    final available = exam?['available'] == true;
    final doneCount = modules.where((m) => m['done'] == true).length;

    return Scaffold(
      appBar: SozoAppBar(title: t('onb.obuchenie')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          SectionTitle(t('onb.moduliIz', {'p1': doneCount, 'p2': modules.length})),
          ...modules.map(
            (m) => Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SozoCard(
                onTap: () => _openModule(m),
                child: Row(
                  children: [
                    FigmaIcon(
                      m['done'] == true ? 'check-done' : 'play',
                      color: m['done'] == true ? SozoColors.success : SozoColors.accent,
                      size: 20,
                    ),
                    const SizedBox(width: SozoSpace.s12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            m['title'].toString(),
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                          ),
                          Text(
                            m['done'] == true ? t('onb.prosmotreno') : t('onb.okoloMin', {'p1': m['minutes']}),
                            style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    const FigmaIcon('chevron-right', size: 16, color: SozoColors.textSecondary),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('onb.miniEkzamen')),
          if (!available)
            BlockerNote(text: exam?['reason']?.toString() ?? t('onb.ekzamenPokaNedostupen'), icon: 'alert-circle')
          else
            PrimaryButton(
              label: t('onb.nachatEkzamen'),
              onPressed: () async {
                final passed = await Navigator.of(
                  context,
                ).push<bool>(MaterialPageRoute(builder: (_) => ExamScreen(exam: exam!)));
                if (passed != true) return;
                await session.refreshOnboarding();
                if (mounted) Navigator.of(this.context).pop();
              },
            ),
          const SizedBox(height: SozoSpace.s8),
          Text(t('onb.ekzamenDostupenTolkoPri'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// Экзамен: один вопрос на экран, крупные варианты — отвечают на ходу
class ExamScreen extends StatefulWidget {
  const ExamScreen({super.key, required this.exam});

  final Map<String, dynamic> exam;

  @override
  State<ExamScreen> createState() => _ExamScreenState();
}

class _ExamScreenState extends State<ExamScreen> {
  int _index = 0;
  final Map<String, int> _answers = {};
  Map<String, dynamic>? _result;
  bool _busy = false;

  List<Map<String, dynamic>> get _questions =>
      ((widget.exam['questions'] as List?) ?? const []).cast<Map<String, dynamic>>();

  Future<void> _finish() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.submitExam(_answers);
      if (mounted) setState(() => _result = r);
    } on ApiError catch (e) {
      if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_result != null) return _resultView();
    // Вопросы приходят с сервера; пустой список — не повод падать
    if (_questions.isEmpty) {
      return Scaffold(
        appBar: SozoAppBar(title: t('onb.ekzamen')),
        body: EmptyView(
          title: t('onb.voprosyNeZagruzilis'),
          subtitle: t('onb.proverteSvyazIOtkroyte'),
          icon: 'cloud-off',
        ),
      );
    }
    final q = _questions[_index];
    final options = ((q['options'] as List?) ?? const []).map((e) => e.toString()).toList();
    final answered = _answers.containsKey(q['id']);

    return Scaffold(
      appBar: SozoAppBar(title: t('onb.voprosIz', {'p1': _index + 1, 'p2': _questions.length})),
      body: Column(
        children: [
          LinearProgressIndicator(
            value: (_index + 1) / _questions.length,
            backgroundColor: SozoColors.border,
            valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                Text(
                  q['text'].toString(),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, height: 1.35),
                ),
                const SizedBox(height: SozoSpace.s24),
                ...options.asMap().entries.map(
                  (e) => Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                    child: SizedBox(
                      height: 56,
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => setState(() => _answers[q['id'].toString()] = e.key),
                        style: OutlinedButton.styleFrom(
                          backgroundColor: _answers[q['id']] == e.key
                              ? SozoColors.accent.withValues(alpha: 0.14)
                              : null,
                          side: BorderSide(color: _answers[q['id']] == e.key ? SozoColors.accent : SozoColors.border),
                          foregroundColor: SozoColors.text,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
                        ),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(e.value, style: const TextStyle(fontSize: 15)),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(SozoSpace.s16),
              child: PrimaryButton(
                label: _index == _questions.length - 1 ? t('onb.zavershit') : t('onb.dalshe'),
                busy: _busy,
                onPressed: !answered
                    ? null
                    : _index == _questions.length - 1
                    ? _finish
                    : () => setState(() => _index++),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _resultView() {
    final passed = _result!['passed'] == true;
    final score = (_result!['score'] as num).toInt();
    final wrongTopics = ((_result!['wrongTopics'] as List?) ?? const []).map((e) => e.toString()).toList();
    final attemptsLeft = (_result!['attemptsLeft'] as num?)?.toInt() ?? 0;
    final topicTitles = {
      'photo': t('onb.fotofiksaciya'),
      'client': t('onb.obschenieSKlientom'),
      'standards': t('onb.standartyServisa'),
      'pipeline': t('onb.konveyer'),
    };

    return Scaffold(
      appBar: SozoAppBar(title: t('onb.rezultat')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s24),
        children: [
          const SizedBox(height: SozoSpace.s24),
          Center(
            child: Column(
              children: [
                FigmaIcon(
                  passed ? 'shield-check' : 'rotate-ccw',
                  size: 72,
                  color: passed ? SozoColors.success : SozoColors.error,
                ),
                const SizedBox(height: SozoSpace.s16),
                Text(
                  t('onb.iz', {'p1': score, 'p2': _questions.length}),
                  style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w700),
                ),
                Text(
                  passed ? t('onb.sdano') : t('onb.neSdano'),
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: passed ? SozoColors.success : SozoColors.error,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s24),
          Text(
            _result!['message']?.toString() ?? '',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, height: 1.4),
          ),
          if (wrongTopics.isNotEmpty) ...[
            const SizedBox(height: SozoSpace.s24),
            SectionTitle(t('onb.razberiteTemy')),
            ...wrongTopics.map(
              (topic) => SozoCard(
                child: Row(
                  children: [
                    const FigmaIcon('book', size: 18, color: SozoColors.textSecondary),
                    const SizedBox(width: SozoSpace.s8),
                    Expanded(child: Text(topicTitles[topic] ?? topic)),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: SozoSpace.s24),
          if (passed)
            PrimaryButton(label: t('common.gotovo'), onPressed: () => Navigator.of(context).pop(true))
          else ...[
            Text(
              t('onb.popytokOstalos', {'p1': attemptsLeft}),
              textAlign: TextAlign.center,
              style: const TextStyle(color: SozoColors.textSecondary),
            ),
            const SizedBox(height: SozoSpace.s12),
            PrimaryButton(
              label: attemptsLeft > 0 ? t('onb.vernutsyaKModulyam') : t('onb.svyajitesSDispetcherom'),
              onPressed: () => Navigator.of(context).pop(false),
            ),
          ],
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}
