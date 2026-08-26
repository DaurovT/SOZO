import 'package:flutter_test/flutter_test.dart';
import 'package:sozo_client/store/session.dart';

/// Черновик заявки обязан восстанавливаться целиком.
///
/// Проверка на пять строк вместо разбора экрана: сохранение и восстановление
/// живут в разных местах, и разъезжаются они молча. Так однажды и вышло —
/// `toJson` писал 21 поле, перенос копировал 14, а терялись при этом
/// аварийность, выбранный адрес и все ответы чек-листа доступа. Человек
/// возвращался к черновику, отправлял его как есть и не видел, что заявка
/// перестала быть аварийной.
void main() {
  test('copyFrom переносит всё, что пишет toJson', () {
    final source = OrderDraft()
      ..items = {'item-1': 2}
      ..category = 'САНТЕХНИКА'
      ..description = 'течёт труба под раковиной'
      ..emergency = true
      ..photos = ['data:image/jpeg;base64,AAAA']
      ..address = 'Чиланзар, 12-1'
      ..lat = 41.2856
      ..lng = 69.2034
      ..saveAddress = true
      ..addressId = 'addr-7'
      ..floor = '5'
      ..hasLift = false
      ..needRiser = true
      ..needCommonArea = false
      ..accessConfirmed = true
      ..accessAt = '2026-08-25'
      ..timeMode = 'urgent'
      ..slotFrom = '2026-08-25:600'
      ..slotTo = '10:00–12:00'
      ..promoCode = 'SALOM10'
      ..promoDiscountPercent = 10;

    // Через хранилище: именно этот путь проходит черновик при выгрузке процесса
    final restored = OrderDraft.fromJson(source.toJson());
    final target = OrderDraft()..copyFrom(restored);

    expect(target.toJson(), source.toJson());
  });

  test('ключ идемпотентности переживает сохранение', () {
    final source = OrderDraft();
    final key = source.idempotencyKey;
    expect(key, isNotEmpty);
    expect(OrderDraft.fromJson(source.toJson()).idempotencyKey, key);

    // И меняется, когда заявка уже создана: следующая отправка — новая заявка
    source.renewIdempotencyKey();
    expect(source.idempotencyKey, isNot(key));
  });
}
