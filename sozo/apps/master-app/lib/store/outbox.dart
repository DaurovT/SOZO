import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../i18n.dart';

/// Ключ идемпотентности: настоящий UUID v4.
///
/// Раньше он собирался из микросекунд, хеша объекта и длины очереди
/// («1756…-3f2a1-2»). Синк такой ключ проглатывал, а наряд-допуск и
/// идентификатор фото проверяются схемой как UUID — и каждое вскрытие зоны
/// возвращало 400, который экран показывал как «нет сети».
String newOpUuid() {
  final r = Random.secure();
  final bytes = List<int>.generate(16, (_) => r.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // версия 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // вариант RFC 4122
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

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
    this.blobFile,
    this.blobKey,
  });

  final String clientOpUuid;
  final String orderId;
  final String kind; // action | photo | quote | material | acceptance | …
  final Map<String, dynamic> payload;
  final String deviceTime;
  final int monotonicMs;
  final String title;
  String? lastError;
  int attempts;

  /// Имя файла со снимком и ключ payload, из которого он вынут.
  ///
  /// Base64-фотография в общем JSON очереди означала мегабайты XML в
  /// SharedPreferences, переписываемые целиком при каждом добавлении: ANR на
  /// дешёвом Android, а при обрыве записи — потеря всей очереди разом.
  /// В настройках остаются только метаданные, снимок живёт файлом.
  final String? blobFile;
  final String? blobKey;

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
    'blobFile': blobFile,
    'blobKey': blobKey,
  };

  /// Тело для сервера. Снимок подставляется обратно только на время отправки
  Map<String, dynamic> wire(String? blob) => {
    'clientOpUuid': clientOpUuid,
    'orderId': orderId,
    'kind': kind,
    'payload': blob == null || blobKey == null ? payload : {...payload, blobKey!: blob},
    'deviceTime': deviceTime,
  };

  /// Насколько операция тяжёлая — по ней делится пакет отправки
  int get weight => blobFile != null ? _photoWeight : jsonEncode(payload).length;
  static const _photoWeight = 700 * 1024;

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
    blobFile: j['blobFile'] as String?,
    blobKey: j['blobKey'] as String?,
  );
}

/// Очередь операций, переживающая перезапуск приложения.
///
/// Правила PRD-02 §6:
///  • порядок операций строгий — фото «после» не может уйти раньше начала работ;
///  • упавшая операция блокирует остальные по СВОЕЙ заявке, чужие идут дальше;
///  • повторная отправка безопасна — сервер узнаёт операцию по clientOpUuid.
///
/// Третье правило было записано в комментарии, но не в коде: флаг блокировки
/// был общим, и одна битая операция по заявке A останавливала отправку по B, C
/// и D до конца смены. Теперь блокировка считается по заявке.
///
/// Выгрузка идёт порциями, а не одним запросом на всю очередь: день офлайна
/// с десятком снимков давал тело в несколько мегабайт — таймаут или 413,
/// после которого очередь не разгружалась уже никогда.
class Outbox extends ChangeNotifier {
  Outbox(this._api);

  final ApiClient _api;
  final List<OutboxOp> _ops = [];
  static const _key = 'sozo_outbox_v1';

  /// Чья это очередь. На одном аппарате работают посменно, и очередь первого
  /// мастера уходила на сервер под токеном второго — вместе с его фотографиями
  /// и его приёмками. Владелец сверяется при входе
  static const _ownerKey = 'sozo_outbox_owner';

  /// Порог пакета: одна фотография уходит одна, мелкие операции — по нескольку
  static const _batchBytes = 900 * 1024;
  static const _batchOps = 20;

  final _stopwatch = Stopwatch()..start();

  bool _syncing = false;
  bool _online = true;
  DateTime? _lastSyncAt;
  Directory? _blobDir;

  /// Чем закончилась последняя попытка выгрузки, если она не удалась целиком:
  /// авария шлюза, ошибка сервера, протухшая сессия. Это не отказ по операции
  /// — данные в порядке и уйдут сами, но молчать об этом нельзя: раньше
  /// плашка бесконечно показывала «Отправляем накопленное N»
  String? lastFlushError;

  List<OutboxOp> get ops => List.unmodifiable(_ops);
  int get depth => _ops.length;
  bool get syncing => _syncing;
  bool get online => _online;
  DateTime? get lastSyncAt => _lastSyncAt;
  bool get hasBlocked => _ops.any((o) => o.lastError != null);

