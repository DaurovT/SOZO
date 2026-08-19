import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/absence_dialog.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_icon.dart';
import '../i18n.dart';

/// График как вкладка оболочки — без собственного заголовка, его рисует оболочка
class ScheduleTab extends StatelessWidget {
  const ScheduleTab({super.key});

  @override
  Widget build(BuildContext context) => const ScheduleScreen(embedded: true);
}

/// M-40 «График и отпуска». MVP — базовый календарь смен и заявки на отсутствие.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key, this.embedded = false});

  /// Внутри вкладки заголовок и стрелку назад рисует оболочка
  final bool embedded;

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.schedule();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _request() async {
    final req = await showAbsenceDialog(context);
    if (req == null || !mounted) return;
    try {
      await session.api.requestTimeOff({
        'from': req.from.toIso8601String().substring(0, 10),
        'to': req.to.toIso8601String().substring(0, 10),
        'kind': req.kind,
        'comment': req.comment,
      });
      if (!mounted) return;
      showOk(context, t('prof.zayavkaOtpravlenaDispetcheru'));
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = ((_data?['days'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final requests = ((_data?['requests'] as List?) ?? const []).cast<Map<String, dynamic>>();
    // Внутри вкладки шапка стоит над списком и не скроллится: если положить
    // её в ListView, белая полоса окажется в отступах и уедет при прокрутке
    final body = _data == null
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s32),
            children: [
              Text(
                t('prof.smeny', {'p1': _data!['month']}),
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
              const SizedBox(height: SozoSpace.s12),
              _calendarCard(days),
              const SizedBox(height: SozoSpace.s12),
              Text(
                t('prof.vydelennyeVashiSmenyD'),
                style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4),
              ),
              const SizedBox(height: SozoSpace.s16),
              _vacationButton(),
              const SizedBox(height: SozoSpace.s16),
              if (requests.isNotEmpty) ...[
                Text(
                  t('list.moiZayavki'),
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
                const SizedBox(height: SozoSpace.s12),
                ...requests.map(
                  (r) => Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                    child: _requestCard(r),
                  ),
                ),
              ],
              Text(
                _data!['note']?.toString() ?? '',
                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4),
              ),
            ],
          );

    if (!widget.embedded) {
      return Scaffold(
        appBar: SozoAppBar(title: t('prof.grafik')),
        body: body,
      );
    }
    return Column(
      children: [
        SozoTabHeader(t('prof.grafik')),
        Expanded(child: body),
      ],
    );
  }

  /// Календарь месяца (макет 51:121): девять клеток 32 в ряду, между ними
  /// равные промежутки — сетка читается как календарь, а не как список
  Widget _calendarCard(List<Map<String, dynamic>> days) {
    const perRow = 9;
    final rows = <List<Map<String, dynamic>?>>[];
    for (var i = 0; i < days.length; i += perRow) {
      final end = i + perRow > days.length ? days.length : i + perRow;
      // Новый список, а не cast поверх days: в приведённый список null не добавить
      final row = <Map<String, dynamic>?>[...days.sublist(i, end)];
      while (row.length < perRow) {
        row.add(null); // добиваем пустыми, иначе последний ряд разъедется
      }
      rows.add(row);
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Column(
        children: [
          for (var r = 0; r < rows.length; r++) ...[
            if (r > 0) const SizedBox(height: SozoSpace.s12),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: rows[r].map(_dayChip).toList()),
          ],
        ],
      ),
    );
  }

  Widget _dayChip(Map<String, dynamic>? d) {
    if (d == null) return const SizedBox(width: 32, height: 32);
    final day = dayOfMonth(d['date']);
    final hasShift = d['shift'] == true;
    final duty = d['duty'] == true;
    return Container(
      width: 32,
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: duty
            ? softWarnBg
            : hasShift
            ? toggleActiveBg
            : SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.badge),
        border: Border.all(color: hasShift || duty ? SozoColors.accent : SozoColors.border),
      ),
      child: Text(
        duty ? t('prof.d') : day,
        style: TextStyle(
          fontSize: 13,
          fontWeight: hasShift || duty ? FontWeight.w700 : FontWeight.w500,
          color: hasShift || duty ? SozoColors.text : SozoColors.textSecondary,
        ),
      ),
    );
  }

  /// Янтарная кнопка с зонтиком (макет 51:194)
  Widget _vacationButton() {
    return Material(
      color: SozoColors.accent,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: _request,
        child: Container(
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: const EdgeInsets.all(14),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FigmaIcon('umbrella', size: 18),
              SizedBox(width: SozoSpace.s8),
              Text(
                t('prof.zaprositOtpusk'),
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.onAccent),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Заявка на отсутствие (макет 51:199)
  Widget _requestCard(Map<String, dynamic> r) {
    final status = r['status']?.toString() ?? 'pending';
    final (bg, fg) = switch (status) {
      'approved' => (softSuccessBg, softSuccessFg),
      'rejected' => (softDangerBg, softDangerFg),
      _ => (pendingBadgeBg, pendingBadgeFg),
    };
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t('prof.x', {
                    'p1': r['kind'] == 'sick' ? t('absence.bolnichnyy') : t('absence.otpusk'),
                    'p2': r['from'],
                    'p3': r['to'],
                  }),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: SozoColors.text),
                ),
                if (r['reason'] != null)
                  Text(r['reason'].toString(), style: const TextStyle(fontSize: 12, color: softDangerFg)),
              ],
            ),
          ),
          const SizedBox(width: SozoSpace.s8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
            child: Text(switch (status) {
              'approved' => t('prof.odobren'),
              'rejected' => t('onb.otklonen'),
              _ => t('prof.naRassmotrenii'),
            }, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
          ),
        ],
      ),
    );
  }
}

