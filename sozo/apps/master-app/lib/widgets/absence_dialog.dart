import 'package:flutter/material.dart';

import '../design_tokens.dart';
import 'figma_icon.dart';
import '../i18n.dart';

/// Заявка на отсутствие (макет 58:122) — собственный календарь-диапазон.
///
/// Системный showDateRangePicker открывается на весь экран и выглядит чужим;
/// здесь мастер видит и тип отсутствия, и даты, и комментарий одним листом.
class AbsenceRequest {
  const AbsenceRequest({required this.kind, required this.from, required this.to, required this.comment});

  final String kind;
  final DateTime from;
  final DateTime to;
  final String comment;
}

Future<AbsenceRequest?> showAbsenceDialog(BuildContext context) {
  return showDialog<AbsenceRequest>(
    context: context,
    barrierColor: const Color(0x66000000),
    builder: (_) => const _AbsenceDialog(),
  );
}

class _AbsenceDialog extends StatefulWidget {
  const _AbsenceDialog();

  @override
  State<_AbsenceDialog> createState() => _AbsenceDialogState();
}

class _AbsenceDialogState extends State<_AbsenceDialog> {
  /// Геттеры, а не поля: язык переключается без перезапуска, и список,
  /// посчитанный один раз при создании состояния, остался бы на прежнем.
  static List<String> get _months => [
    t('absence.yanvar'),
    t('absence.fevral'),
    t('absence.mart'),
    t('absence.aprel'),
    t('absence.may'),
    t('absence.iyun'),
    t('absence.iyul'),
    t('absence.avgust'),
    t('absence.sentyabr'),
    t('absence.oktyabr'),
    t('absence.noyabr'),
    t('absence.dekabr'),
  ];
  static List<String> get _weekdays => [
    t('absence.pn'),
    t('absence.vt'),
    t('absence.sr'),
    t('absence.cht'),
    t('absence.pt'),
    t('absence.sb'),
    t('absence.vs'),
  ];

  final _comment = TextEditingController();
  String _kind = 'vacation';
  late DateTime _month;
  DateTime? _from;
  DateTime? _to;
  bool _pickerOpen = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = DateTime(now.year, now.month);
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  /// Первый тап задаёт начало, второй — конец. Тап раньше начала
  /// начинает диапазон заново: так проще, чем объяснять ошибку.
  void _tapDay(DateTime day) {
    setState(() {
      if (_from == null || _to != null || day.isBefore(_from!)) {
        _from = day;
        _to = null;
      } else {
        _to = day;
      }
    });
  }

  int get _days => _from == null || _to == null ? 0 : _to!.difference(_from!).inDays + 1;

  bool _inRange(DateTime d) => _from != null && _to != null && d.isAfter(_from!) && d.isBefore(_to!);

  bool _isEnd(DateTime d) => (_from != null && _sameDay(d, _from!)) || (_to != null && _sameDay(d, _to!));

