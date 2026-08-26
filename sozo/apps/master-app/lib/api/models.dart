library;

import '../i18n.dart';
import '../screens/permit_screen.dart';

/// Модели ответов API мастера (PRD-02, DEV-09).
/// Разбор терпимый к отсутствующим полям: приложение не должно падать
/// из-за расхождения версий с сервером — офлайн-мастер не может обновиться на месте.

int _int(dynamic v) => v is num ? v.toInt() : 0;
String _str(dynamic v) => v?.toString() ?? '';

/// Сумма приходит в тийинах (1 сум = 100 тийин), делить только на выводе.
///
/// Минус выносим за разряды: он считался цифрой, и −123 456 показывалось как
/// «- 123 456» — в кошельке и в строке наличного долга, то есть ровно там,
/// где отрицательная сумма и появляется.
String formatSoums(int tiyin) {
  final soums = (tiyin / 100).round();
  final digits = soums.abs().toString();
  final buf = StringBuffer(soums < 0 ? '−' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(' ');
    buf.write(digits[i]);
  }
  return t('status.sum', {'p1': buf});
}

/// Деньги из ответа сервера. Жёсткий `as num` на экранах ронял кошелёк и
/// главную, если поле не пришло: модели терпимы к пропускам, экраны — нет
int tiyinOf(Object? v) => v is num ? v.toInt() : 0;

/// Минуты словами: 200 → «3 ч 20 мин», 480 → «8 ч».
///
/// Сервер отдаёт загрузку смены в минутах, и «занято 200 мин из 480 мин»
/// мастер в уме не переводит — он думает часами.
String formatDuration(int minutes) {
  final h = minutes ~/ 60;
  final m = minutes % 60;
  if (h == 0) return '$m ${t('output.min')}';
  if (m == 0) return '$h ${t('output.chas')}';
  return '$h ${t('output.chas')} $m ${t('output.min')}';
}

/// Время и дата из ISO-строки сервера.
///
/// Резать строку напрямую нельзя: поле может прийти пустым, коротким или
/// вовсе отсутствовать — и экран упадёт на ровном месте, хотя показать
/// нужно было всего лишь прочерк.
String hhmm(Object? iso) {
  final s = iso?.toString() ?? '';
  return s.length >= 16 ? s.substring(11, 16) : '—';
}

String ymd(Object? iso) {
  final s = iso?.toString() ?? '';
  return s.length >= 10 ? s.substring(0, 10) : '—';
}

/// Число месяца из ISO-даты — для клеток календаря
String dayOfMonth(Object? iso) {
  final s = iso?.toString() ?? '';
  return s.length >= 10 ? s.substring(8, 10) : '';
}

/// Русское склонение после числа: 1 заявка, 2 заявки, 5 заявок.
/// Без него «2 заявка» бросается в глаза сильнее, чем кажется на макете.
String plural(int n, String one, String few, String many) {
  final mod100 = n % 100;
  final mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return '$n $many';
  if (mod10 == 1) return '$n $one';
  if (mod10 >= 2 && mod10 <= 4) return '$n $few';
  return '$n $many';
}

class MasterProfile {
  MasterProfile({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.status,
    required this.grade,
    required this.rating,
    required this.skillTags,
    required this.zones,
    required this.qrBadgeCode,
    required this.online,
    required this.ordersClosed,
    required this.avgRating,
    required this.acceptRatePercent,
    required this.documents,
  });

  final String id;
  final String fullName;
  final String phone;
  final String status;
  final String grade;
  final int rating;
  final List<String> skillTags;
  final List<String> zones;
  final String qrBadgeCode;
  final bool online;
  final int ordersClosed;
  final double? avgRating;
  final int? acceptRatePercent;
  final List<({String name, String status})> documents;

