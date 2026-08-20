import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/common.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';

/// Наряд-допуск, пропуск и отключение ресурса (M-43…M-45, DEV-15 §10.4).
///
/// Экраны офлайн-первые по правилу PRD-02 §6: наряд приезжает в устройство
/// вместе с заявкой и читается из кеша, а «Открыл» и «Закрыл» уходят в очередь.
///
/// Главное правило здесь — гейт старта. Мастер офлайн не может спросить сервер
/// о статусе наряда, поэтому решение принимается по закешированному значению:
/// approved или scheduled — открывать можно; requested или rescheduled — нельзя,
/// и экран говорит об этом прямо, а не показывает молча неактивную кнопку.

/// Наряд в том виде, в каком он лежит в кеше заявки.
class PermitInfo {
  const PermitInfo({
    required this.id,
    required this.status,
    required this.zoneLabels,
    required this.hasCriticalZone,
    required this.requiresShutdown,
    required this.affectedUnits,
    required this.windowText,
    this.escortName,
    this.dutyPhone,
    this.shutdownId,
    this.shutdownResource,
    this.shutdownStartedAt,
    this.qrToken,
    this.fallbackCode,
    this.passRules = const [],
  });

  final String id;
  final String status;
  final List<String> zoneLabels;
  final bool hasCriticalZone;
  final bool requiresShutdown;
  final int affectedUnits;
  final String windowText;
  final String? escortName;
  final String? dutyPhone;
  final String? shutdownId;
  final String? shutdownResource;
  final String? shutdownStartedAt;
  final String? qrToken;
  final String? fallbackCode;
  final List<String> passRules;

  /// Можно ли вскрывать зону по данным, которые есть в устройстве.
  /// Сознательно не спрашиваем сервер: в подвале его нет.
  bool get canOpenOffline => status == 'approved' || status == 'scheduled';
  bool get isOpen => status == 'opened';
  bool get isClosed => status == 'closed';

  static PermitInfo fromJson(Map<String, dynamic> j) => PermitInfo(
    id: j['id'] as String,
    status: j['status'] as String? ?? 'draft',
    zoneLabels: ((j['zoneLabels'] ?? j['zoneTypes']) as List?)?.map((e) => '$e').toList() ?? const [],
    hasCriticalZone: j['hasCriticalZone'] as bool? ?? false,
    requiresShutdown: j['requiresShutdown'] as bool? ?? false,
    affectedUnits: ((j['affectedUnitIds'] as List?)?.length) ?? 0,
    windowText: j['windowText'] as String? ?? '',
    escortName: j['escortName'] as String?,
    dutyPhone: j['dutyPhone'] as String?,
    shutdownId: j['shutdownId'] as String?,
    shutdownResource: j['shutdownResource'] as String?,
    shutdownStartedAt: j['shutdownStartedAt'] as String?,
    qrToken: j['qrToken'] as String?,
    fallbackCode: j['fallbackCode'] as String?,
    passRules: ((j['passRules'] as List?)?.map((e) => '$e').toList()) ?? const [],
  );
}

class PermitScreen extends StatefulWidget {
  const PermitScreen({super.key, required this.session, required this.orderId, required this.permit});

  final Session session;
  final String orderId;
  final PermitInfo permit;

  @override
  State<PermitScreen> createState() => _PermitScreenState();
}

class _PermitScreenState extends State<PermitScreen> {
  late PermitInfo _p = widget.permit;
  bool _busy = false;
  String? _photoId;

