import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// Ветки «что-то пошло не так»: M-14 нет доступа, M-30 клиент недоступен,
/// M-31 небезопасно, M-32 не могу поехать.
///
/// Все четыре устроены одинаково: причина из справочника → доказательство фото →
/// отправка. Разница в том, что обязательно, а что нет — и это принципиально:
/// прерывание по безопасности не требует ничего, потому что человек может быть в опасности.
class BranchScreen extends StatefulWidget {
  const BranchScreen({super.key, required this.orderId, required this.orderNumber, required this.kind});

  final String orderId;
  final String orderNumber;
  final BranchKind kind;

  @override
  State<BranchScreen> createState() => _BranchScreenState();
}

enum BranchKind { noAccess, clientUnavailable, unsafe, cantGo }

class _BranchScreenState extends State<BranchScreen> {
  String? _reason;
  String? _photo;
  DateTime? _nextAttempt;
  final _commentCtrl = TextEditingController();
  List<({String code, String title})> _reasons = const [];
  bool _busy = false;

  bool get _photoRequired => widget.kind == BranchKind.noAccess || widget.kind == BranchKind.clientUnavailable;
  bool get _reasonRequired => widget.kind == BranchKind.noAccess || widget.kind == BranchKind.cantGo;

  @override
  void initState() {
    super.initState();
    _loadReasons();
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadReasons() async {
    if (!_reasonRequired) return;
    try {
      final d = await session.api.dictionaries();
      final key = widget.kind == BranchKind.noAccess ? 'noAccessReasons' : 'cantGoReasons';
      if (!mounted) return;
      setState(() {
        _reasons = ((d[key] as List?) ?? const [])
            .map((r) => (code: (r as Map)['code'].toString(), title: r['title'].toString()))
            .toList();
      });
    } on ApiError {
      // офлайн — справочники подтянутся при сети; ветку всё равно можно оформить
    }
  }

  ({String title, String subtitle, String button, String? note}) get _copy => switch (widget.kind) {
    BranchKind.noAccess => (
      title: t('branch.netDostupa'),
      subtitle: t('branch.tretyaStoronaNePustila'),
      button: t('common.otpravit'),
      note: t('branch.zayavkaVstanetNaPauzu'),
    ),
    BranchKind.clientUnavailable => (
      title: t('branch.klientNedostupen'),
      subtitle: t('branch.snimiteDverFiksiruemChto'),
      button: t('common.otpravit'),
      note: t('branch.dispetcherProzvanivaetKlientaD'),
    ),
    BranchKind.unsafe => (
      title: t('branch.prervatNebezopasno'),
      subtitle: t('branch.esliSituaciyaUgrojaetVam'),
      button: t('branch.prervatIUyti'),
      note: t('branch.sankciyZaPreryvanieNet'),
    ),
    BranchKind.cantGo => (
      title: t('branch.neMoguPoehat'),
      subtitle: t('branch.chestnyyRanniyOtkazMyagche'),
      button: t('branch.podtverditOtkaz'),
      note: t('branch.zamenaZapustitsyaNemedlennoUva'),
    ),
  };

  bool get _canSubmit {
    if (widget.kind == BranchKind.unsafe) return true; // безопасность не ждёт заполнения полей
    if (_reasonRequired && _reason == null) return false;
    if (_photoRequired && _photo == null) return false;
    if (widget.kind == BranchKind.cantGo && _reason == 'other' && _commentCtrl.text.trim().isEmpty) return false;
    return true;
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final id = widget.orderId;
    try {
      final Map<String, dynamic> r = switch (widget.kind) {
        BranchKind.noAccess => await session.api.noAccess(id, {
          'reasonCode': _reason,
          'photoDataUrl': _photo,
          'nextAttemptAt': _nextAttempt?.toUtc().toIso8601String(),
        }),
        BranchKind.clientUnavailable => await session.api.clientUnavailable(id, {'photoDataUrl': _photo}),
        BranchKind.unsafe => await session.api.abortUnsafe(id, {
          'comment': _commentCtrl.text.trim(),
          'photoDataUrl': _photo,
        }),
        BranchKind.cantGo => await session.api.cantGo(id, {'reasonCode': _reason, 'comment': _commentCtrl.text.trim()}),
      };
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('common.otpravleno')).toString());
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: id,
          kind: 'branch_${widget.kind.name}',
          payload: {'reasonCode': _reason, 'photoDataUrl': _photo, 'comment': _commentCtrl.text.trim()},
          title: '${widget.orderNumber}: ${_copy.title}',
        );
        if (!mounted) return;
        showOk(context, _offlineHint);
        Navigator.of(context).pop(true);
      } else if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  /// Офлайн-поведение разное: отказ и прозвон клиента требуют голосового звонка,
  /// потому что промедление стоит клиенту времени
  String get _offlineHint => switch (widget.kind) {
    BranchKind.cantGo => t('branch.netSetiOtkazOtpravitsya'),
    BranchKind.clientUnavailable => t('branch.netSetiProzvonNe'),
    _ => t('branch.netSetiOtpravitsyaPri'),
  };

  @override
  Widget build(BuildContext context) {
    final c = _copy;
    return Scaffold(
      appBar: SozoAppBar(title: c.title),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(c.subtitle, style: const TextStyle(fontSize: 16, height: 1.4)),
          const SizedBox(height: SozoSpace.s24),
          if (_reasonRequired) ...[
            SectionTitle(t('branch.prichina')),
            if (_reasons.isEmpty)
              Text(t('branch.spravochnikPrichinNeZagrujen'), style: TextStyle(color: SozoColors.textSecondary))
            else
              Wrap(
                spacing: SozoSpace.s8,
                runSpacing: SozoSpace.s8,
                children: _reasons
                    .map(
                      (r) => ChoiceChip(
                        label: Text(r.title),
                        selected: _reason == r.code,
                        onSelected: (_) => setState(() => _reason = r.code),
                        selectedColor: SozoColors.accent.withValues(alpha: 0.14),
                        labelStyle: TextStyle(color: _reason == r.code ? SozoColors.accent : SozoColors.text),
                      ),
                    )
                    .toList(),
              ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (widget.kind != BranchKind.cantGo) ...[
            SectionTitle(_photoRequired ? t('branch.fotoObyazatelno') : t('branch.fotoPoJelaniyu')),
            SozoCard(
              child: Row(
                children: [
                  FigmaIcon(
                    _photo != null ? 'check-done' : 'camera',
                    color: _photo != null ? SozoColors.success : SozoColors.textSecondary,
                    size: 20,
                  ),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(child: Text(_photo != null ? t('branch.snimokSdelan') : t('branch.snimokNeSdelan'))),
                  TextButton(
                    onPressed: () async {
                      await showPhotoCapture(
                        context,
                        title: widget.kind == BranchKind.clientUnavailable ? t('branch.fotoDveri') : t('branch.foto'),
                        stage: 'during',
                        alreadyTaken: _photo != null ? 1 : 0,
                        hint: widget.kind == BranchKind.noAccess
                            ? t('branch.snimiteZakrytuyuDverIli')
                            : t('branch.snimokFiksiruetChtoVy'),
                        onUpload: (dataUrl) async {
                          setState(() => _photo = dataUrl);
                          return true;
                        },
                      );
                    },
                    child: Text(t('common.snyat')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (widget.kind == BranchKind.noAccess) ...[
            SectionTitle(t('branch.sleduyuschayaPopytkaPoJelaniyu')),
            SozoCard(
              onTap: () async {
                final d = await showDatePicker(
                  context: context,
                  firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 60)),
                  initialDate: DateTime.now().add(const Duration(days: 1)),
                );
                if (d != null) setState(() => _nextAttempt = d);
              },
              child: Row(
                children: [
                  const FigmaIcon('calendar', size: 20, color: SozoColors.textSecondary),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Text(
                      _nextAttempt == null
                          ? t('branch.dataNeUkazanaDispetcher')
                          : t('branch.vernutsya', {
                              'p1': _nextAttempt!.day,
                              'p2': _nextAttempt!.month,
                              'p3': _nextAttempt!.year,
                            }),
                    ),
                  ),
                  const FigmaIcon('chevron-right', size: 16, color: SozoColors.textSecondary),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (widget.kind == BranchKind.unsafe || widget.kind == BranchKind.cantGo) ...[
            SectionTitle(
              widget.kind == BranchKind.cantGo && _reason == 'other'
                  ? t('branch.kommentariyObyazatelen')
                  : t('branch.kommentariyPoJelaniyu'),
            ),
            TextField(
              controller: _commentCtrl,
              maxLines: 3,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
              ),
            ),
            const SizedBox(height: SozoSpace.s16),
          ],
          if (c.note != null) BlockerNote(text: c.note!, icon: 'alert-circle'),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(
            label: c.button,
            busy: _busy,
            danger: widget.kind == BranchKind.unsafe || widget.kind == BranchKind.cantGo,
            onPressed: _canSubmit ? _submit : null,
          ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}