  static MasterProfile fromJson(Map<String, dynamic> j) {
    final shift = (j['shift'] as Map?) ?? const {};
    final stats = (j['stats'] as Map?) ?? const {};
    final offers = (stats['offers'] as Map?) ?? const {};
    return MasterProfile(
      id: _str(j['id']),
      fullName: _str(j['fullName']),
      phone: _str(j['phone']),
      status: _str(j['status']),
      grade: _str(j['grade']),
      rating: _int(j['rating']),
      skillTags: ((j['skillTags'] as List?) ?? const []).map(_str).toList(),
      zones: ((j['zones'] as List?) ?? const []).map(_str).toList(),
      qrBadgeCode: _str(j['qrBadgeCode']),
      online: shift['online'] == true,
      ordersClosed: _int(stats['ordersClosed']),
      avgRating: (stats['avgRating'] as num?)?.toDouble(),
      acceptRatePercent: (offers['acceptRatePercent'] as num?)?.toInt(),
      documents: ((j['documents'] as List?) ?? const [])
          .map((d) => (name: _str((d as Map)['name']), status: _str(d['status'])))
          .toList(),
    );
  }

  String get gradeTitle => switch (grade) {
    'gold' => t('res.zoloto'),
    'silver' => t('res.serebro'),
    _ => t('res.bronza'),
  };
}

/// Шаг конвейера: сервер сам говорит, активна кнопка или нет и почему
class OrderStep {
  OrderStep({required this.action, required this.title, required this.enabled, this.reason});

  final String action;
  final String title;
  final bool enabled;
  final String? reason;

  static OrderStep fromJson(Map<String, dynamic> j) => OrderStep(
    action: _str(j['action']),
    title: _str(j['title']),
    enabled: j['enabled'] == true,
    reason: j['reason'] as String?,
  );
}

class OrderPhoto {
  OrderPhoto({required this.stage, required this.file, required this.geoMissing, required this.at});

  final String stage;
  final String? file;
  final bool geoMissing;
  final String at;

  static OrderPhoto fromJson(Map<String, dynamic> j) => OrderPhoto(
    stage: _str(j['stage']),
    file: j['file'] as String?,
    geoMissing: j['geoMissing'] == true,
    at: _str(j['at']),
  );
}

class OrderLine {
  OrderLine({required this.name, required this.unit, required this.qty, required this.priceFromTiyin});

  final String name;
  final String unit;
  final int qty;
  final int priceFromTiyin;

  static OrderLine fromJson(Map<String, dynamic> j) => OrderLine(
    name: _str(j['name']),
    unit: _str(j['unit']),
    qty: _int(j['qty']),
    priceFromTiyin: _int(j['priceFromTiyin']),
  );
}

/// Детали доступа к адресу от клиента (его экран C-50).
///
/// Приходят не всегда: клиент мог их не заполнить. Пустые поля не показываем —
/// строка «Домофон: —» не помогает, а место занимает.
class AddressDetails {
  const AddressDetails({this.apartment, this.entrance, this.floor, this.intercom, this.hasLift, this.comment});

  final String? apartment;
  final String? entrance;
  final String? floor;
  final String? intercom;
  final bool? hasLift;
  final String? comment;

  static AddressDetails? fromJson(Map<String, dynamic>? j) {
    if (j == null) return null;
    String? s(Object? v) {
      final str = v?.toString().trim();
      return (str == null || str.isEmpty) ? null : str;
    }

    final rec = AddressDetails(
      apartment: s(j['apartment']),
      entrance: s(j['entrance']),
      floor: s(j['floor']),
      intercom: s(j['intercom']),
      hasLift: j['hasLift'] as bool?,
      comment: s(j['comment']),
    );
    return rec.isEmpty ? null : rec;
  }

  bool get isEmpty =>
      apartment == null && entrance == null && floor == null && intercom == null && hasLift == null && comment == null;

  /// Короткая строка для шапки: «кв. 42 · подъезд 2 · 5 этаж».
  String get short => [
    if (apartment != null) t('status.kv', {'p1': apartment}),
    if (entrance != null) t('status.podezd', {'p1': entrance}),
    if (floor != null) t('status.etaj', {'p1': floor}),
  ].join(' · ');
}

/// Позиция списка закупки: клиент выбрал вариант, деталь ещё в магазине.
class PartToBuy {
  const PartToBuy({required this.id, required this.partName, required this.tierTitle, required this.amountTiyin});

  final String id;
  final String partName;
  final String tierTitle;
  final int amountTiyin;

