import 'package:flutter_test/flutter_test.dart';
import 'package:sozo_master/api/client.dart';
import 'package:sozo_master/api/models.dart';
import 'package:sozo_master/i18n.dart';
import 'package:sozo_master/store/outbox.dart';
import 'package:sozo_master/widgets/common.dart';

void main() {
  group('деньги', () {
    // Разряды разделяет неразрывный пробел (DEV-06 §2): сумма не должна
    // переноситься на две строки посреди числа на узком экране телефона


    test('тийины переводятся в сумы с разрядами', () {
      expect(formatSoums(15000000), '150 000 сум');
      expect(formatSoums(0), '0 сум');
      expect(formatSoums(8250000), '82 500 сум');
      expect(formatSoums(123456789000), '1 234 567 890 сум');
    });

    test('разряды не разбиваются обычным пробелом', () {
      expect(formatSoums(15000000).contains('\u0020'), isFalse, reason: 'обычный пробел разорвал бы сумму при переносе');
    });
  });

  group('карточка заявки', () {
    test('шаги и блокеры читаются из ответа сервера', () {
      final card = OrderCard.fromJson({
        'id': 'o1',
        'number': 'Z-2026-000001',
        'status': 'in_progress',
        'graphType': 'b2c',
        'urgency': 'normal',
        'clientName': 'Санжар',
        'address': 'Чиланзар 12',
        'description': 'Течёт смеситель',
        'totalFromTiyin': 15000000,
        'myShareTiyin': 8250000,
        'role': 'lead',
        'version': 3,
        'steps': [
          {'action': 'complete', 'title': 'Работа выполнена', 'enabled': false, 'reason': 'Нет фото «после»'},
        ],
        'blockers': ['Нет фото «после»'],
        'photos': [
          {'stage': 'before', 'file': 'a.jpg', 'geoMissing': false, 'at': '2026-07-31T10:00:00Z'},
          {'stage': 'before', 'file': 'b.jpg', 'geoMissing': true, 'at': '2026-07-31T10:01:00Z'},
        ],
        'quotes': [
          {'kind': 'initial', 'amountTiyin': 15000000},
        ],
      });

      expect(card.statusTitle, 'В работе');
      expect(card.photosOf('before'), 2);
      expect(card.photosOf('after'), 0);
      expect(card.steps.single.enabled, isFalse);
      expect(card.steps.single.reason, 'Нет фото «после»');
      // смета есть, но неподтверждённая — работать по ней нельзя
      expect(card.hasApprovedQuote, isFalse);
      expect(card.hasAcceptance, isFalse);
    });

    test('отсутствующие поля не роняют разбор', () {
      final card = OrderCard.fromJson({'id': 'o2', 'number': 'Z-2'});
      expect(card.steps, isEmpty);
      expect(card.photos, isEmpty);
      expect(card.totalFromTiyin, 0);
    });
  });

  group('офлайн-очередь', () {
    test('операция переживает сериализацию без потерь', () {
      final op = OutboxOp(
        clientOpUuid: 'op-1',
        orderId: 'o1',
        kind: 'photo',
        payload: {'stage': 'before', 'dataUrl': 'data:image/png;base64,AA'},
        deviceTime: '2026-07-31T10:00:00.000Z',
        monotonicMs: 4200,
        title: 'Z-1: фото «до»',
      );
      final restored = OutboxOp.fromJson(op.toJson());
      expect(restored.clientOpUuid, op.clientOpUuid);
      expect(restored.payload['stage'], 'before');
      expect(restored.monotonicMs, 4200);
    });

    test('на сервер уходит только то, что он ждёт', () {
      final wire = OutboxOp(
        clientOpUuid: 'op-1',
        orderId: 'o1',
        kind: 'action',
        payload: {'action': 'start'},
        deviceTime: '2026-07-31T10:00:00.000Z',
        monotonicMs: 1,
        title: 'служебное',
      ).wire(null);
      // title, attempts и lastError — состояние приложения, серверу они не нужны
      expect(wire.keys.toSet(), {'clientOpUuid', 'orderId', 'kind', 'payload', 'deviceTime'});
    });

    test('снимок подставляется обратно только на время отправки', () {
      // Фотография живёт файлом, а не в JSON очереди: иначе каждое добавление
      // операции переписывает мегабайты в настройках
      final op = OutboxOp(
        clientOpUuid: 'op-2',
        orderId: 'o1',
        kind: 'photo',
        payload: {'stage': 'before'},
        deviceTime: '2026-07-31T10:00:00.000Z',
        monotonicMs: 1,
        blobFile: '/tmp/op-2.b64',
        blobKey: 'dataUrl',
      );
      expect(op.toJson()['payload'], isNot(contains('dataUrl')));
      expect(op.wire('data:image/png;base64,AA')['payload'], containsPair('dataUrl', 'data:image/png;base64,AA'));
    });

    test('ключ идемпотентности — настоящий UUID', () {
      // Наряд-допуск и id фото сервер проверяет схемой: «1756…-3f2a1-2»
      // возвращал 400, который экран показывал как «нет сети»
      final uuid = newOpUuid();
      expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(uuid), isTrue,
          reason: 'не UUID v4: $uuid');
      expect(newOpUuid(), isNot(uuid));
    });
  });

  group('профиль', () {
    test('смена и показатели откликов разбираются из вложенных объектов', () {
      final p = MasterProfile.fromJson({
        'id': 'm1',
        'fullName': 'Алишер Каримов',
        'phone': '+998901234567',
        'status': 'active',
        'grade': 'silver',
        'rating': 78,
        'skillTags': ['сантехника'],
        'zones': ['Чиланзар'],
        'qrBadgeCode': 'abc',
        'shift': {'online': true},
        'stats': {
          'ordersClosed': 12,
          'avgRating': 4.8,
          'offers': {'acceptRatePercent': 80},
        },
        'documents': [
          {'name': 'Паспорт', 'status': 'verified'},
        ],
      });
      expect(p.online, isTrue);
      expect(p.gradeTitle, 'Серебро');
      expect(p.ordersClosed, 12);
      expect(p.avgRating, 4.8);
      expect(p.acceptRatePercent, 80);
      expect(p.documents.single.name, 'Паспорт');
    });
  });
  group('текст для мастера', () {
    // Загрузка смены приходила в минутах: «занято 200 мин из 480 мин»
    // мастер в уме не переводит
    test('минуты показываются часами', () {
      expect(formatDuration(200), '3 ч 20 мин');
      expect(formatDuration(480), '8 ч');
      expect(formatDuration(45), '45 мин');
      expect(formatDuration(0), '0 мин');
    });

    // Сумма долга вводится руками, и ошибка на порядок замечается
    // уже после оплаты
    test('разряды в поле суммы и разбор обратно', () {
      expect(groupDigits('2000000'), '2 000 000');
      expect(groupDigits('500'), '500');
      expect(digitsOf('2 000 000'), '2000000');
      expect(int.parse(digitsOf('1 250 000')), 1250000);
    });

    test('исключение платформы не попадает в тост как есть', () {
      final camera = humanError(Exception('PlatformException(camera_access_denied, null, null, null)'));
      expect(camera.contains('PlatformException'), isFalse);
      expect(camera, t('common.oshibkaKameraZakryta'));

      // Понятный текст сервера пропускаем без изменений: он объясняет
      // ситуацию точнее любой общей фразы
      expect(humanError(ApiError('NO_RECEIPT', 'Без чека запчасть внести нельзя')), 'Без чека запчасть внести нельзя');
    });
  });

  group('локализация', () {
    final l = L10n();

    test('русский — язык по умолчанию', () {
      expect(l.code, 'ru');
      expect(l.t('today.segodnya'), 'Сегодня');
    });

    test('неизвестный ключ отдаёт сам ключ, а не пустоту', () {
      // мастер на объекте не должен видеть пустой экран из-за опечатки в ключе
      expect(l.t('нет.такого.ключа'), 'нет.такого.ключа');
    });
  });
}
