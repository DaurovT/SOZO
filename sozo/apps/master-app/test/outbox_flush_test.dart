import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sozo_master/api/client.dart';
import 'package:sozo_master/store/outbox.dart';

/// Поведение выгрузки офлайн-очереди.
///
/// Три правила PRD-02 §6 были записаны в комментарии, но не в коде, и именно
/// они ломают день мастера: очередь уходила одним запросом на всё (таймаут на
/// первой же фотографии), одна битая операция останавливала отправку по чужим
/// заявкам, а ошибка, не похожая на офлайн, не сохранялась вовсе — плашка
/// вечно показывала «Отправляем накопленное N».
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('упавшая операция держит свою заявку и отпускает чужие', () async {
    final api = _FakeApi()..failOrder = 'A';
    final outbox = Outbox(api);
    await outbox.enqueue(orderId: 'A', kind: 'action', payload: {'action': 'start'});
    await outbox.enqueue(orderId: 'A', kind: 'photo', payload: {'stage': 'after'});
    await outbox.enqueue(orderId: 'B', kind: 'action', payload: {'action': 'depart'});

    final r = await outbox.flush();

    expect(r.failed, 1, reason: 'упасть должна одна операция по заявке A');
    expect(r.applied, 1, reason: 'операция по заявке B обязана уйти');
    expect(outbox.blockedOrders, {'A'});
    // В очереди остались обе операции заявки A: вторая не отправлялась вовсе,
    // иначе «фото после» ушло бы вперёд непринятого «начал»
    expect(outbox.ops.map((o) => o.orderId).toList(), ['A', 'A']);
    expect(outbox.ops.first.lastError, isNotNull);
    expect(outbox.ops.last.lastError, isNull, reason: 'вторая операции не пробовалась — помечать её нечем');
  });

  test('тяжёлые операции уходят порциями, а не одним запросом', () async {
    final api = _FakeApi();
    final outbox = Outbox(api);
    // Три «снимка» по ~600 КБ: одним телом это гарантированный таймаут,
    // а на сервере — 413 при лимите 10 МБ на пакет
    for (var i = 0; i < 3; i++) {
      await outbox.enqueue(orderId: 'A', kind: 'photo', payload: {'dataUrl': 'x' * 600 * 1024});
    }
    await outbox.flush();

    expect(api.batches.length, 3, reason: 'каждый снимок должен уйти своим запросом');
    expect(outbox.depth, 0);
  });

  test('ошибка, не похожая на офлайн, не выдаёт себя за успех', () async {
    final api = _FakeApi()..error = ApiError('GATEWAY', 'Сервер не ответил', statusCode: 502);
    final outbox = Outbox(api);
    await outbox.enqueue(orderId: 'A', kind: 'action', payload: {'action': 'start'});

    await outbox.flush();

    expect(outbox.online, isTrue, reason: 'связь есть — офлайном это называть нельзя');
    // Операцию отказом не помечаем: сервер её не отверг, пакет не доехал.
    // Но и молчать нельзя — иначе плашка вечно показывает «отправляем»
    expect(outbox.lastFlushError, isNotNull);
    expect(outbox.ops.single.lastError, isNull, reason: 'данные в порядке, повтор уйдёт сам');
    expect(outbox.hasBlocked, isFalse);
  });

  test('офлайн не помечает операции ошибкой — они просто ждут', () async {
    final api = _FakeApi()..error = ApiError('OFFLINE', 'Нет связи с сервером');
    final outbox = Outbox(api);
    await outbox.enqueue(orderId: 'A', kind: 'action', payload: {'action': 'start'});

    await outbox.flush();

    expect(outbox.online, isFalse);
    expect(outbox.ops.single.lastError, isNull, reason: 'отсутствие сети — не отказ сервера');
    expect(outbox.hasBlocked, isFalse);
  });

  test('повтор снимает ошибку и отправляет заново', () async {
    final api = _FakeApi()..failOrder = 'A';
    final outbox = Outbox(api);
    final uuid = await outbox.enqueue(orderId: 'A', kind: 'action', payload: {'action': 'start'});
    await outbox.flush();
    expect(outbox.ops.single.lastError, isNotNull);

    api.failOrder = null; // диспетчер разобрался, причина ушла
    await outbox.retry(uuid);

    expect(outbox.depth, 0, reason: 'после повтора операция уходит, а не остаётся навсегда');
  });

  test('очередь другого мастера не уезжает под чужим токеном', () async {
    final outbox = Outbox(_FakeApi());
    await outbox.adoptOwner('+998901111111');
    await outbox.enqueue(orderId: 'A', kind: 'action', payload: {'action': 'start'});

    await outbox.adoptOwner('+998902222222'); // на аппарат зашёл сменщик
    expect(outbox.depth, 0);

    await outbox.enqueue(orderId: 'B', kind: 'action', payload: {'action': 'start'});
    await outbox.adoptOwner('+998902222222'); // тот же мастер вернулся
    expect(outbox.depth, 1, reason: 'своё сохраняется — в очереди работа за день');
  });
}

/// Сервер в тесте: считает пакеты и умеет отказывать по заявке
class _FakeApi extends ApiClient {
  _FakeApi() : super(baseUrl: 'http://test');

  final List<List<Map<String, dynamic>>> batches = [];
  String? failOrder;
  ApiError? error;

  @override
  Future<Map<String, dynamic>> sync(List<Map<String, dynamic>> ops) async {
    batches.add(ops);
    if (error != null) throw error!;
    // Как настоящий сервер: первая неудача по заявке рвёт цепочку, остальные
    // операции той же заявки в этом пакете помечаются skipped, а не failed
    final broken = <String>{};
    final results = <Map<String, dynamic>>[];
    for (final op in ops) {
      final order = op['orderId'] as String;
      if (broken.contains(order)) {
        results.add({'clientOpUuid': op['clientOpUuid'], 'status': 'skipped', 'code': 'CHAIN_BLOCKED'});
        continue;
      }
      if (order == failOrder) {
        broken.add(order);
        results.add({'clientOpUuid': op['clientOpUuid'], 'status': 'failed', 'message': 'Заявка изменилась'});
        continue;
      }
      results.add({'clientOpUuid': op['clientOpUuid'], 'status': 'applied'});
    }
    return {'results': results};
  }

  @override
  Future<void> reportQueue({required int depth, String? oldestAt}) async {}
}