  static PartToBuy fromJson(Map<String, dynamic> j) => PartToBuy(
    id: _str(j['id']),
    partName: _str(j['partName']),
    tierTitle: _str(j['tierTitle']),
    amountTiyin: _int(j['amountTiyin']),
  );
}

/// Как попасть на объект организации: из паспорта точки в админке.
class SiteAccess {
  const SiteAccess({
    required this.locationName,
    required this.schedule,
    required this.accessNotes,
    required this.hoaContact,
    required this.photoForbidden,
  });

  final String locationName;
  final String? schedule;
  final String? accessNotes;
  final String? hoaContact;

  /// На объекте съёмка запрещена — фото-цикл конвейера здесь не применяется
  final bool photoForbidden;

  static SiteAccess? fromJson(Map<String, dynamic>? j) {
    if (j == null) return null;
    return SiteAccess(
      locationName: _str(j['locationName']),
      schedule: j['schedule'] as String?,
      accessNotes: j['accessNotes'] as String?,
      hoaContact: j['hoaContact'] as String?,
      photoForbidden: j['photoForbidden'] == true,
    );
  }
}

/// Единица техники клиента, заведённая по прошлым визитам (M-24).
class ClientAsset {
  const ClientAsset({
    required this.type,
    required this.brand,
    required this.model,
    required this.year,
    required this.fromThisOrder,
  });

  final String type;
  final String? brand;
  final String? model;
  final int? year;

  /// Заведена по этой же заявке — значит это то, что ставим сейчас,
  /// а не история, о которой стоит помнить
  final bool fromThisOrder;

  static ClientAsset fromJson(Map<String, dynamic> j) => ClientAsset(
    type: _str(j['type']),
    brand: j['brand'] as String?,
    model: j['model'] as String?,
    year: (j['year'] as num?)?.toInt(),
    fromThisOrder: j['fromThisOrder'] == true,
  );

  String get title => [type, brand, model].where((v) => v != null && v.isNotEmpty).join(' ');
}

class OrderCard {
  OrderCard({
    required this.id,
    required this.number,
    required this.status,
    required this.graphType,
    required this.urgency,
    required this.clientName,
    required this.clientPhone,
    required this.address,
    required this.lat,
    required this.lng,
    required this.description,
    required this.totalFromTiyin,
    required this.myShareTiyin,
    required this.role,
    required this.version,
    required this.paused,
    required this.arrivedAt,
    required this.steps,
    required this.blockers,
    required this.photos,
    required this.lines,
    required this.materials,
    required this.hasApprovedQuote,
    required this.hasAcceptance,
    required this.addressDetails,
    required this.clientAssets,
    required this.siteAccess,
    required this.toBuy,
    this.permit,
  });

  final String id;
  final String number;
  final String status;
  final String graphType;
  final String urgency;
  final String clientName;
  final String clientPhone;
  final String address;
  final double? lat;
  final double? lng;
  final String description;
  final int totalFromTiyin;
  final int myShareTiyin;
  final String role;
  final int version;
  final bool paused;
  final String? arrivedAt;
  final List<OrderStep> steps;
  final List<String> blockers;
  final List<OrderPhoto> photos;
  final List<OrderLine> lines;
  final List<({String name, int amountTiyin, bool hasReceipt})> materials;
  final bool hasApprovedQuote;
  final bool hasAcceptance;

  /// Как попасть внутрь: квартира, подъезд, этаж, домофон — клиент уточнил их
  /// в своём приложении после назначения. Пусто — значит не уточнял.
  final AddressDetails? addressDetails;

  /// Техника этого клиента: что уже стоит и когда обслуживалось. Экономит
  /// диагностику и не даёт продать то, что сделано полгода назад
  final List<ClientAsset> clientAssets;

  /// Пропускной режим объекта B2B: график, как попасть, контакт УК.
  /// У частного адреса пусто — там режим один, «позвонить в домофон»
  final SiteAccess? siteAccess;

  /// Что клиент выбрал и что ещё надо купить до выезда. Склада запчастей нет —
  /// их берут в партнёрском магазине, и без этой строки о покупке узнают
  /// только на объекте
  final List<PartToBuy> toBuy;