  static bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  static String _dm(DateTime d) => '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: SozoSpace.s32),
      backgroundColor: SozoColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('absence.zaprositOtsutstvie'),
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
              const SizedBox(height: 20),
              _typeToggle(),
              const SizedBox(height: 20),
              _datesButton(),
              if (_pickerOpen) ...[const SizedBox(height: 20), _calendar()],
              const SizedBox(height: 20),
              _commentField(),
              const SizedBox(height: 20),
              _actions(),
            ],
          ),
        ),
      ),
    );
  }

  /// Переключатель типа: две половины в одной рамке (макет 58:124)
  Widget _typeToggle() {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
        border: Border.all(color: SozoColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          Expanded(child: _typeHalf('vacation', t('absence.otpusk'))),
          Expanded(child: _typeHalf('sick', t('absence.bolnichnyy'))),
        ],
      ),
    );
  }

  Widget _typeHalf(String code, String label) {
    final selected = _kind == code;
    return Material(
      color: selected ? SozoColors.accent.withValues(alpha: 0.1) : SozoColors.surface,
      child: InkWell(
        onTap: () => setState(() => _kind = code),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (selected) ...[const FigmaIcon('check', size: 14), const SizedBox(width: 6)],
              Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                  color: selected ? SozoColors.text : SozoColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Кнопка-пилюля «Выбрать даты» (макет 58:130)
  Widget _datesButton() {
    final label = _from == null
        ? t('absence.vybratDaty')
        : _to == null
        ? t('absence.sVyberiteKonec', {'p1': _dm(_from!)})
        : t('absence.sPo', {'p1': _dm(_from!), 'p2': _dm(_to!)});
    return Material(
      color: SozoColors.accent.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => setState(() => _pickerOpen = !_pickerOpen),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: SozoColors.accent, width: 1.5),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const FigmaIcon('calendar', size: 16),
              const SizedBox(width: SozoSpace.s8),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.accent),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Календарь месяца (макет 58:133): недели с понедельника, шесть рядов
  Widget _calendar() {
    final first = DateTime(_month.year, _month.month);
    final startOffset = first.weekday - 1; // 0 = понедельник
    final gridStart = first.subtract(Duration(days: startOffset));
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s8),
      decoration: BoxDecoration(
        color: fieldBg,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: SozoColors.border),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Поле нажатия 48: голая иконка 18 в перчатке не ловится,
              // а промах по стрелке месяца стоит перелистанного календаря
              SizedBox(
                width: SozoSize.tap,
                height: SozoSize.tap,
                child: InkWell(
                  borderRadius: BorderRadius.circular(SozoSize.tap / 2),
                  onTap: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
                  child: const Center(child: FigmaIcon('chevron-left', size: 20)),
                ),
              ),
              Text(
                '${_months[_month.month - 1]} ${_month.year}',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
              SizedBox(
                width: SozoSize.tap,
                height: SozoSize.tap,
                child: InkWell(
                  borderRadius: BorderRadius.circular(SozoSize.tap / 2),
                  onTap: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
                  child: const Center(child: FigmaIcon('chevron-right', size: 20)),
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: _weekdays
                .map(
                  (w) => SizedBox(
                    width: 44,
                    child: Text(
                      w,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: SozoColors.textSecondary,
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: SozoSpace.s12),
          for (var week = 0; week < 6; week++) ...[
            if (week > 0) const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List.generate(7, (i) => _day(gridStart.add(Duration(days: week * 7 + i)))),
            ),
          ],
          const SizedBox(height: SozoSpace.s12),
          Padding(
            padding: const EdgeInsets.only(top: SozoSpace.s4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _from == null
                      ? t('absence.datyNeVybrany')
                      : t('absence.sPo', {'p1': _dm(_from!), 'p2': _to == null ? '…' : _dm(_to!)}),
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.accent),
                ),
                if (_days > 0) ...[
                  const SizedBox(width: SozoSpace.s4),
                  Text(
                    t('absence.dn', {'p1': _days}),
                    style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _day(DateTime d) {
    final otherMonth = d.month != _month.month;
    final end = _isEnd(d);
    final middle = _inRange(d);
    // Клетка 44, а не макетные 34: отпуск и больничный отмечают пальцем,
    // и промах по соседнему дню замечают уже в ответе диспетчера
    return SizedBox(
      width: 44,
      height: 44,
      child: Material(
        color: end
            ? SozoColors.accent
            : middle
            ? SozoColors.accent.withValues(alpha: 0.13)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(end ? 22 : SozoRadius.s4),
        child: InkWell(
          borderRadius: BorderRadius.circular(end ? 22 : SozoRadius.s4),
          onTap: otherMonth ? null : () => _tapDay(d),
          child: Center(
            child: Text(
              '${d.day}',
              style: TextStyle(
                fontSize: 15,
                fontWeight: end ? FontWeight.w700 : FontWeight.w500,
                color: otherMonth ? dayOutside : SozoColors.text,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _commentField() {
    return Container(
      decoration: BoxDecoration(
        color: fieldBg,
        borderRadius: BorderRadius.circular(SozoRadius.thumb),
        border: Border.all(color: SozoColors.border),
      ),
      padding: const EdgeInsets.all(SozoSpace.s12),
      child: TextField(
        controller: _comment,
        style: const TextStyle(fontSize: 14, color: SozoColors.text),
        decoration: InputDecoration(
          hintText: t('absence.kommentariy'),
          hintStyle: TextStyle(fontSize: 14, color: placeholderGrey),
          isDense: true,
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: EdgeInsets.zero,
        ),
      ),
    );
  }

  Widget _actions() {
    final ready = _from != null && _to != null;
    return Row(
      children: [
        Expanded(
          child: Material(
            color: cancelBg,
            borderRadius: BorderRadius.circular(SozoRadius.button),
            child: InkWell(
              borderRadius: BorderRadius.circular(SozoRadius.button),
              onTap: () => Navigator.of(context).pop(),
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 18),
                child: Center(
                  child: Text(
                    t('common.otmena'),
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: cancelFg),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: SozoSpace.s12),
        Expanded(
          child: Material(
            color: ready ? SozoColors.accent : SozoColors.border,
            borderRadius: BorderRadius.circular(SozoRadius.button),
            child: InkWell(
              borderRadius: BorderRadius.circular(SozoRadius.button),
              onTap: ready
                  ? () => Navigator.of(
                      context,
                    ).pop(AbsenceRequest(kind: _kind, from: _from!, to: _to!, comment: _comment.text.trim()))
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 18),
                child: Center(
                  child: Text(
                    t('common.otpravit'),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: ready ? SozoColors.onAccent : SozoColors.textSecondary,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