  Future<void> _act(String action) async {
    if (_busy) return;
    setState(() => _busy = true);
    final body = <String, dynamic>{'action': action, if (_photoId != null) 'photoId': _photoId};
    try {
      final r = await widget.session.api.post('/permits/${_p.id}/transitions', body);
      if (!mounted) return;
      setState(() => _p = PermitInfo.fromJson(Map<String, dynamic>.from(r as Map)));
      showOk(context, action == 'open' ? t('permit.zonaVskryta') : t('permit.zonaZakryta'));
    } on Object catch (e) {
      // Офлайн — в очередь: именно ради этого случая экран и существует
      await widget.session.outbox.enqueue(
        orderId: widget.orderId,
        kind: 'permit_$action',
        payload: {'permitId': _p.id, ...body},
        title: action == 'open' ? t('permit.vskrytieZony') : t('permit.zakrytieZony'),
      );
      if (!mounted) return;
      setState(() => _p = PermitInfo.fromJson({..._toJson(_p), 'status': action == 'open' ? 'opened' : 'closed'}));
      showOk(context, t('permit.netSetiOtmetkaUydet'));
      debugPrint('permit $action queued: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> _toJson(PermitInfo p) => {
    'id': p.id,
    'status': p.status,
    'zoneLabels': p.zoneLabels,
    'hasCriticalZone': p.hasCriticalZone,
    'requiresShutdown': p.requiresShutdown,
    'affectedUnitIds': List.filled(p.affectedUnits, ''),
    'windowText': p.windowText,
    'escortName': p.escortName,
    'dutyPhone': p.dutyPhone,
    'shutdownId': p.shutdownId,
    'shutdownResource': p.shutdownResource,
    'shutdownStartedAt': p.shutdownStartedAt,
    'qrToken': p.qrToken,
    'fallbackCode': p.fallbackCode,
    'passRules': p.passRules,
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: AppBar(title: Text(t('permit.naryadDopusk'))),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          OfflineBar(outbox: widget.session.outbox),
          const SizedBox(height: SozoSpace.s8),
          _permitCard(),
          const SizedBox(height: SozoSpace.s12),
          if (_p.escortName != null || _p.dutyPhone != null) _escortCard(),
          if (_p.qrToken != null) ...[const SizedBox(height: SozoSpace.s12), _passCard()],
          if (_p.requiresShutdown) ...[const SizedBox(height: SozoSpace.s12), _shutdownCard()],
          const SizedBox(height: SozoSpace.s24),
          _action(),
        ],
      ),
    );
  }

  Widget _permitCard() {
    return SozoCard(
      leftStripe: _p.canOpenOffline || _p.isOpen ? SozoColors.success : SozoColors.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: SozoSpace.s8,
            runSpacing: SozoSpace.s4,
            children: [
              StatusChip(label: _statusLabel(_p.status), status: _p.status),
              for (final z in _p.zoneLabels) StatusChip(label: z, status: 'new'),
            ],
          ),
          const SizedBox(height: SozoSpace.s12),
          Text(_p.windowText, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          if (_p.hasCriticalZone) ...[
            const SizedBox(height: SozoSpace.s12),
            // Метка критичной зоны — иконкой и словом, а не цветом:
            // цвет уже занят статусами наряда (DEV-06 §4.N)
            BlockerNote(
              text: t('permit.kritichnayaZona'),
              icon: 'alert-triangle',
              danger: true,
            ),
          ],
          if (_p.requiresShutdown) ...[
            const SizedBox(height: SozoSpace.s8),
            BlockerNote(text: t('permit.otklyuchenieZatronet', {'p1': '${_p.affectedUnits}'}), icon: 'zap'),
          ],
        ],
      ),
    );
  }

  Widget _escortCard() => SozoCard(
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t('permit.vstrechaet', {'p1': _p.escortName ?? t('permit.utochniteUDispetchera')}),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
              if (_p.dutyPhone != null)
                Padding(
                  padding: const EdgeInsets.only(top: SozoSpace.s4),
                  child: Text(t('permit.dejurnyy', {'p1': '${_p.dutyPhone}'}),
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                ),
            ],
          ),
        ),
        if (_p.dutyPhone != null) const FigmaIcon('phone', size: 20),
      ],
    ),
  );

  /// M-44. QR рендерится из закешированного токена — сеть не нужна.
  /// Резервный код обязателен: у охраны сети может не быть тоже.
  Widget _passCard() => SozoCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(t('permit.propuskVZdanie')),
        const SizedBox(height: SozoSpace.s8),
        Center(
          child: Container(
            width: 200,
            height: 200,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(SozoRadius.thumb),
              border: Border.all(color: SozoColors.border),
            ),
            alignment: Alignment.center,
            // Код машиночитаемый: чёрный на белом, без стилизации и логотипа —
            // надёжность сканирования важнее оформления (DEV-06 §4.10)
            child: QrImageView(data: _p.qrToken ?? '', size: 176, backgroundColor: Colors.white),
          ),
        ),
        const SizedBox(height: SozoSpace.s12),
        Center(
          child: Text(
            _p.fallbackCode ?? '—',
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: 4),
          ),
        ),
        Center(
          child: Text(t('permit.kodDlyaOhrany'),
              style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
        ),
        if (_p.passRules.isNotEmpty) ...[
          const SizedBox(height: SozoSpace.s12),
          for (final r in _p.passRules) InfoRow(label: t('permit.pravilo'), value: r),
        ],
      ],
    ),
  );

  /// M-45. Факт отключения и включения с фото — юридически значимые отметки.
  Widget _shutdownCard() => SozoCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(t('permit.otklyuchenie', {'p1': _p.shutdownResource ?? t('permit.resurs')})),
        const SizedBox(height: SozoSpace.s8),
        InfoRow(label: t('permit.zatronuto'), value: t('permit.pomesch', {'p1': '${_p.affectedUnits}'})),
        InfoRow(label: t('permit.fakticheskiOtklyucheno'), value: _p.shutdownStartedAt ?? t('permit.netOtmetki')),
        const SizedBox(height: SozoSpace.s12),
        Row(
          children: [
            Expanded(
              child: SecondaryButton(
                label: _p.shutdownStartedAt == null ? t('permit.otklyuchil') : t('permit.vklyuchil'),
                onPressed: _busy || _p.shutdownId == null ? null : _toggleShutdown,
              ),
            ),
          ],
        ),
        const SizedBox(height: SozoSpace.s8),
        Text(
          t('permit.obOknePredupredil'),
          style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
        ),
      ],
    ),
  );

  Future<void> _toggleShutdown() async {
    final started = _p.shutdownStartedAt != null;
    setState(() => _busy = true);
    try {
      await widget.session.api.post('/shutdowns/${_p.shutdownId}/${started ? 'restore' : 'start'}', {});
      if (!mounted) return;
      setState(() => _p = PermitInfo.fromJson({
        ..._toJson(_p),
        'shutdownStartedAt': started ? _p.shutdownStartedAt : DateTime.now().toIso8601String(),
      }));
      showOk(context, started ? t('permit.resursVklyuchen') : t('permit.resursOtklyuchen'));
    } on Object catch (_) {
      await widget.session.outbox.enqueue(
        orderId: widget.orderId,
        kind: started ? 'shutdown_restore' : 'shutdown_start',
        payload: {'shutdownId': _p.shutdownId},
        title: started ? t('permit.vklyuchenieResursa') : t('permit.otklyuchenieResursa'),
      );
      if (mounted) showOk(context, t('permit.netSetiOtmetkaUydet'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Камера-only, как во всём конвейере мастера (ТЗ 7.1 шаг 2).
  /// Снимок уходит тем же путём, что фото «до/после» заявки.
  Future<void> _capture(String stage, String title) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => PhotoCaptureSheet(
        title: title,
        stage: stage,
        alreadyTaken: _photoId == null ? 0 : 1,
        onUpload: (dataUrl) async {
          try {
            final r = await widget.session.api.uploadPhoto(widget.orderId, {'stage': stage, 'data': dataUrl});
            if (mounted) setState(() => _photoId = (r['id'] ?? r['photoId'])?.toString());
            return true;
          } on Object catch (_) {
            final id = await widget.session.outbox.enqueue(
              orderId: widget.orderId,
              kind: 'photo',
              payload: {'stage': stage, 'data': dataUrl, 'permitId': _p.id},
              title: title,
            );
            if (mounted) setState(() => _photoId = id);
            return true;
          }
        },
      ),
    );
  }

  Widget _action() {
    if (_p.isClosed) {
      return BlockerNote(text: t('permit.zonaZakrytaNaryad'), icon: 'check-circle');
    }
    if (_p.isOpen) {
      return Column(
        children: [
          SecondaryButton(
            label: _photoId == null ? t('permit.snyatFotoPosle') : t('permit.fotoGotovoPeresnyat'),
            onPressed: () => _capture('permit_after', t('permit.fotoPosleVosstanovleniya')),
          ),
          const SizedBox(height: SozoSpace.s12),
          PrimaryButton(
            label: t('permit.zakrylZonu'),
            onPressed: _busy || _photoId == null ? null : () => _act('close'),
          ),
          if (_photoId == null)
            Padding(
              padding: const EdgeInsets.only(top: SozoSpace.s8),
              child: Text(t('permit.snachalaFotoPosle'),
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary), textAlign: TextAlign.center),
            ),
        ],
      );
    }
    // Гейт офлайн: причину называем словами, а не гасим кнопку молча
    if (!_p.canOpenOffline) {
      return BlockerNote(
        text: t('permit.dopuskNeSoglasovan'),
        icon: 'wifi-off',
        danger: true,
      );
    }
    return Column(
      children: [
        SecondaryButton(
          label: _photoId == null ? t('permit.snyatFotoDo') : t('permit.fotoGotovoPeresnyat'),
          onPressed: () => _capture('permit_before', t('permit.fotoDoVskrytiya')),
        ),
        const SizedBox(height: SozoSpace.s12),
        PrimaryButton(
          label: t('permit.otkrylZonu'),
          onPressed: _busy || _photoId == null ? null : () => _act('open'),
        ),
        if (_photoId == null)
          Padding(
            padding: const EdgeInsets.only(top: SozoSpace.s8),
            child: Text(t('permit.snachalaFotoDo'),
                style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary), textAlign: TextAlign.center),
          ),
      ],
    );
  }

  String _statusLabel(String s) => switch (s) {
    'requested' => t('permit.stJdetSoglasovaniya'),
    'rescheduled' => t('permit.stPredlozhenoDrugoe'),
    'approved' => t('permit.stSoglasovan'),
    'scheduled' => t('permit.stZaplanirovan'),
    'opened' => t('permit.zonaVskryta'),
    'closed' => t('permit.stZakryt'),
    'rejected' => t('permit.stOtklonen'),
    'expired' => t('permit.stProsrochen'),
    'cancelled' => t('permit.stAnnulirovan'),
    _ => t('permit.stChernovik'),
  };

}
