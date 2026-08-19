import 'package:flutter_test/flutter_test.dart';
import 'package:sozo_master/api/models.dart';
import 'package:sozo_master/i18n.dart';
import 'package:sozo_master/store/outbox.dart';

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
      ).toWire();
      // title, attempts и lastError — состояние приложения, серверу они не нужны
      expect(wire.keys.toSet(), {'clientOpUuid', 'orderId', 'kind', 'payload', 'deviceTime'});
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
