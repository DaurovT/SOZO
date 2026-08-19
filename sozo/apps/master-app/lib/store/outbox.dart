import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../i18n.dart';

/// Операция офлайн-очереди (PRD-02 §6).
/// Две метки времени: устройства — для порядка внутри очереди, серверная —
/// для разрешения конфликтов. Часы на телефоне могут врать, серверу верим больше.
class OutboxOp {
  OutboxOp({
    required this.clientOpUuid,
    required this.orderId,
    required this.kind,
    required this.payload,
    required this.deviceTime,
    required this.monotonicMs,
    this.title = '',
    this.lastError,
    this.attempts = 0,
  });

  final String clientOpUuid;
  final String orderId;
  final String kind; // action | photo | quote | material | acceptance
  final Map<String, dynamic> payload;
  final String deviceTime;
  final int monotonicMs;
  final String title;
  String? lastError;
  int attempts;

  Map<String, dynamic> toJson() => {
    'clientOpUuid': clientOpUuid,
    'orderId': orderId,
    'kind': kind,
    'payload': payload,
    'deviceTime': deviceTime,
    'monotonicMs': monotonicMs,
    'title': title,
    'lastError': lastError,
    'attempts': attempts,
  };

  Map<String, dynamic> toWire() => {
    'clientOpUuid': clientOpUuid,
    'orderId': orderId,
    'kind': kind,
    'payload': payload,
    'deviceTime': deviceTime,
  };

  static OutboxOp fromJson(Map<String, dynamic> j) => OutboxOp(
    clientOpUuid: j['clientOpUuid'] as String,
    orderId: j['orderId'] as String,
    kind: j['kind'] as String,
    payload: Map<String, dynamic>.from(j['payload'] as Map),
    deviceTime: j['deviceTime'] as String,
    monotonicMs: (j['monotonicMs'] as num?)?.toInt() ?? 0,
    title: (j['title'] ?? '') as String,
    lastError: j['lastError'] as String?,
    attempts: (j['attempts'] as num?)?.toInt() ?? 0,
  );
}

/// Очередь операций, переживающая перезапуск приложения.
///
/// Правила PRD-02 §6:
///  • порядок операций строгий — фото «после» не может уйти раньше начала работ;
///  • упавшая операция блокирует остальные по СВОЕЙ заявке, чужие идут дальше;
///  • повторная отправка безопасна — сервер узнаёт операцию по clientOpUuid.
class Outbox extends ChangeNotifier {
  Outbox(this._api);

  final ApiClient _api;
  final List<OutboxOp> _ops = [];
  static const _key = 'sozo_outbox_v1';
  final _stopwatch = Stopwatch()..start();

  bool _syncing = false;
  bool _online = true;
  DateTime? _lastSyncAt;

  List<OutboxOp> get ops => List.unmodifiable(_ops);
  int get depth => _ops.length;
  bool get syncing => _syncing;
  bool get online => _online;
  DateTime? get lastSyncAt => _lastSyncAt;
  bool get hasBlocked => _ops.any((o) => o.lastError != null);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return;
    try {
      _ops
        ..clear()
        ..addAll((jsonDecode(raw) as List).map((e) => OutboxOp.fromJson(e as Map<String, dynamic>)));
      notifyListeners();
    } catch (_) {
      await prefs.remove(_key); // повреждённая очередь лучше пустой, чем вечный краш
    }
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(_ops.map((o) => o.toJson()).toList()));
  }

  String _uuid() {
    final now = DateTime.now().microsecondsSinceEpoch;
    final rnd = identityHashCode(Object()).toRadixString(16);
    return '$now-$rnd-${_ops.length}';
  }

  /// Кладём операцию в очередь. Возвращает uuid — по нему сервер отсечёт повтор.
  Future<String> enqueue({
    required String orderId,
    required String kind,
    required Map<String, dynamic> payload,
    String title = '',
  }) async {
    final op = OutboxOp(
      clientOpUuid: _uuid(),
      orderId: orderId,
      kind: kind,
      payload: payload,
      deviceTime: DateTime.now().toUtc().toIso8601String(),
      monotonicMs: _stopwatch.elapsedMilliseconds,
      title: title,
    );
    _ops.add(op);
    await _persist();
    notifyListeners();
    return op.clientOpUuid;
  }

  /// Сообщить серверу остаток очереди.
  ///
  /// Единственный момент, когда это возможно, — сразу после удавшейся выгрузки:
  /// пока связи нет, ни очередь, ни её глубина никуда не уедут. Отчёт не должен
  /// ронять синхронизацию — она уже прошла, а метрика второстепенна.
  Future<void> _report() async {
    try {
      await _api.reportQueue(depth: _ops.length, oldestAt: _ops.isEmpty ? null : _ops.first.deviceTime);
    } catch (_) {
      /* мониторинг подождёт до следующей синхронизации */
    }
  }

  void markOnline(bool value) {
    if (_online == value) return;
    _online = value;
    notifyListeners();
  }

  /// Выгрузка одним пакетом. Сервер применяет по порядку и сам блокирует цепочку заявки.
  Future<({int applied, int failed})> flush() async {
    if (_syncing || _ops.isEmpty) return (applied: 0, failed: 0);
    _syncing = true;
    notifyListeners();
    try {
      final res = await _api.sync(_ops.map((o) => o.toWire()).toList());
      final results = ((res['results'] as List?) ?? const []).cast<Map<String, dynamic>>();
      var applied = 0;
      var failed = 0;
      for (final r in results) {
        final uuid = r['clientOpUuid'] as String?;
        final status = r['status'] as String?;
        final idx = _ops.indexWhere((o) => o.clientOpUuid == uuid);
        if (idx < 0) continue;
        if (status == 'applied' || status == 'duplicate') {
          _ops.removeAt(idx);
          applied++;
        } else if (status == 'failed') {
          _ops[idx]
            ..lastError = (r['message'] ?? r['code'] ?? t('sync.nePrinyatoServerom')) as String
            ..attempts += 1;
          failed++;
        }
        // skipped — остаётся в очереди без пометки: причина в предыдущей операции
      }
      _online = true;
      _lastSyncAt = DateTime.now();
      await _persist();
      await _report();
      return (applied: applied, failed: failed);
    } on ApiError catch (e) {
      if (e.isOffline) _online = false;
      return (applied: 0, failed: 0);
    } finally {
      _syncing = false;
      notifyListeners();
    }
  }

  /// Снять застрявшую операцию — только вручную и осознанно: данные не восстановятся
  Future<void> drop(String uuid) async {
    _ops.removeWhere((o) => o.clientOpUuid == uuid);
    await _persist();
    notifyListeners();
  }

  Future<void> clear() async {
    _ops.clear();
    await _persist();
    notifyListeners();
  }
}
