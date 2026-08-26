import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import 'addresses_screen.dart';
import 'create/wizard.dart';
import 'equipment_screen.dart';
import 'notifications_screen.dart';
import 'order_screen.dart';
import 'shell.dart';

/// C-06. Главный экран B2C.
///
/// Экран отвечает на вопрос «что сейчас», а не предлагает меню возможностей.
/// Поэтому порядок жёсткий: сначала то, что ждёт решения, потом текущая
/// заявка, и только потом — создание новой. Когда мастер уже едет, каталог
/// работ клиенту не нужен; когда ничего не сломалось, не нужна пустая карточка.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _viewKey = GlobalKey<AsyncViewState<_HomeData>>();

  Future<_HomeData> _load() async {
    final orders = await session.api.orders();
    await session.refreshMe();
    // Адрес в шапке (190:22) — тот, с которого чаще всего вызывают. Ошибка
    // запроса не должна ронять главную: строка просто не покажется
    Map<String, dynamic> addresses = const {};
    try {
      addresses = await session.api.addresses();
    } catch (_) {}
    return _HomeData(orders: orders, addresses: addresses);
  }

  /// Шапка (190:16): логотип слева, колокольчик справа. Заголовка-текста в
  /// макете нет — личный кабинет подписывать нечем, он тут единственный.
  Widget _header() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const SozoWordmark(height: 22.553),
          Material(
            color: SozoColors.surface,
            borderRadius: BorderRadius.circular(20),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()),
                );
                await session.refreshMe();
                if (mounted) setState(() {});
              },
              child: const Padding(
                padding: EdgeInsets.all(SozoSpace.s8),
                child: FigmaIcon('bell', size: 18, color: authInk),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Выбор адреса (190:22)
  Widget _addressSelector(String address) {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const AddressesScreen()),
          );
          _viewKey.currentState?.reload();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: 14),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  children: [
                    const FigmaIcon('map-pin', size: 18, color: authInk),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        address,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: authInk),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s8),
              const FigmaIcon('chevron-right', size: 16, color: authHint),
            ],
          ),
        ),
      ),
    );
  }

  /// Заголовок раздела (190:144): pt 8, pb 4, 16 bold
  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.only(top: SozoSpace.s8, bottom: 4),
      child: Text(
        text,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Своей шапки-аппбара у главной нет: в макете логотип и колокольчик —
    // первая строка прокручиваемого списка (190:15 → 190:16), а не панель
    return SafeArea(
      bottom: false,
      child: AsyncView<_HomeData>(
        key: _viewKey,
        load: _load,
        skeleton: () => const _HomeSkeleton(),
        builder: (context, data, reload) => _content(context, data, reload),
      ),
    );
  }

  Widget _content(BuildContext context, _HomeData data, Future<void> Function() reload) {
    final awaiting = ((data.orders['awaiting'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final active = data.orders['activeOrder'] as Map<String, dynamic>?;
    final repeatable = data.orders['repeatable'] as Map<String, dynamic>?;
    final postponed = ((data.orders['postponedRecommendations'] as List?) ?? const [])
        .cast<Map<String, dynamic>>();
    final debt = session.debtTiyin;
    final blocked = session.me?['blocked'] as Map<String, dynamic>?;
    final warranty = data.orders['warranty'] as Map<String, dynamic>?;
    final equipmentDue = ((data.orders['equipmentDue'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final firstRun = data.orders['firstRun'] as Map<String, dynamic>?;

    // Адрес шапки: главный из сохранённых, иначе адрес текущей заявки
    final saved = ((data.addresses['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final headerAddress = (saved.firstWhere(
              (a) => a['isDefault'] == true,
              orElse: () => saved.isEmpty ? const <String, dynamic>{} : saved.first,
            )['street'] as String?) ??
        (active?['address'] as String?) ??
        t('c06.addressPick');

    // Расстояние между блоками — 12 (190:15, gap-[12px]); низ 100 под таббар
    return ListView(
      // Низ 32, а не 100 из макета: там таббар нарисован поверх прокрутки,
      // а во Flutter он занимает своё место снизу — сто точек превращались
      // в пустоту под содержимым
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s32),
      children: [
        _header(),
        const SizedBox(height: SozoSpace.s12),
        _addressSelector(headerAddress),
        const SizedBox(height: SozoSpace.s12),

        // 1. Что ждёт вашего ответа. Пока таких заявок нет — блока нет вовсе
        if (awaiting.isNotEmpty) ...[
          _sectionTitle(t('c06.awaiting')),
          const SizedBox(height: SozoSpace.s12),
          for (final o in awaiting) ...[
            _awaitingCard(context, o, reload),
            const SizedBox(height: SozoSpace.s12),
          ],
        ],

        // Блокировка — раньше долга: она запрещает больше и снимается иначе.
        // Главное в этой плашке не запрет, а то, что аварийный вызов работает
        if (blocked != null) ...[
          SozoBanner(
            icon: 'alert-triangle',
            tone: BannerTone.danger,
            title: t('c06.blockedTitle'),
            text: t('c06.blockedText', {'reason': blocked['reason'] ?? ''}),
            actionLabel: t('c06.emergencyCall'),
            onAction: () => _create(context, reload, emergency: true),
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        if (debt > 0) ...[
          _debtBanner(debt, () => _open(context, active, reload)),
          const SizedBox(height: SozoSpace.s12),
        ],

        // 2. Текущая заявка — крупно, со статусом и мастером
        if (active != null) ...[
          _sectionTitle(t('c06.now')),
          const SizedBox(height: SozoSpace.s12),
          _activeCard(context, active, reload),
          const SizedBox(height: SozoSpace.s12),
        ],

        // Первый вход: вместо пустого экрана — как это устроено и сколько
        // стоит приезд. Самый частый вопрос перед первым вызовом про деньги,
        // и молчание о них читается как «сориентируем на месте»
        if (firstRun != null) ...[
          _firstRunCard(firstRun),
          const SizedBox(height: SozoSpace.s16),
        ],

        // Главное действие экрана — во всю ширину и словами.
        //
        // Какое-то время её здесь не было: в макете место кнопки занял плюс в
        // центре таббара (190:86), и две точки входа рядом казались делёжкой
        // внимания. На живом экране вышло иначе. Плюс — безымянная иконка, а
        // самым заметным элементом главной осталась красная аварийная плашка,
        // и человек без заявок делал единственный доступный ему вывод: раз
        // кнопки нет, надо жать красное. Плюс остался ускорителем для тех, кто
        // уже освоился, и теперь тоже подписан
        _callMasterButton(
          () => _create(
            context,
            reload,
            blockedByDebt: debt > 0,
            blocked: blocked != null,
          ),
        ),
        const SizedBox(height: SozoSpace.s12),

        // Простой режим предлагаем тому, кто уже увеличил системный шрифт:
        // сам он до третьей строки настроек профиля не дойдёт
        if (_offerSimpleMode(context)) ...[
          _simpleModeOffer(context),
          const SizedBox(height: SozoSpace.s12),
        ],

        // 4. Повтор прошлой заявки — два тапа, без визарда (ТЗ 17.17 п.2)
        if (repeatable != null) ...[
          _actionRow(
            iconBg: SozoColors.accent.withValues(alpha: 0.1),
            icon: 'rotate-ccw',
            iconColor: SozoColors.accent,
            title: t('c06.repeat', {'what': repeatable['category'] ?? ''}),
            subtitle: [repeatable['masterName'], repeatable['address']]
                .where((v) => (v as String?)?.isNotEmpty ?? false)
                .join(' · '),
            onTap: () => _repeat(context, repeatable, reload),
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        // Техника, которой пора заняться: напоминание жило внутри экрана
        // «Моя техника», куда заходят раз в полгода — то есть ровно тогда,
        // когда оно уже не нужно
        if (equipmentDue.isNotEmpty) ...[
          // Напоминания в макете нет — там снят экран без этой техники.
          // Строку оставляем, но собираем тем же блоком, что повтор и гарантия:
          // выкидывать работающее из-за отсутствия на одном снимке нельзя,
          // рисовать её по-своему — тоже
          _actionRow(
            iconBg: softWarnBg,
            icon: 'toolbox',
            iconColor: softWarnFg,
            title: t('c06.equipmentDue', {'what': equipmentDue.first['title'] ?? ''}),
            subtitle: t('c06.equipmentDueSub', {
              'days': plural(
                (equipmentDue.first['daysSinceService'] as num?)?.toInt() ?? 0,
                'plural.days',
              ),
            }),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const EquipmentScreen()),
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        // Гарантия — самое сильное обещание сервиса, и до сих пор оно молчало:
        // было видно только внутри карточки закрытой заявки
        if (((warranty?['count'] as num?) ?? 0) > 0) ...[
          _actionRow(
            iconBg: homeOkChipBg,
            icon: 'shield-check',
            iconColor: homeOkChipFg,
            title: t('c06.warranty', {
              'n': plural(((warranty!['count'] as num?) ?? 0).toInt(), 'plural.works'),
            }),
            subtitle: t('c06.warrantySub', {'date': dayMonth(warranty['nextUntil'])}),
            subtitleMaxLines: 2,
            onTap: () {
              shellTab.value = 2;
              historyFilter.value = 'warranty';
            },
          ),
          const SizedBox(height: SozoSpace.s12),
        ],

        // 5. Авария — компактной строкой, но всегда на виду и всегда рабочей
        _emergencyBanner(() => _create(context, reload, emergency: true)),

        if (postponed.isNotEmpty) ...[
          const SizedBox(height: SozoSpace.s12),
          SozoCard(
            onTap: () => _openPostponed(context, postponed, reload),
            children: [
              Row(
                children: [
                  const FigmaIcon('sparkles', size: 20, color: SozoColors.textSecondary),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Text(
                      t('c06.postponed', {'n': plural(postponed.length, 'plural.recommendations')}),
                      style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary),
                    ),
                  ),
                  const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
                ],
              ),
            ],
          ),
        ],
      ],
    );
  }

  /// Карточка «от вас ждут»: что именно и кнопка, ведущая прямо к решению
  Widget _awaitingCard(BuildContext context, Map<String, dynamic> o, Future<void> Function() reload) {
    final d = (o['decision'] as Map<String, dynamic>?) ?? const {};
    final urgent = d['urgent'] == true;
    final category = (o['category'] as String?) ?? '';
    final number = (o['number'] as String?) ?? '';
    return Container(
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        // Срочное обведено янтарным на половинной прозрачности (190:53)
        border: urgent ? Border.all(color: SozoColors.accent.withValues(alpha: 0.5), width: 1.5) : null,
      ),
      padding: const EdgeInsets.all(SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Срочное — голый восклицательный знак, обычное — колокольчик
              // в серой плитке 36 (190:148 против 190:157)
              if (urgent)
                const Padding(
                  padding: EdgeInsets.only(top: 2),
                  child: FigmaIcon('alert-circle', size: 18, color: homeDanger),
                )
              else
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: SozoColors.bg, borderRadius: BorderRadius.circular(18)),
                  alignment: Alignment.center,
                  child: const FigmaIcon('bell', size: 18, color: authInk),
                ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (d['title'] as String?) ?? '',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: authInk),
                    ),
                    const SizedBox(height: 4),
                    // Номер заявки полужирным внутри строки: по нему человек
                    // и находит нужную, когда таких карточек восемь (190:153)
                    Text.rich(
                      TextSpan(
                        text: number.isEmpty ? category : '$category · ',
                        children: [
                          if (number.isNotEmpty)
                            TextSpan(text: number, style: const TextStyle(fontWeight: FontWeight.w600)),
                        ],
                      ),
                      style: const TextStyle(fontSize: 13, color: authHint),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _replyButton(() => _open(context, o, reload)),
        ],
      ),
    );
  }

  /// Плашка долга (190:216): своя, не общий баннер — в макете у неё плитка
  /// с иконкой, текст 12 и красная кнопка справа, а не действие под текстом
  Widget _debtBanner(int debt, VoidCallback onPay) {
    return Container(
      decoration: BoxDecoration(color: homeDebtBg, borderRadius: BorderRadius.circular(SozoRadius.tile)),
      padding: const EdgeInsets.all(SozoSpace.s16),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: homeDebtIconBg, borderRadius: BorderRadius.circular(18)),
            alignment: Alignment.center,
            child: const FigmaIcon('credit-card', size: 18, color: homeDanger),
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Text(
              t('c06.debt', {'sum': soums(debt)}),
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: homeDanger),
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          Material(
            color: homeDanger,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: onPay,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: 10),
                child: Text(
                  t('c06.pay'),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.surface),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Строка-действие с плиткой-иконкой (190:35 и 190:43): повтор и гарантия
  /// собраны одинаково, отличаются только цветом плитки и текстом
  Widget _actionRow({
    required Color iconBg,
    required String icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    int subtitleMaxLines = 1,
  }) {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(20)),
                alignment: Alignment.center,
                child: FigmaIcon(icon, size: 18, color: iconColor),
              ),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: authInk),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: subtitleMaxLines,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, color: authHint, height: 1.3),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s8),
              const FigmaIcon('chevron-right', size: 16, color: authHint),
            ],
          ),
        ),
      ),
    );
  }

  /// «Вызвать мастера» — 56 точек во всю ширину, янтарная заливка.
  ///
  /// Иконка слева, чтобы кнопка читалась как действие, а не как заголовок
  Widget _callMasterButton(VoidCallback onTap) {
    return Material(
      color: SozoColors.accent,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onTap,
        child: SizedBox(
          height: SozoSize.buttonPrimary,
          width: double.infinity,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const FigmaIcon('wrench', size: 20, color: SozoColors.onAccent),
              const SizedBox(width: SozoSpace.s8),
              Flexible(
                child: Text(
                  t('c06.callMaster'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: SozoColors.onAccent,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Показывать ли предложение простого режима.
  ///
  /// Признак — системный шрифт крупнее обычного: человек уже сказал телефону,
  /// что ему трудно читать, и повторять это приложению не должен. По возрасту
  /// не предлагаем никогда — это оскорбительно (DEV-15 §10.3.1); отказ
  /// запоминается, второй раз не спрашиваем.
  bool _offerSimpleMode(BuildContext context) =>
      !session.simpleMode &&
      !session.simpleModeDeclined &&
      MediaQuery.textScalerOf(context).scale(16) > 16 * 1.2;

  Widget _simpleModeOffer(BuildContext context) {
    return SozoCard(
      children: [
        Text(
          t('simple.offerTitle'),
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
        ),
        Text(
          t('simple.offerText'),
          style: const TextStyle(fontSize: 15, height: 1.35, color: SozoColors.textSecondary),
        ),
        Row(
          children: [
            Expanded(
              child: SecondaryButton(
                t('simple.offerAccept'),
                onTap: () => session.setSimpleMode(true),
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Expanded(
              child: TextAction(
                t('simple.offerDecline'),
                onTap: () => session.declineSimpleMode(),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// Авария (190:30): без кнопки — нажимается вся плашка
  Widget _emergencyBanner(VoidCallback onTap) {
    return Material(
      color: homeEmergencyBg,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Row(
            children: [
              const FigmaIcon('alert-triangle', size: 20, color: homeDanger),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t('c06.emergencyTitle'),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: homeDanger),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      t('c06.emergencyText'),
                      style: const TextStyle(fontSize: 13, color: homeDanger),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Кнопка «Ответить» (190:154): во всю ширину, r12, py12, 14 bold
  Widget _replyButton(VoidCallback onTap) {
    return Material(
      color: SozoColors.accent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
          alignment: Alignment.center,
          child: Text(
            t('c06.answer'),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: authInk),
          ),
        ),
      ),
    );
  }

  /// Текущая заявка: статус, окно, мастер — то, ради чего открывают приложение
  Widget _activeCard(BuildContext context, Map<String, dynamic> o, Future<void> Function() reload) {
    // Карточка текущей заявки (190:226): название, статус, адрес, шеврон.
    // Окна и имени мастера в макете нет — они на карточке самой заявки
    final chip = statusChipColors((o['status'] as String?) ?? '');
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: () => _open(context, o, reload),
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (o['category'] as String?) ?? '',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: authInk),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: 3),
                      decoration: BoxDecoration(color: chip.bg, borderRadius: BorderRadius.circular(SozoRadius.badge)),
                      child: Text(
                        (o['statusLabel'] as String?) ?? '',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: chip.fg),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const FigmaIcon('map-pin', size: 14, color: authHint),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            (o['address'] as String?) ?? '',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13, color: authHint),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              const FigmaIcon('chevron-right', size: 16, color: authHint),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context, Map<String, dynamic>? order, Future<void> Function() reload) async {
    if (order == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: order['id'] as String)),
    );
    await reload();
  }

  /// Три шага и цена приезда — всё, что нужно знать перед первым вызовом.
  Widget _firstRunCard(Map<String, dynamic> f) {
    final steps = ((f['steps'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final price = (f['visitPriceTiyin'] as num?)?.toInt();
    return SozoCard(
      children: [
        CardTitle(t('c06.firstRunTitle')),
        for (final (i, s) in steps.indexed)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  '${i + 1}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.onAccent),
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (s['title'] as String?) ?? '',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (s['text'] as String?) ?? '',
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.35),
                    ),
                  ],
                ),
              ),
            ],
          ),
        if (price != null && price > 0) ...[
          const SozoDivider(),
          MoneyRow(label: t('c06.firstRunVisit'), amount: soums(price), bold: true),
          Text(
            (f['visitNote'] as String?) ?? '',
            style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.35),
          ),
        ],
        if ((f['warrantyDays'] as num?) != null)
          Text(
            t('c06.firstRunWarranty', {'days': f['warrantyDays']}),
            style: const TextStyle(fontSize: 13, color: SozoColors.success, fontWeight: FontWeight.w600),
          ),
      ],
    );
  }

  Future<void> _create(
    BuildContext context,
    Future<void> Function() reload, {
    bool emergency = false,
    bool blockedByDebt = false,
    bool blocked = false,
    String? category,
  }) async {
    // Блокировку снимает только поддержка — предлагать «оплатить и продолжить»
    // здесь нечего. Единственное, что осталось доступным, — аварийный вызов
    if (blocked && !emergency) {
      final callEmergency = await showSozoConfirm(
        context,
        title: t('c06.blockedTitle'),
        text: t('c06.blockedOnly'),
        confirmLabel: t('c06.emergencyCall'),
      );
      if (!callEmergency) return;
      emergency = true;
    }
    if (!context.mounted) return;
    // Долг закрывает обычные заявки, но не аварию: перекрыть человеку воду
    // из-за неоплаченного счёта нельзя (ТЗ 4.4)
    if (blockedByDebt && !emergency) {
      final pay = await showSozoConfirm(
        context,
        title: t('c06.debtTitle'),
        text: t('c06.debtText', {'sum': soums(session.debtTiyin)}),
        confirmLabel: t('c06.pay'),
      );
      if (!pay) return;
    }
    if (!context.mounted) return;
    final created = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        builder: (_) => CreateOrderFlow(
          emergency: emergency,
          category: category,
        ),
      ),
    );
    await reload();
    if (created != null && context.mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created)),
      );
      await reload();
    }
  }

  /// Повтор: работы и адрес берутся из прошлой заявки, остаётся выбрать время
  /// и отправить — два тапа вместо трёх шагов визарда (ТЗ 17.17 п.2)
  Future<void> _repeat(
    BuildContext context,
    Map<String, dynamic> source,
    Future<void> Function() reload,
  ) async {
    Map<String, dynamic> full;
    Map<String, dynamic> slots;
    try {
      full = await session.api.order(source['id'] as String);
      final items = ((full['lines'] as List?) ?? const [])
          .cast<Map<String, dynamic>>()
          .map((l) => '${l['priceItemId']}:${l['qty']}')
          .join(',');
      slots = await session.api.slots(items: items);
    } catch (e) {
      if (context.mounted) showSozoToast(context, humanError(e));
      return;
    }
    if (!context.mounted) return;

    final created = await showSozoSheet<String>(
      context,
      title: t('c06.repeatTitle'),
      child: _RepeatSheet(source: full, slots: slots),
    );
    await reload();
    if (created != null && context.mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created)),
      );
      await reload();
    }
  }

  Future<void> _openPostponed(
    BuildContext context,
    List<Map<String, dynamic>> items,
    Future<void> Function() reload,
  ) async {
    await showSozoSheet<void>(
      context,
      title: t('c06.postponedTitle'),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        children: [
          for (final r in items) ...[
            SozoCard(
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: r['orderId'] as String)),
                );
              },
              children: [
                Text(
                  ((r['lines'] as List?) ?? const []).map((l) => (l as Map)['name']).join(', '),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                ),
                MoneyRow(label: (r['orderNumber'] as String?) ?? '', amount: soums(r['totalTiyin'])),
              ],
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
        ],
      ),
    );
    await reload();
  }
}