/// M-41 «Приведи мастера» — реферальная программа
class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key});

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.referrals();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final invited = ((d?['invited'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: SozoAppBar(title: t('prof.privediMastera')),
      body: d == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                SozoCard(
                  accent: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t('prof.vashKod'), style: TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
                      const SizedBox(height: SozoSpace.s4),
                      SelectableText(
                        d['code'].toString(),
                        style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: 2),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                      SelectableText(
                        d['link'].toString(),
                        style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: SozoSpace.s16),
                if (invited.isEmpty)
                  EmptyView(title: d['empty']?.toString() ?? t('prof.pokaNikogo'), icon: 'users')
                else
                  ...invited.map(
                    (i) => SozoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  i['fullName'].toString(),
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                                ),
                              ),
                              StatusChip(label: i['bonusStatus'].toString(), status: 'new'),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s8),
                          LinearProgressIndicator(
                            value: ((i['closedOrders'] as num?)?.toInt() ?? 0) / ((d['target'] as num?)?.toInt() ?? 20),
                            minHeight: 6,
                            backgroundColor: SozoColors.border,
                            valueColor: const AlwaysStoppedAnimation(SozoColors.accent),
                          ),
                          const SizedBox(height: SozoSpace.s4),
                          Text(
                            t('prof.izZakrytyhZayavok', {'p1': i['closedOrders'], 'p2': d['target']}),
                            style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: SozoSpace.s32),
              ],
            ),
    );
  }
}

/// M-37 «Моё оборудование» — материальная ответственность
class EquipmentScreen extends StatefulWidget {
  const EquipmentScreen({super.key});

  @override
  State<EquipmentScreen> createState() => _EquipmentScreenState();
}