  /// Наряд-допуск контура «Дом» (M-43). Null для объектов без подключённой
  /// эксплуатирующей организации — там доступ по прежним правилам v2.25.
  final PermitInfo? permit;

  static OrderCard fromJson(Map<String, dynamic> j) {
    final quotes = (j['quotes'] as List?) ?? const [];
    return OrderCard(
      permit: j['permit'] == null
          ? null
          : PermitInfo.fromJson(Map<String, dynamic>.from(j['permit'] as Map)),
      id: _str(j['id']),
      number: _str(j['number']),
      status: _str(j['status']),
      graphType: _str(j['graphType']),
      urgency: _str(j['urgency']),
      clientName: _str(j['clientName']),
      clientPhone: _str(j['clientPhone']),
      address: _str(j['address']),
      lat: (j['lat'] as num?)?.toDouble(),
      lng: (j['lng'] as num?)?.toDouble(),
      description: _str(j['description']),
      totalFromTiyin: _int(j['totalFromTiyin']),
      myShareTiyin: _int(j['myShareTiyin']),
      role: _str(j['role']),
      version: _int(j['version']),
      paused: j['paused'] == true,
      arrivedAt: j['arrivedAt'] as String?,
      steps: ((j['steps'] as List?) ?? const []).map((s) => OrderStep.fromJson(s as Map<String, dynamic>)).toList(),
      blockers: ((j['blockers'] as List?) ?? const []).map(_str).toList(),
      photos: ((j['photos'] as List?) ?? const []).map((p) => OrderPhoto.fromJson(p as Map<String, dynamic>)).toList(),
      lines: ((j['lines'] as List?) ?? const []).map((l) => OrderLine.fromJson(l as Map<String, dynamic>)).toList(),
      materials: ((j['materials'] as List?) ?? const [])
          .map(
            (m) => (
              name: _str((m as Map)['name']),
              amountTiyin: _int(m['amountTiyin']),
              hasReceipt: m['hasReceipt'] == true,
            ),
          )
          .toList(),
      hasApprovedQuote: quotes.any((q) => (q as Map)['kind'] == 'approved'),
      hasAcceptance: j['acceptance'] != null,
      addressDetails: AddressDetails.fromJson(j['addressDetails'] as Map<String, dynamic>?),
      clientAssets: ((j['clientAssets'] as List?) ?? const [])
          .map((a) => ClientAsset.fromJson(a as Map<String, dynamic>))
          .toList(),
      siteAccess: SiteAccess.fromJson(j['siteAccess'] as Map<String, dynamic>?),
      toBuy: ((j['toBuy'] as List?) ?? const []).map((p) => PartToBuy.fromJson(p as Map<String, dynamic>)).toList(),
    );
  }

  int photosOf(String stage) => photos.where((p) => p.stage == stage).length;

  String get statusTitle => switch (status) {
    'assigned' => t('status.naznachena'),
    'master_departed' => t('order.vPuti'),
    'in_progress' => t('today.vRabote'),
    'addwork_approval' => t('status.jdemSoglasovanieDopRabot'),
    'completed' => t('status.vypolnena'),
    'verified' => t('status.proverena'),
    'awaiting_payment' => t('status.jdetOplatu'),
    'closed' => t('status.zakryta'),
    'rated' => t('status.ocenena'),
    'cancelled' => t('status.otmenena'),
    'dispute' => t('status.spor'),
    _ => status,
  };

  bool get isUrgent => urgency == 'urgent' || urgency == 'emergency';

  /// Заявка, по которой сам мастер дальше не продвинется.
  ///
  /// Считаем по тому, что вернул сервер, а не по своим догадкам: если сервер
  /// прислал шаг с `enabled: false` и причиной — значит шаг действительно
  /// заблокирован. Пауза и ожидание решения по доп-смете сюда же: работа стоит,
  /// и мастер должен видеть это в списке, а не открывая каждую карточку.
  bool get needsAttention => attentionReason != null;