/// Лист повтора: состав работ показан, но не редактируется — если нужно
/// другое, это новая заявка, а не повтор. Меняется только время.
class _RepeatSheet extends StatefulWidget {
  const _RepeatSheet({required this.source, required this.slots});

  final Map<String, dynamic> source;
  final Map<String, dynamic> slots;

  @override
  State<_RepeatSheet> createState() => _RepeatSheetState();
}

class _RepeatSheetState extends State<_RepeatSheet> {
  String? _slotKey;
  String _timeMode = 'slot';
  bool _busy = false;
  String? _error;

  /// Свой ключ идемпотентности на этот лист: повтор заявки — тоже создание,
  /// и таймаут после того, как сервер её завёл, точно так же провоцирует
  /// второе нажатие. Ключ живёт, пока открыт лист, поэтому повтор одного и
  /// того же нажатия сервер узнает
  final String _idempotencyKey = OrderDraft.newIdempotencyKey();

  List<Map<String, dynamic>> get _lines =>
      ((widget.source['lines'] as List?) ?? const []).cast<Map<String, dynamic>>();

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final parts = _slotKey?.split('|');
      final created = await session.api.createOrder({
        'items': [
          for (final l in _lines) {'priceItemId': l['priceItemId'], 'qty': l['qty']},
        ],
        'description': widget.source['description'],
        'address': widget.source['address'],
        'urgency': _timeMode == 'urgent' ? 'urgent' : 'normal',
        'timeMode': _timeMode,
        'slotDate': parts?.first,
        'slotStartMin': parts == null ? null : int.tryParse(parts.last),
        'source': 'repeat',
      }, idempotencyKey: _idempotencyKey);
      if (!mounted) return;
      showSozoToast(context, t('c13.sent'));
      Navigator.of(context).pop(created['id'] as String);
    } catch (e) {
      if (mounted) setState(() => _error = humanError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = ((widget.slots['days'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final ready = _timeMode != 'slot' || _slotKey != null;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SozoCard(
            children: [
              for (final l in _lines)
                MoneyRow(
                  label: (l['name'] as String?) ?? '',
                  sub: (l['qty'] as num? ?? 1) > 1 ? '× ${l['qty']}' : null,
                  amount: soums(l['fromTiyin']),
                ),
              const SozoDivider(),
              Row(
                children: [
                  const FigmaIcon('map-pin', size: 16, color: SozoColors.textSecondary),
                  const SizedBox(width: SozoSpace.s8),
                  Expanded(
                    child: Text(
                      (widget.source['address'] as String?) ?? '',
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionHeading(t('c10.whenTitle')),
          const SizedBox(height: SozoSpace.s8),
          if (days.isEmpty)
            SozoBanner(icon: 'clock', text: t('c10.noWindows'))
          else
            for (final day in days.take(2)) ...[
              Text(
                relativeDay('${day['date']}T00:00:00'),
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
              const SizedBox(height: SozoSpace.s8),
              Wrap(
                spacing: SozoSpace.s8,
                runSpacing: SozoSpace.s8,
                children: [
                  for (final w in ((day['windows'] as List?) ?? const []).cast<Map<String, dynamic>>())
                    SozoChip(
                      (w['label'] as String?) ?? '',
                      selected: _slotKey == '${day['date']}|${w['startMin']}',
                      onTap: () => setState(() {
                        _timeMode = 'slot';
                        _slotKey = '${day['date']}|${w['startMin']}';
                      }),
                    ),
                ],
              ),
              const SizedBox(height: SozoSpace.s12),
            ],
          SozoChip(
            t('c10.waitlistTitle'),
            icon: 'hourglass',
            selected: _timeMode == 'waitlist',
            onTap: () => setState(() {
              _timeMode = 'waitlist';
              _slotKey = null;
            }),
          ),
          if (_error != null) ...[
            const SizedBox(height: SozoSpace.s12),
            SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
          ],
          const SizedBox(height: SozoSpace.s16),
          PrimaryButton(t('common.send'), busy: _busy, onTap: ready ? _submit : null),
          const SizedBox(height: SozoSpace.s8),
        ],
      ),
    );
  }
}

class _HomeData {
  _HomeData({required this.orders, required this.addresses});

  final Map<String, dynamic> orders;
  final Map<String, dynamic> addresses;
}

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: const [
        SozoCard(children: [
          Skeleton(height: 16, width: 200),
          Skeleton(height: 12, width: 140),
          Skeleton(height: SozoSize.buttonPrimary, radius: SozoRadius.tile),
        ]),
        SizedBox(height: SozoSpace.s16),
        Skeleton(height: 14, width: 120),
        SizedBox(height: SozoSpace.s12),
        Row(
          children: [
            Expanded(child: Skeleton(height: 120, radius: SozoRadius.card)),
            SizedBox(width: SozoSpace.s12),
            Expanded(child: Skeleton(height: 120, radius: SozoRadius.card)),
          ],
        ),
      ],
    );
  }
}