  /// Заявки, по которым цепочка встала. Остальные продолжают уходить
  Set<String> get blockedOrders => _ops.where((o) => o.lastError != null).map((o) => o.orderId).toSet();

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
    unawaited(_gcBlobs());
  }

  /// Осиротевшие снимки: приложение могло умереть между записью файла и
  /// сохранением очереди. Без уборки они лежат в памяти телефона вечно
  Future<void> _gcBlobs() async {
    try {
      final dir = await _dir();
      if (dir == null) return;
      final alive = _ops.map((o) => o.blobFile).whereType<String>().toSet();
      for (final f in dir.listSync().whereType<File>()) {
        if (!alive.contains(f.path)) await f.delete();
      }
    } catch (_) {
      /* уборка не критична */
    }
  }

  /// Вход мастера: если очередь осталась от другого человека, её нельзя ни
  /// отправлять, ни показывать. Свою — сохраняем: мастер вышел с
  /// неотправленным и вернулся, данные обязаны дождаться
  Future<void> adoptOwner(String phone) async {
    final prefs = await SharedPreferences.getInstance();
    final owner = prefs.getString(_ownerKey);
    if (owner != null && owner != phone && _ops.isNotEmpty) {
      await clear();
    }
    await prefs.setString(_ownerKey, phone);
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(_ops.map((o) => o.toJson()).toList()));
  }

  /// Каталог для снимков очереди. На вебе файлов нет — там снимок остаётся
  /// в самой операции: браузером пользуются только на отладке
  Future<Directory?> _dir() async {
    if (kIsWeb) return null;
    if (_blobDir != null) return _blobDir;
    try {
      final base = await getApplicationDocumentsDirectory();
      final dir = Directory('${base.path}/outbox');
      if (!dir.existsSync()) dir.createSync(recursive: true);
      return _blobDir = dir;
    } catch (_) {
      return null; // хранилище недоступно — работаем как раньше, в настройках
    }
  }

  /// Кладём операцию в очередь. Возвращает uuid — по нему сервер отсечёт повтор.
  ///
  /// Тяжёлое поле (снимок) вынимается из payload в файл: в настройках остаются
  /// только метаданные, и добавление операции перестаёт переписывать мегабайты.
  Future<String> enqueue({
    required String orderId,
    required String kind,
    required Map<String, dynamic> payload,
    String title = '',
  }) async {
    final uuid = newOpUuid();
    final body = Map<String, dynamic>.from(payload);
    String? blobFile;
    String? blobKey;
    for (final key in const ['dataUrl', 'data', 'signatureDataUrl', 'receiptDataUrl']) {
      final v = body[key];
      if (v is! String || v.length < 4096) continue;
      final dir = await _dir();
      if (dir == null) break;
      try {
        final file = File('${dir.path}/$uuid.b64');
        await file.writeAsString(v, flush: true);
        blobFile = file.path;
        blobKey = key;
        body.remove(key);
      } catch (_) {
        /* не записалось — оставляем снимок в самой операции */
      }
      break;
    }

    final op = OutboxOp(
      clientOpUuid: uuid,
      orderId: orderId,
      kind: kind,
      payload: body,
      deviceTime: DateTime.now().toUtc().toIso8601String(),
      monotonicMs: _stopwatch.elapsedMilliseconds,
      title: title,
      blobFile: blobFile,
      blobKey: blobKey,
    );
    _ops.add(op);
    await _persist();
    notifyListeners();
    return op.clientOpUuid;
  }

  Future<String?> _blob(OutboxOp op) async {
    if (op.blobFile == null) return null;
    try {
      return await File(op.blobFile!).readAsString();
    } catch (_) {
      return null;
    }
  }

  Future<void> _dropBlob(OutboxOp op) async {
    if (op.blobFile == null) return;
    try {
      final f = File(op.blobFile!);
      if (f.existsSync()) await f.delete();
    } catch (_) {
      /* файл уйдёт с очисткой данных приложения */
    }
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

  /// Выгрузка порциями. Порядок внутри заявки строгий: как только операция по
  /// заявке не принята, остальные по ней в этот проход не отправляются.
  Future<({int applied, int failed})> flush() async {
    if (_syncing || _ops.isEmpty) return (applied: 0, failed: 0);
    _syncing = true;
    notifyListeners();
    var applied = 0;
    var failed = 0;
    // Что уже пробовали в этом проходе. Список живёт ровно один вызов:
    // операция, оставшаяся в очереди, обязана попасть в следующую выгрузку
    final sent = <String>{};
    try {
      // Заявки, по которым цепочка уже стоит с прошлого раза, пропускаем
      // целиком: отправлять «фото после» вперёд непринятого «начал» нельзя
      final blocked = blockedOrders;
      while (true) {
        final batch = _nextBatch(blocked, sent);
        if (batch.isEmpty) break;
        final wires = <Map<String, dynamic>>[];
        for (final op in batch) {
          wires.add(op.wire(await _blob(op)));
        }
        final res = await _api.sync(wires);
        lastFlushError = null;
        final results = ((res['results'] as List?) ?? const []).cast<Map<String, dynamic>>();
        for (final r in results) {
          final uuid = r['clientOpUuid'] as String?;
          final status = r['status'] as String?;
          final idx = _ops.indexWhere((o) => o.clientOpUuid == uuid);
          if (idx < 0) continue;
          if (status == 'applied' || status == 'duplicate') {
            await _dropBlob(_ops[idx]);
            _ops.removeAt(idx);
            applied++;
          } else if (status == 'failed') {
            _ops[idx]
              ..lastError = (r['message'] ?? r['code'] ?? t('sync.nePrinyatoServerom')) as String
              ..attempts += 1;
            blocked.add(_ops[idx].orderId);
            failed++;
          }
          // skipped — остаётся в очереди без пометки: причина в предыдущей операции
        }
        _online = true;
        _lastSyncAt = DateTime.now();
        await _persist();
        notifyListeners();
      }
      await _report();
      return (applied: applied, failed: failed);
    } on ApiError catch (e) {
      // Раньше отсюда выходили молча при любой ошибке, кроме офлайна: флаг
      // «онлайн» оставался, ошибка нигде не сохранялась — и плашка бесконечно
      // показывала «Отправляем накопленное N», хотя не уходило ничего
      if (e.isOffline) {
        _online = false;
        lastFlushError = null; // отсутствие сети — обычный режим работы
      } else {
        // Связь есть, но пакет не приняли. Операции не помечаем отказом:
        // они не отвергнуты, а не доехали — следующая попытка уйдёт сама
        _online = true;
        lastFlushError = e.statusCode == 413 ? t('sync.slishkomBolshoyPaket') : e.message;
      }
      await _persist();
      return (applied: applied, failed: failed);
    } finally {
      _syncing = false;
      notifyListeners();
    }
  }

  /// Пакет: подряд идущие операции, кроме заблокированных заявок.
  /// Снимок уходит один — сервер принимает тело до 10 МБ, а мобильная сеть
  /// в подвале не тянет и одного мегабайта за раз
  List<OutboxOp> _nextBatch(Set<String> blocked, Set<String> sent) {
    final batch = <OutboxOp>[];
    var bytes = 0;
    for (final op in _ops) {
      if (blocked.contains(op.orderId)) continue;
      if (sent.contains(op.clientOpUuid)) continue;
      if (batch.isNotEmpty && (bytes + op.weight > _batchBytes || batch.length >= _batchOps)) break;
      batch.add(op);
      bytes += op.weight;
      sent.add(op.clientOpUuid);
      if (bytes >= _batchBytes) break;
    }
    return batch;
  }

  /// Снять застрявшую операцию — только вручную и осознанно: данные не восстановятся
  Future<void> drop(String uuid) async {
    final idx = _ops.indexWhere((o) => o.clientOpUuid == uuid);
    if (idx < 0) return;
    await _dropBlob(_ops[idx]);
    _ops.removeAt(idx);
    await _persist();
    notifyListeners();
  }

  /// Повторить застрявшую: ошибка снимается, и заявка перестаёт быть
  /// заблокированной — до этого единственной кнопкой было «убрать», то есть
  /// стереть работу за день
  Future<void> retry(String uuid) async {
    final idx = _ops.indexWhere((o) => o.clientOpUuid == uuid);
    if (idx < 0) return;
    _ops[idx].lastError = null;
    await _persist();
    notifyListeners();
    await flush();
  }

  Future<void> clear() async {
    for (final op in _ops) {
      await _dropBlob(op);
    }
    _ops.clear();
    await _persist();
    notifyListeners();
  }
}
