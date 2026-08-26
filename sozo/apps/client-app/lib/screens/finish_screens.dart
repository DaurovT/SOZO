import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_grid.dart';
import 'complaints_screen.dart';
import 'dispute_screen.dart';
import 'warranty_screen.dart';

/// C-19 / C-25. Итог выполненной заявки и карточка закрытой.
///
/// Один экран на оба случая: содержимое одинаковое (что сделали, из чего сумма,
/// какие фото), различаются только действия — оплатить или оценить/повторить.
class FinishScreenBody extends StatelessWidget {
  const FinishScreenBody({super.key, required this.order, required this.reload});

  final Map<String, dynamic> order;
  final Future<void> Function() reload;

  Map<String, dynamic> get _can => (order['can'] as Map<String, dynamic>?) ?? const {};

  bool get _closed => ['closed', 'rated'].contains(order['status']);

  static String? _absolute(String? path) =>
      path == null ? null : (path.startsWith('http') ? path : '${session.api.baseUrl}$path');

  @override
  Widget build(BuildContext context) {
    final lines = ((order['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final materials = ((order['materials'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final photos = ((order['photos'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final payment = order['payment'] as Map<String, dynamic>?;
    final acceptance = order['acceptance'] as Map<String, dynamic>?;
    final warrantyUntil = order['warrantyUntil'] as String?;
    final approved = (order['approvedTiyin'] as num?)?.toInt();
    final worksTiyin = approved ?? (order['totalFromTiyin'] as num?)?.toInt() ?? 0;
    final materialsTiyin = (order['totalMaterialTiyin'] as num?)?.toInt() ?? 0;
    final total = worksTiyin + materialsTiyin;
    final paid = payment?['status'] == 'succeeded';

    return Column(
      children: [
        SozoAppBar(
          title: _closed ? ((order['number'] as String?) ?? '') : t('c19.title'),
          action: SozoAppBarAction(
            icon: 'megaphone',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    ComplaintsScreen(orderId: order['id'] as String?, orderNumber: order['number'] as String?),
              ),
            ),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s32),
            children: [
              if (!_closed && !paid) _acceptanceBlock(context, acceptance),

              if (photos.isNotEmpty) ...[
                SozoCard(
                  children: [
                    CardTitle(t('c19.photos')),
                    PhotoGrid(
                      photos: [
                        for (final p in photos)
                          PhotoRef(
                            url: _absolute(p['url'] as String?),
                            label: switch (p['stage']) {
                              'before' => t('photo.before'),
                              'after' => t('photo.after'),
                              'during' => t('photo.during'),
                              _ => null,
                            },
                          ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              SozoCard(
                children: [
                  CardTitle(t('c19.works')),
                  for (final l in lines)
                    MoneyRow(
                      label: (l['name'] as String?) ?? '',
                      sub: (l['qty'] as num? ?? 1) > 1 ? '${l['qty']} ${l['unit']}' : null,
                      amount: soums(l['fromTiyin']),
                    ),
                  if (lines.isEmpty)
                    Text(t('c19.noLines'), style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),

              if (materials.isNotEmpty) ...[
                SozoCard(
                  children: [
                    CardTitle(t('c19.materials')),
                    for (final m in materials)
                      MoneyRow(
                        label: (m['name'] as String?) ?? '',
                        sub: [
                          if (m['kind'] == 'consumable') t('c19.consumable'),
                          if (m['priceTier'] != null) _tierLabel('${m['priceTier']}'),
                        ].join(' · '),
                        amount: soums(m['amountTiyin']),
                      ),
                  ],
                ),
                const SizedBox(height: SozoSpace.s12),
              ],

              SozoCard(
                children: [
                  MoneyRow(label: t('c19.worksTotal'), amount: soums(worksTiyin)),
                  if (materialsTiyin > 0) MoneyRow(label: t('c19.materialsTotal'), amount: soums(materialsTiyin)),
                  if ((order['promoDiscountPercent'] as num? ?? 0) > 0)
                    MoneyRow(
                      label: t('c19.promo', {'percent': order['promoDiscountPercent']}),
                      amount: t('c19.included'),
                      color: SozoColors.success,
                    ),
                  const SozoDivider(),
                  MoneyRow(label: paid ? t('c19.paidTotal') : t('c19.toPay'), amount: soums(total), bold: true),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),

              if (paid)
                SozoBanner(
                  icon: 'check-done',
                  tone: BannerTone.success,
                  text: t('c19.paidVia', {'provider': _providerLabel(payment!['provider'] as String?)}),
                ),

              if (warrantyUntil != null) ...[const SizedBox(height: SozoSpace.s12), _warrantyBlock(warrantyUntil)],

              if (order['rating'] != null) ...[
                const SizedBox(height: SozoSpace.s12),
                SozoCard(
                  children: [
                    CardTitle(t('c25.yourRating')),
                    Row(
                      children: [
                        for (var i = 1; i <= 5; i++)
                          Padding(
                            padding: const EdgeInsets.only(right: SozoSpace.s4),
                            child: FigmaIcon(
                              'star',
                              size: 20,
                              color: i <= ((order['rating'] as num?)?.toInt() ?? 0)
                                  ? SozoColors.accent
                                  : SozoColors.border,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ],

              // Акт можно скачать и переслать: на экране он есть, а для
              // бухгалтерии, страховой или спора нужен файл (F-31)
              if (_closed) ...[
                const SizedBox(height: SozoSpace.s12),
                TextAction(
                  t('c19.openAct'),
                  onTap: () => openDocument(context, session.api.documentUrl('/documents/orders/${order['id']}/act')),
                ),
              ],

              const SizedBox(height: SozoSpace.s24),
              if (_can['warranty'] == true && _closed)
                SecondaryButton(
                  t('c25.problemBack'),
                  icon: 'rotate-ccw',
                  onTap: () async {
                    await Navigator.of(
                      context,
                    ).push(MaterialPageRoute<void>(builder: (_) => WarrantyScreen(order: order)));
                    await reload();
                  },
                ),
              const SizedBox(height: SozoSpace.s8),
              if (_can['dispute'] == true)
                AmberAction(
                  t('c19.dispute'),
                  onTap: () async {
                    await Navigator.of(
                      context,
                    ).push(MaterialPageRoute<void>(builder: (_) => DisputeScreen(order: order)));
                    await reload();
                  },
                ),
            ],
          ),
        ),
        _footer(context, total, paid),
      ],
    );
  }

  Widget _footer(BuildContext context, int total, bool paid) {
    if (_can['pay'] == true && !paid) {
      return StickyFooter(
        children: [
          PrimaryButton(
            t('c19.pay', {'sum': soums(total)}),
            icon: 'credit-card',
            // Оплата — лист поверх акта, а не отдельный экран: сумма и то,
            // за что платишь, должны оставаться перед глазами
            onTap: () async {
              await showSozoSheet<void>(
                context,
                title: t('c20.title'),
                child: PaymentMethods(order: order, totalTiyin: total),
              );
              await reload();
            },
          ),
        ],
      );
    }
    if (_can['rate'] == true) {
      return StickyFooter(
        children: [
          PrimaryButton(
            t('c19.rate'),
            icon: 'star',
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ThanksScreen(order: order)));
              await reload();
            },
          ),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// Блок приёмки. При онлайн-оплате отдельного действия нет — оплата и есть
  /// приёмка (ТЗ 17.17 п.3); код нужен для наличных и телефонного канала.
  Widget _acceptanceBlock(BuildContext context, Map<String, dynamic>? acceptance) {
    if (acceptance != null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: SozoSpace.s12),
        child: SozoBanner(icon: 'check-done', tone: BannerTone.success, text: t('c19.accepted')),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s12),
      child: _AcceptanceCard(order: order, reload: reload),
    );
  }

  Widget _warrantyBlock(String until) {
    final left = tashkent(until)?.difference(nowTashkent()).inDays ?? 0;
    final expired = left < 0;
    return SozoBanner(
      icon: 'shield-check',
      tone: expired ? BannerTone.neutral : BannerTone.success,
      title: expired ? t('c25.warrantyExpired') : t('c25.warrantyUntil', {'date': dayMonth(until)}),
      text: expired
          ? t('c25.warrantyExpiredText')
          : t('c25.warrantyLeft', {'days': plural(left, 'plural.days')}),
    );
  }

  static String _tierLabel(String tier) => switch (tier) {
    'economy' => t('tier.economy'),
    'premium' => t('tier.premium'),
    _ => t('tier.standard'),
  };

  static String _providerLabel(String? p) => switch (p) {
    'click' => 'Click',
    'uzum' => 'Uzum',
    'card' => t('c20.card'),
    'cash' => t('c20.cash'),
    _ => 'Payme',
  };
}

/// Карточка приёмки: код крупно + кнопка подтверждения
class _AcceptanceCard extends StatefulWidget {
  const _AcceptanceCard({required this.order, required this.reload});

  final Map<String, dynamic> order;
  final Future<void> Function() reload;

  @override
  State<_AcceptanceCard> createState() => _AcceptanceCardState();
}

class _AcceptanceCardState extends State<_AcceptanceCard> {
  String? _code;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadCode();
  }

  Future<void> _loadCode() async {
    try {
      final r = await session.api.acceptanceCode(widget.order['id'] as String);
      if (mounted) setState(() => _code = r['code'] as String?);
    } on ApiError {
      // Код — удобство, а не блокер: без него остаётся кнопка подтверждения
    }
  }

  Future<void> _confirm() async {
    setState(() => _busy = true);
    try {
      await session.api.confirmAcceptance(widget.order['id'] as String);
      unawaited(session.api.track('acceptance_confirmed', {'method': 'in_app'}));
      if (!mounted) return;
      showSozoToast(context, t('c19.acceptedToast'));
      await widget.reload();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SozoCard(
      color: SozoColors.accent.withValues(alpha: 0.10),
      children: [
        Text(
          t('c19.acceptTitle'),
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
        ),
        if (_code != null)
          Center(
            child: Text(
              _code!.split('').join(' '),
              style: const TextStyle(
                fontSize: 34,
                fontWeight: FontWeight.w700,
                letterSpacing: 2,
                color: SozoColors.text,
                fontFeatures: moneyFeatures,
              ),
            ),
          ),
        Text(t('c19.acceptHint'), style: const TextStyle(fontSize: 13, height: 1.4, color: SozoColors.textSecondary)),
        SecondaryButton(t('c19.acceptButton'), busy: _busy, onTap: _confirm),
      ],
    );
  }
}

/// C-20. Способы оплаты.
///
/// Живёт листом поверх акта: сумма и состав работ должны оставаться перед
/// глазами в момент оплаты. Отдельным экраном открывается только из витрины.
class PaymentMethods extends StatefulWidget {
  const PaymentMethods({super.key, required this.order, required this.totalTiyin});

  final Map<String, dynamic> order;
  final int totalTiyin;

  @override
  State<PaymentMethods> createState() => _PaymentMethodsState();
}

class _PaymentMethodsState extends State<PaymentMethods> {
  bool _busy = false;
  String? _error;

  /// Способ, который человек уже выбирал раньше: сервер помнит предпочтение,
  /// а если его нет — подсказывает, чем платили в прошлый раз
  String? _preferred;

  /// Промокоды из кошелька, годные прямо сейчас
  List<Map<String, dynamic>> _promos = const [];
  String? _promoCode;
  int _promoPercent = 0;

  /// Подпись способа оплаты для диалога подтверждения
  String _providerLabel(String provider) {
    final found = _ordered.where((p) => p.$1 == provider).firstOrNull;
    final label = found?.$2 ?? provider;
    return label.startsWith('c20.') ? t(label) : label;
  }

  /// Скидка считается от работ, а не от итога: материалы идут по чекам
  int get _worksTiyin => ((widget.order['totalFromTiyin'] as num?) ?? 0).toInt();
  int get _discountTiyin => _promoPercent == 0 ? 0 : (_worksTiyin * _promoPercent) ~/ 100;
  int get _payTiyin => widget.totalTiyin - _discountTiyin;

  @override
  void initState() {
    super.initState();
    _loadPreferred();
    _loadPromos();
  }

  /// Кошелёк промокодов. Молча пустой, если сервер не ответил: скидка —
  /// приятное дополнение, и терять из-за неё возможность заплатить нельзя
  Future<void> _loadPromos() async {
    try {
      final r = await session.api.promos();
      final list = ((r['items'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .where((p) => p['usable'] == true)
          .toList();
      if (!mounted) return;
      setState(() {
        _promos = list;
        // Единственный годный код подставляем сам: выбирать не из чего,
        // а забыть про него — потерять деньги на ровном месте
        if (list.length == 1) {
          _promoCode = list.first['code'] as String?;
          _promoPercent = (list.first['discountPercent'] as num?)?.toInt() ?? 0;
        }
      });
    } catch (_) {
      // без кошелька платить всё равно можно
    }
  }

  Future<void> _pickPromo() async {
    await showSozoSheet<void>(
      context,
      title: t('promo.pickTitle'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 0, SozoSpace.s16, SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final p in _promos)
              Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                child: SecondaryButton(
                  '${p['code']} · ${t('promo.discount', {'percent': p['discountPercent']})}',
                  icon: p['code'] == _promoCode ? 'check' : null,
                  onTap: () {
                    setState(() {
                      _promoCode = p['code'] as String?;
                      _promoPercent = (p['discountPercent'] as num?)?.toInt() ?? 0;
                    });
                    Navigator.of(context).pop();
                  },
                ),
              ),
            Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SecondaryButton(
                t('promo.enterOther'),
                icon: 'plus',
                onTap: () {
                  Navigator.of(context).pop();
                  _enterPromo();
                },
              ),
            ),
            if (_promoCode != null)
              SecondaryButton(
                t('promo.none'),
                onTap: () {
                  setState(() {
                    _promoCode = null;
                    _promoPercent = 0;
                  });
                  Navigator.of(context).pop();
                },
              ),
          ],
        ),
      ),
    );
  }

  /// Код, которого нет в кошельке: проверяем до оплаты, чтобы человек увидел
  /// новую сумму раньше, чем выберет способ
  Future<void> _enterPromo() async {
    final ctrl = TextEditingController();
    final code = await showSozoPrompt(
      context,
      title: t('promo.add'),
      hint: t('promo.hint'),
      controller: ctrl,
      confirmLabel: t('common.apply'),
    );
    ctrl.dispose();
    if (code == null || code.trim().isEmpty) return;
    try {
      final r = await session.api.checkPromo(code.trim());
      if (!mounted) return;
      if (r['valid'] == true) {
        setState(() {
          _promoCode = code.trim().toUpperCase();
          _promoPercent = (r['discountPercent'] as num?)?.toInt() ?? 0;
        });
      } else {
        showSozoToast(context, (r['message'] as String?) ?? '');
      }
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    }
  }

  /// Подсказка не обязательна: не ответил сервер — просто покажем список
  /// в обычном порядке, платить это не мешает
  Future<void> _loadPreferred() async {
    try {
      final r = await session.api.paymentMethods();
      if (mounted) {
        setState(() => _preferred = (r['preferred'] ?? r['lastUsed']) as String?);
      }
    } catch (_) {
      // подсказка не критична
    }
  }

  Future<void> _pay(String provider) async {
    if (_busy) return; // двойной тап по способу игнорируется (идемпотентность)
    // Спрашиваем до отправки. Раньше платёж уходил на сервер от одного тапа
    // по строке способа — а строки эти стоят в списке подряд, и промах пальцем
    // означал начатый платёж. Наличные подтверждаем тоже: это выбор, о котором
    // узнает мастер
    final label = provider == 'cash' ? t('c20.cash') : _providerLabel(provider);
    final ok = await showSozoConfirm(
      context,
      title: t('c20.confirmTitle'),
      text: t('c20.confirmText', {'sum': soums(_payTiyin), 'method': label}),
      confirmLabel: t('c20.confirmPay'),
    );
    if (!ok || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    unawaited(session.api.track('payment_started', {'provider': provider}));
    try {
      final r = await session.api.pay(widget.order['id'] as String, provider, promoCode: _promoCode);
      final status = ((r['payment'] as Map?)?['status'] as String?) ?? 'pending';
      // Оплата больше не подтверждает приёмку.
      //
      // Раньше сервер проставлял `acceptance` внутри `pay`, и приложение
      // считало то же самое: один вызов оплаты снимал приёмочный гейт без
      // кода, подписи и участия ответственного. Теперь приёмка — только явное
      // действие, а `acceptanceFixed` в ответе говорит, случилась она или нет.
      // Событие о приёмке шлём по этому полю, а не по факту оплаты: иначе
      // в аналитике приёмок оказывается больше, чем их было.
      final acceptanceFixed = r['acceptanceFixed'] == true;
      if (status == 'succeeded') {
        unawaited(session.api.track('payment_succeeded', {'provider': provider}));
        if (acceptanceFixed) {
          unawaited(session.api.track('acceptance_confirmed', {'method': 'online_payment'}));
        }
      }
      if (!mounted) return;
      final messenger = ScaffoldMessenger.maybeOf(context);
      Navigator.of(context).pop();
      messenger?.showSnackBar(
        SnackBar(
          content: Text(
            status == 'succeeded' && !acceptanceFixed
                ? t('c20.acceptNext')
                : ((r['message'] as String?) ?? ''),
            style: const TextStyle(color: SozoColors.surface),
          ),
          backgroundColor: toastBg,
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.all(SozoSpace.s16),
          duration: const Duration(seconds: 5),
        ),
      );
      // «Спасибо» с оценкой и чаевыми — только когда работа уже принята.
      // Пока приёмки нет, следующий шаг человека другой: закрыть лист,
      // увидеть карточку «Работа сделана?» и ответить на неё. Экран акта
      // перечитывает себя сам, как только лист закрылся
      if (status == 'succeeded' && acceptanceFixed && context.mounted) {
        await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ThanksScreen(order: widget.order)));
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Список способов: запомненный наверх, остальные в обычном порядке
  List<(String, String)> get _ordered {
    const all = [('payme', 'Payme'), ('click', 'Click'), ('uzum', 'Uzum'), ('card', 'c20.card')];
    if (_preferred == null || _preferred == 'cash') return all;
    return [...all.where((p) => p.$1 == _preferred), ...all.where((p) => p.$1 != _preferred)];
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Column(
              children: [
                // Со скидкой показываем обе суммы: новая крупно, прежняя
                // зачёркнутой рядом — иначе непонятно, что скидка сработала
                // Две суммы рядом на узком экране не помещаются: «1 500 000 сум»
                // и зачёркнутое «1 800 000 сум» — это 35 лишних пикселей.
                // Сжимаем блок целиком, а не режем цифры многоточием
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        soums(_payTiyin),
                        style: const TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.w700,
                          color: SozoColors.text,
                          fontFeatures: moneyFeatures,
                        ),
                      ),
                      if (_discountTiyin > 0) ...[
                        const SizedBox(width: SozoSpace.s8),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 5),
                          child: Text(
                            soums(widget.totalTiyin),
                            style: const TextStyle(
                              fontSize: 16,
                              color: SozoColors.textTertiary,
                              decoration: TextDecoration.lineThrough,
                              fontFeatures: moneyFeatures,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: SozoSpace.s4),
                Text(t('c20.breakdown'), style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s12),

          // Промокод — отдельной строкой над способами: выбор скидки идёт
          // раньше выбора способа, иначе платёж уходит по старой сумме
          SozoCard(
            radius: SozoRadius.tile,
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
            gap: 0,
            children: [
              NavRow(
                icon: 'star',
                title: t('promo.choose'),
                value: _promoCode == null
                    ? t('promo.none')
                    : '$_promoCode · ${t('promo.applied', {'percent': _promoPercent})}',
                onTap: _busy ? null : _pickPromo,
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s16),
          // Запомненный способ — первым и с подписью «как обычно»: список
          // из четырёх одинаковых строк каждый раз перечитывают заново
          for (final p in _ordered) ...[
            SozoCard(
              onTap: _busy ? null : () => _pay(p.$1),
              border: p.$1 == _preferred ? SozoColors.accent : null,
              children: [
                Row(
                  children: [
                    const FigmaIcon('credit-card', size: 20, color: SozoColors.textSecondary),
                    const SizedBox(width: SozoSpace.s12),
                    Expanded(
                      child: Text(
                        p.$2.startsWith('c20.') ? t(p.$2) : p.$2,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                      ),
                    ),
                    if (p.$1 == _preferred) ...[TagChip(t('c20.asUsual')), const SizedBox(width: SozoSpace.s8)],
                    const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                  ],
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
          // 14, а не 12: это оговорка о том, что оплата приёмку не заменяет
          Text(t('c20.acceptanceNote'), style: const TextStyle(fontSize: 14, height: 1.35, color: SozoColors.textSecondary)),
          const SizedBox(height: SozoSpace.s12),
          SozoBanner(icon: 'banknote', text: t('c20.cashNote')),
          const SizedBox(height: SozoSpace.s8),
          SecondaryButton(t('c20.cashChoose'), onTap: _busy ? null : () => _pay('cash')),
          if (_error != null) ...[
            const SizedBox(height: SozoSpace.s12),
            SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
          ],
          const SizedBox(height: SozoSpace.s8),
        ],
      ),
    );
  }
}

/// Отдельный экран оплаты — только для витрины и глубоких ссылок из push
class PaymentScreen extends StatelessWidget {
  const PaymentScreen({super.key, required this.order, required this.totalTiyin});

  final Map<String, dynamic> order;
  final int totalTiyin;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c20.title')),
      body: SafeArea(
        child: PaymentMethods(order: order, totalTiyin: totalTiyin),
      ),
    );
  }
}

/// C-21. «Спасибо»: оценка и чаевые одним экраном (ТЗ 17.17 п.3).
class ThanksScreen extends StatefulWidget {
  const ThanksScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  State<ThanksScreen> createState() => _ThanksScreenState();
}

class _ThanksScreenState extends State<ThanksScreen> {
  int _rating = 0;
  int _tip = 0;
  bool _remember = false;
  bool _busy = false;
  String? _error;
  final _comment = TextEditingController();
  final _customTip = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    _customTip.dispose();
    super.dispose();
  }

  bool get _cashPayment => (widget.order['payment'] as Map?)?['provider'] == 'cash';

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final custom = int.tryParse(_customTip.text.replaceAll(RegExp(r'\D'), '')) ?? 0;
      final tipTiyin = custom > 0 ? custom * 100 : _tip;
      await session.api.rate(widget.order['id'] as String, {
        'rating': _rating,
        'comment': _comment.text.trim(),
        'tipTiyin': tipTiyin,
        'rememberMaster': _remember,
      });
      unawaited(session.api.track('rating_submitted', {'rating': _rating}));
      unawaited(session.api.track('tip_amount', {'amount': tipTiyin}));
      if (!mounted) return;
      showSozoToast(context, t('c21.done'));
      Navigator.of(context).popUntil((r) => r.isFirst);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final master = widget.order['master'] as Map<String, dynamic>?;
    // Низкая оценка требует пояснения мягко: подпись, а не блокировка кнопки
    final needComment = _rating > 0 && _rating <= 2;

    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c21.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SozoCard(
                    children: [
                      Row(
                        children: [
                          PersonAvatar(name: (master?['name'] as String?) ?? '?', size: 48),
                          const SizedBox(width: SozoSpace.s12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (master?['name'] as String?) ?? '',
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: SozoColors.text,
                                  ),
                                ),
                                Text(
                                  (widget.order['number'] as String?) ?? '',
                                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var i = 1; i <= 5; i++)
                        // Тап-зона 44 при иконке 34 (чек-лист §6 п.5)
                        GestureDetector(
                          onTap: () => setState(() => _rating = i),
                          behavior: HitTestBehavior.opaque,
                          child: SizedBox(
                            width: 52,
                            height: 52,
                            child: Center(
                              child: FigmaIcon(
                                'star',
                                size: 34,
                                color: i <= _rating ? SozoColors.accent : SozoColors.border,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),

                  if (!_cashPayment) ...[
                    SectionHeading(t('c21.tipsTitle'), subtitle: t('c21.tipsHint')),
                    const SizedBox(height: SozoSpace.s12),
                    Wrap(
                      spacing: SozoSpace.s8,
                      runSpacing: SozoSpace.s8,
                      children: [
                        for (final amount in const [1000000, 2000000, 5000000])
                          SozoChip(
                            soums(amount),
                            selected: _tip == amount,
                            onTap: () => setState(() {
                              _tip = _tip == amount ? 0 : amount;
                              _customTip.clear();
                            }),
                          ),
                      ],
                    ),
                    const SizedBox(height: SozoSpace.s12),
                    SozoField(
                      label: t('c21.tipCustom'),
                      controller: _customTip,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => setState(() => _tip = 0),
                    ),
                  ],

                  SozoField(
                    label: t('c21.comment'),
                    controller: _comment,
                    hint: t('c21.commentHint'),
                    helper: needComment ? t('c21.lowRatingHint') : null,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                  ),

                  if (_rating >= 4)
                    SozoCard(
                      children: [
                        SwitchRow(
                          title: t('c21.remember'),
                          subtitle: t('c21.rememberHint'),
                          value: _remember,
                          onChanged: (v) => setState(() => _remember = v),
                        ),
                      ],
                    ),

                  if (_error != null) ...[
                    const SizedBox(height: SozoSpace.s12),
                    SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
                  ],
                ],
              ),
            ),
            StickyFooter(
              children: [
                PrimaryButton(t('common.send'), busy: _busy, onTap: _rating > 0 ? _submit : null),
                AmberAction(t('c21.later'), onTap: () => Navigator.of(context).pop()),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