class _EquipmentScreenState extends State<EquipmentScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.equipment();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final items = ((d?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: SozoAppBar(title: t('common.moeOborudovanie')),
      body: d == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                if (items.isEmpty)
                  EmptyView(
                    title: d['empty']?.toString() ?? t('prof.oborudovanieNeVydano'),
                    subtitle: d['note']?.toString(),
                    icon: 'toolbox',
                  )
                else
                  ...items.map((i) => SozoCard(child: Text(i['name'].toString()))),
                const SizedBox(height: SozoSpace.s16),
                SozoCard(
                  child: Row(
                    children: [
                      FigmaIcon(
                        d['hasVehicle'] == true ? 'car' : 'navigation',
                        color: SozoColors.textSecondary,
                        size: 20,
                      ),
                      const SizedBox(width: SozoSpace.s12),
                      Expanded(
                        child: Text(
                          d['hasVehicle'] == true ? t('prof.svoyTransportSInstrumentom') : t('prof.bezTransporta'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: SozoSpace.s32),
              ],
            ),
    );
  }
}

/// M-39 «Проверка инструмента» — неполный набор снимает навык до восстановления
class ToolCheckScreen extends StatefulWidget {
  const ToolCheckScreen({super.key});

  @override
  State<ToolCheckScreen> createState() => _ToolCheckScreenState();
}

class _ToolCheckScreenState extends State<ToolCheckScreen> {
  Map<String, dynamic>? _data;
  final Map<String, Set<String>> _checked = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.toolChecklist();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _confirm(String skill, List<String> items) async {
    final have = _checked[skill] ?? {};
    final missing = items.where((i) => !have.contains(i)).toList();
    if (missing.isNotEmpty) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t('prof.instrumentNepolnyy')),
          content: Text(t('prof.neHvataetNNnavyk', {'p1': missing.join(', '), 'p2': tv(skill)})),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('prof.podtverdit'))),
          ],
        ),
      );
      if (ok != true) return;
    }
    try {
      final r = await session.api.toolCheck({
        'skill': skill,
        'complete': missing.isEmpty,
        'missing': missing.join(', '),
      });
      if (!mounted) return;
      showOk(
        context,
        r['skillSuspended'] == true ? t('prof.navykSnyatDoVosstanovleniya') : t('prof.instrumentPodtverjden'),
      );
      await session.refreshProfile();
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final skills = ((_data?['skills'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: SozoAppBar(title: t('prof.proverkaInstrumenta')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s32),
              children: [
                Text(
                  _data!['note']?.toString() ?? t('prof.bezPolnogoNaboraNavyk'),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
                ),
                const SizedBox(height: SozoSpace.s16),
                ...skills.map((s) {
                  final skill = s['skill'].toString();
                  final items = ((s['items'] as List?) ?? const []).map((e) => e.toString()).toList();
                  final have = _checked.putIfAbsent(skill, () => <String>{});
                  final complete = have.length == items.length;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s16),
                    child: Container(
                      padding: const EdgeInsets.all(SozoSpace.s16),
                      decoration: BoxDecoration(
                        color: SozoColors.surface,
                        borderRadius: BorderRadius.circular(SozoRadius.card),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                tv(skill).toLowerCase(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                  color: SozoColors.text,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: SozoSpace.s4),
                                decoration: BoxDecoration(
                                  color: complete ? softSuccessBg : softDangerBg,
                                  borderRadius: BorderRadius.circular(SozoRadius.chip),
                                ),
                                child: Text(
                                  complete ? t('prof.vseNaMeste') : t('prof.neHvataet'),
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: complete ? softSuccessFg : dangerSolid,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s16),
                          ...items.map(
                            (i) => _toolRow(i, have.contains(i), () {
                              setState(() => have.contains(i) ? have.remove(i) : have.add(i));
                            }),
                          ),
                          const SizedBox(height: SozoSpace.s16),
                          _toolButton(
                            complete: complete,
                            label: complete
                                ? t('prof.podtverjdayuVseNaMeste')
                                : t('prof.neHvataet2', {'p1': items.length - have.length}),
                            onTap: () => _confirm(skill, items),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ],
            ),
    );
  }

  /// Строка инструмента (макет 58:775): флажок 22 справа, линия снизу
  Widget _toolRow(String title, bool checked, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: Container(
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: SozoColors.border)),
        ),
        padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: SozoColors.text),
              ),
            ),
            Container(
              width: 22,
              height: 22,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: checked ? SozoColors.accent : Colors.transparent,
                borderRadius: BorderRadius.circular(6),
                border: checked ? null : Border.all(color: SozoColors.textSecondary, width: 2),
              ),
              child: checked ? const FigmaIcon('check-12', size: 12) : null,
            ),
          ],
        ),
      ),
    );
  }

  /// Кнопка подтверждения набора (макет 58:791 и 58:812): янтарная, когда всё
  /// на месте, и красная-заливкой, когда нет — это не «ошибка ввода», а факт
  Widget _toolButton({required bool complete, required String label, required VoidCallback onTap}) {
    return Material(
      color: complete ? SozoColors.accent : dangerSolid,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FigmaIcon(complete ? 'check-16' : 'alert-triangle-white', size: 16),
              const SizedBox(width: SozoSpace.s8),
              Text(
                label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: complete ? SozoColors.onAccent : SozoColors.surface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Квартальный NPS (ТЗ 17.17 п.11) — два тапа, не чаще раза в 90 дней
Future<void> maybeAskNps(BuildContext context) async {
  try {
    final due = await session.api.npsDue();
    if (due['due'] != true || !context.mounted) return;
    final score = await showModalBottomSheet<int>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                due['question']?.toString() ?? t('prof.oceniteRabotuVSozo'),
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, height: 1.35),
              ),
              const SizedBox(height: SozoSpace.s16),
              Wrap(
                spacing: SozoSpace.s8,
                runSpacing: SozoSpace.s8,
                children: List.generate(
                  11,
                  (i) => ActionChip(label: Text('$i'), onPressed: () => Navigator.of(ctx).pop(i)),
                ),
              ),
              const SizedBox(height: SozoSpace.s8),
              Text(t('prof.nTochnoNePorekomenduyu'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
            ],
          ),
        ),
      ),
    );
    if (score == null || !context.mounted) return;
    await session.api.submitNps(score);
    if (context.mounted) showOk(context, t('prof.spasiboEtoVliyaetNa'));
  } on ApiError {
    // опрос не критичен: молча пропускаем при любой ошибке
  }
}