  /// Короткая причина для строки под карточкой. Порядок — по срочности:
  /// сначала то, что останавливает работу прямо сейчас.
  String? get attentionReason {
    if (paused) return t('status.zayavkaNaPauze');
    if (status == 'addwork_approval') return t('status.jdemResheniePoDop');
    final blocked = steps.where((s) => !s.enabled && (s.reason?.isNotEmpty ?? false)).toList();
    if (blocked.isNotEmpty) return blocked.first.reason;
    if (blockers.isNotEmpty) return blockers.first;
    if (isUrgent && status == 'assigned') return t('status.srochnayaVyezdNeNachat');
    return null;
  }
}

class Offer {
  Offer({
    required this.id,
    required this.orderNumber,
    required this.category,
    required this.district,
    required this.urgency,
    required this.estimateFromTiyin,
    required this.masterShareFromTiyin,
    required this.secondsLeft,
    required this.isPaired,
    required this.kind,
    required this.ttlSeconds,
    required this.waitingSince,
  });

  final String id;
  final String orderNumber;
  final String category;
  final String district;
  final String urgency;
  final int estimateFromTiyin;
  final int masterShareFromTiyin;
  final int secondsLeft;
  final bool isPaired;

  /// personal — персональный оффер, express — бродкаст замены, helper — мини-оффер
  final String kind;

  /// Своё окно у каждого вида: персональный 60 сек, бродкаст замены 120
  final int ttlSeconds;
  final String? waitingSince;

  static Offer fromJson(Map<String, dynamic> j) => Offer(
    id: _str(j['id']),
    orderNumber: _str(j['orderNumber']),
    category: _str(j['category']),
    district: _str(j['district']),
    urgency: _str(j['urgency']),
    estimateFromTiyin: _int(j['estimateFromTiyin']),
    masterShareFromTiyin: _int(j['masterShareFromTiyin']),
    secondsLeft: _int(j['secondsLeft']),
    isPaired: j['isPaired'] == true,
    kind: j['kind']?.toString() ?? 'personal',
    ttlSeconds: (j['ttlSeconds'] as num?)?.toInt() ?? 60,
    waitingSince: j['waitingSince'] as String?,
  );
}

class CatalogItem {
  CatalogItem({
    required this.id,
    required this.category,
    required this.name,
    required this.unit,
    required this.priceFromTiyin,
    required this.priceToTiyin,
  });

  final String id;
  final String category;
  final String name;
  final String unit;
  final int priceFromTiyin;
  final int priceToTiyin;

  static CatalogItem fromJson(Map<String, dynamic> j) => CatalogItem(
    id: _str(j['id']),
    category: _str(j['category']),
    name: _str(j['name']),
    unit: _str(j['unit']),
    priceFromTiyin: _int(j['priceFromTiyin']),
    priceToTiyin: _int(j['priceToTiyin']),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'category': category,
    'name': name,
    'unit': unit,
    'priceFromTiyin': priceFromTiyin,
    'priceToTiyin': priceToTiyin,
  };
}

class Earnings {
  Earnings({
    required this.accruedTiyin,
    required this.paidTiyin,
    required this.dueTiyin,
    required this.cashDebtTiyin,
    required this.weekTiyin,
    required this.weekOrders,
    required this.orders,
  });

  final int accruedTiyin;
  final int paidTiyin;
  final int dueTiyin;
  final int cashDebtTiyin;
  final int weekTiyin;
  final int weekOrders;
  final List<({String number, int shareTiyin, int? rating})> orders;

  static Earnings fromJson(Map<String, dynamic> j) => Earnings(
    accruedTiyin: _int(j['accruedTiyin']),
    paidTiyin: _int(j['paidTiyin']),
    dueTiyin: _int(j['dueTiyin']),
    cashDebtTiyin: _int(j['cashDebtTiyin']),
    weekTiyin: _int(j['weekTiyin']),
    weekOrders: _int(j['weekOrders']),
    orders: ((j['orders'] as List?) ?? const [])
        .map(
          (o) => (
            number: _str((o as Map)['number']),
            shareTiyin: _int(o['shareTiyin']),
            rating: (o['rating'] as num?)?.toInt(),
          ),
        )
        .toList(),
  );
}
