import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';

/// C-01. Цены до входа — то, что стоит за «Продолжить без регистрации».
///
/// Надпись была в макете (162:21) с самого начала, но обработчика у неё не
/// было: человек жал и не получал ничего, из чего заключал, что сломано
/// приложение. Гостевого сценария при этом нет ни в PRD-01, ни в API — там
/// без токена доступны ровно пять точек, и цены «от» одна из них.
///
/// Поэтому гость здесь именно смотрит, а не заказывает. Вызвать мастера без
/// телефона нельзя и не будет можно: мастеру некуда ехать и некому звонить о
/// задержке, а клиенту некуда прислать акт. Но узнать порядок цены человек
/// вправе, не отдавая номер, — иначе приложение требует телефон вперёд
/// любого ответа на вопрос «сколько это стоит», а ответ до сих пор был
/// только на лендинге.
class GuestPricesScreen extends StatelessWidget {
  const GuestPricesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c01.guestTitle')),
      body: AsyncView<Map<String, dynamic>>(
        load: () => session.api.publicPrices(),
        builder: (context, data, reload) {
          final cats = ((data['categories'] as List?) ?? const [])
              .cast<Map<String, dynamic>>()
              // Категория без цены — это незаполненный прайс, а не «бесплатно»:
              // показать её значило бы пообещать ноль
              .where((c) => c['priceFromTiyin'] != null)
              .toList();

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                      SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s16),
                  children: [
                    Text(
                      t('c01.guestSubtitle'),
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: SozoColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: SozoSpace.s16),
                    if (cats.isEmpty)
                      SozoCard(
                        children: [
                          Text(
                            t('c01.guestEmpty'),
                            style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                          ),
                        ],
                      )
                    else
                      SozoCard(
                        padding: EdgeInsets.zero,
                        gap: 0,
                        children: [
                          for (var i = 0; i < cats.length; i++) ...[
                            if (i > 0) const SozoDivider(),
                            _PriceRow(
                              name: (cats[i]['category'] ?? '').toString(),
                              fromTiyin: cats[i]['priceFromTiyin'],
                            ),
                          ],
                        ],
                      ),
                  ],
                ),
              ),
              // Кнопка входа закреплена внизу, а не стоит после списка: она
              // нужна на любой позиции прокрутки, и это единственный выход
              // отсюда в работающий сервис
              Container(
                padding: const EdgeInsets.fromLTRB(
                    SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s16),
                decoration: const BoxDecoration(
                  color: SozoColors.surface,
                  border: Border(top: BorderSide(color: SozoColors.border)),
                ),
                child: SafeArea(
                  top: false,
                  child: PrimaryButton(
                    t('c01.guestLoginCta'),
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({required this.name, required this.fromTiyin});

  final String name;
  final Object? fromTiyin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: SozoSpace.s16, vertical: SozoSpace.s14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              name,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: SozoColors.text,
                height: 1.3,
              ),
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          // Сумма подставляется в строку целиком, а не приклеивается к слову
          // «от»: по-узбекски и по-корейски предлог идёт после числа, и
          // склейка в коде даёт «от 80 000 soʻm» вместо «80 000 soʻmdan».
          // Само «от» обязательно: без него цифра читается как окончательная
          // цена, а окончательную называют только после осмотра
          Text(
            t('c01.guestFrom', {'p1': soums(fromTiyin)}),
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: SozoColors.text,
            ),
          ),
        ],
      ),
    );
  }
}
