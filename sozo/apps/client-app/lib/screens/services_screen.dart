import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';
import 'create/wizard.dart';
import 'order_screen.dart';

/// Услуги и цены — отдельная вкладка.
///
/// Раньше каталог жил на главной и спорил с текущей заявкой за внимание, а
/// поиск был спрятан внутрь визарда: чтобы найти работу, надо было сначала
/// начать её оформлять. Теперь это самостоятельный раздел: посмотреть цены
/// можно, ничего не заказывая.
class ServicesScreen extends StatefulWidget {
  const ServicesScreen({super.key});

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  final _search = TextEditingController();
  String _query = '';
  String? _openCategory;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Своего аппбара нет: в макете (205:4) заголовок — часть прокручиваемого
    // содержимого, крупный, с городом над ним
    return SafeArea(
      bottom: false,
      child: AsyncView<Map<String, dynamic>>(
        load: () => session.api.catalog(),
        builder: (context, data, reload) {
          final cats = ((data['categories'] as List?) ?? const []).cast<Map<String, dynamic>>();
          final q = _query.trim().toLowerCase();
          final found = q.isEmpty
              ? const <Map<String, dynamic>>[]
              : cats
                  .expand((c) => ((c['items'] as List?) ?? const []).cast<Map<String, dynamic>>())
                  .where((i) => (i['name'] as String).toLowerCase().contains(q))
                  .take(30)
                  .toList();

          return ListView(
            // Низ 32, а не 100 из макета: в макете таббар нарисован поверх
            // прокрутки, а во Flutter он занимает своё место снизу — и
            // отступ в сто точек становился пустотой под содержимым
            padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s32),
            children: [
              _header(),
              const SizedBox(height: SozoSpace.s12),
              _searchField(),
              const SizedBox(height: SozoSpace.s12),

              if (q.isNotEmpty) ...[
                _sectionTitle(t('services.found')),
                const SizedBox(height: 10),
                if (found.isEmpty)
                  EmptyState(
                    icon: 'search',
                    text: t('services.nothing'),
                    actionLabel: t('c07.describeInstead'),
                    onAction: () => _order(context),
                  )
                else
                  for (final i in found) _itemRow(context, i),
              ] else ...[
                _sectionTitle(t('services.all')),
                const SizedBox(height: 10),
                // Все категории одним списком: в макете (205:16) плиток нет,
                // популярные и остальные больше не разделены — тринадцать
                // строк читаются подряд, а не выбираются из двух наборов
                for (final c in cats) ...[
                  _categoryRow(context, c),
                  const SizedBox(height: 10),
                ],
              ],

              const SizedBox(height: SozoSpace.s8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s8),
                child: Text(
                  t('services.priceNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.5,
                    fontStyle: FontStyle.italic,
                    color: authHint,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Шапка (205:4): город, крупный заголовок, пояснение
  Widget _header() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                t('services.city'),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: authHint),
              ),
              const SizedBox(width: 4),
              const FigmaIcon('chevron-down', size: 12, color: authHint),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            t('services.title'),
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: authInk),
          ),
          const SizedBox(height: 4),
          Text(
            t('services.subtitle'),
            style: const TextStyle(fontSize: 14, color: authHint),
          ),
        ],
      ),
    );
  }

  /// Поиск (205:12): белое поле с янтарной рамкой на пятой доле прозрачности
  Widget _searchField() {
    return Container(
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: SozoColors.accent.withValues(alpha: 0.2)),
        boxShadow: const [BoxShadow(color: Color(0x0A000000), blurRadius: 8, offset: Offset(0, 6))],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: SozoSpace.s12),
      child: Row(
        children: [
          const FigmaIcon('search', size: 18, color: authHint),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: _search,
              onChanged: (v) => setState(() => _query = v),
              style: const TextStyle(fontSize: 14, color: authInk),
              // Рамку и заливку рисует контейнер снаружи. Без явного
              // отключения тема добавляет свою — и поле получало вторую
              // рамку внутри первой
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
                hintText: t('services.searchHint'),
                hintStyle: const TextStyle(fontSize: 14, color: authHint),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 4, 2, 2),
      child: Text(
        text,
        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: authInk),
      ),
    );
  }

  /// Строка категории (207:6) и её раскрытие (210:29).
  ///
  /// Тап раскрывает список работ с ценами, а не уводит сразу в оформление:
  /// человек чаще приходит посмотреть, сколько это стоит, чем заказать не
  /// глядя. Заказ начинается с конкретной работы внутри.
  Widget _categoryRow(BuildContext context, Map<String, dynamic> c) {
    final name = (c['name'] as String?) ?? '';
    // «Не знаю, что сломалось» больше не подсвечена цветом (200:4) — она
    // стоит первой, и этого достаточно. Признак нужен для поведения: тап
    // ведёт сразу в оформление, а не раскрывает список работ — раскрывать
    // там нечего, человек как раз не может назвать работу
    final unsure = (c['icon'] as String?) == 'help-circle';
    final open = _openCategory == name;
    final items = ((c['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(15),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: () => unsure
                ? _order(context, category: name)
                : setState(() => _openCategory = open ? null : name),
            child: Padding(
              // Отступ 10 по вертикали: строка выходит 64 при кружке 44.
              // В макете высота 53, но там она задана жёстко и содержимое из
              // неё торчит; на живом экране такая строка читается тесной
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
              child: Row(
                children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: SozoColors.accent.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(22),
                ),
                alignment: Alignment.center,
                child: FigmaIcon((c['icon'] as String?) ?? 'wrench', size: 20, color: SozoColors.accent),
              ),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (c['label'] as String?) ?? name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      // Крупнее макета на две ступени: 13 и 10 в нём читаются
                      // только на экране компьютера, а не в руке
                      style: TextStyle(
                        fontSize: open ? 17 : 15,
                        fontWeight: FontWeight.w700,
                        color: authInk,
                      ),
                    ),
                    if (((c['hint'] as String?) ?? '').isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        c['hint'] as String,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, color: authHint),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              Text(
                '${t('common.from')} ${soums(c['priceFromTiyin'])}',
                textAlign: TextAlign.right,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: SozoColors.accent,
                  fontFeatures: moneyFeatures,
                ),
              ),
              const SizedBox(width: SozoSpace.s8),
              // Раскрытая — шеврон вверх (210:39: тот же значок, повёрнутый)
              FigmaIcon(open ? 'chevron-down' : 'chevron-right', size: 16, color: authHint),
                ],
              ),
            ),
          ),
          // Работы категории с ценами (210:41): каждая строка отделена линией
          if (open)
            for (final i in items)
              InkWell(
                onTap: () => _order(context, category: i['category'] as String?),
                child: Container(
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: authCardDivider)),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          (i['name'] as String?) ?? '',
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: authInk, height: 1.4),
                        ),
                      ),
                      const SizedBox(width: SozoSpace.s12),
                      Text(
                        '${t('common.from')} ${soums(i['priceFromTiyin'])}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: authInk,
                          fontFeatures: moneyFeatures,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }

  /// Найденная позиция прайса — строка результата поиска
  Widget _itemRow(BuildContext context, Map<String, dynamic> i) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
      child: Material(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          borderRadius: BorderRadius.circular(15),
          onTap: () => _order(context, category: i['category'] as String?),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: SozoSpace.s16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (i['name'] as String?) ?? '',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: authInk),
                      ),
                      if (i['isPaired'] == true || i['isStaged'] == true) ...[
                        const SizedBox(height: 3),
                        Text(
                          i['isStaged'] == true ? t('c07.staged') : t('c07.paired'),
                          style: const TextStyle(fontSize: 12, color: authHint),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: SozoSpace.s12),
                Text(
                  '${t('common.from')} ${soums(i['priceFromTiyin'])}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: SozoColors.accent,
                    fontFeatures: moneyFeatures,
                  ),
                ),
                const SizedBox(width: SozoSpace.s8),
                const FigmaIcon('chevron-right', size: 16, color: authHint),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _order(BuildContext context, {String? category}) async {
    final created = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        builder: (_) => CreateOrderFlow(
          category: category,
          query: _query.trim().isEmpty ? null : _query.trim(),
        ),
      ),
    );
    if (created != null && context.mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => OrderScreen(orderId: created)),
      );
    }
  }
}
