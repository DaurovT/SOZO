import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../i18n.dart';

/// Составление сметы (экран M-14).
///
/// Цены берутся только из активного релиза прайса — вручную сумму не поставить
/// (ТЗ 3.7). Каталог закеширован, поэтому смета собирается и без сети;
/// отправка в этом случае уйдёт очередью.
class QuoteScreen extends StatefulWidget {
  const QuoteScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<QuoteScreen> createState() => _QuoteScreenState();
}

class _QuoteScreenState extends State<QuoteScreen> {
  final Map<String, int> _picked = {}; // priceItemId → qty
  final _searchCtrl = TextEditingController();
  bool _urgent = false;
  bool _busy = false;
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<CatalogItem> get _items {
    final all = session.catalog;
    if (_query.isEmpty) return all;
    final q = _query.toLowerCase();
    return all.where((i) => i.name.toLowerCase().contains(q) || i.category.toLowerCase().contains(q)).toList();
  }

  int get _totalFrom {
    var sum = 0;
    for (final e in _picked.entries) {
      final item = session.catalog.firstWhere(
        (i) => i.id == e.key,
        orElse: () => CatalogItem(id: '', category: '', name: '', unit: '', priceFromTiyin: 0, priceToTiyin: 0),
      );
      sum += item.priceFromTiyin * e.value;
    }
    return _urgent ? (sum * 1.3).round() : sum;
  }

  Future<void> _send() async {
    final body = {
      'lines': _picked.entries.map((e) => {'priceItemId': e.key, 'qty': e.value}).toList(),
      'urgent': _urgent,
    };
    setState(() => _busy = true);
    try {
      await session.api.sendQuote(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('quote.smetaSostavlenaSoglasuyteEe'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'quote',
          payload: body,
          title: t('quote.smeta', {'p1': widget.order.number}),
        );
        if (!mounted) return;
        showOk(context, t('quote.netSetiSmetaUydet'));
        Navigator.of(context).pop(true);
      } else if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: SozoAppBar(title: t('order.smeta')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _query = v),
              decoration: InputDecoration(
                hintText: t('quote.naytiRabotuVPrayse'),
                prefixIcon: const FigmaIcon('search', size: 20),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
              ),
            ),
          ),
          if (session.catalog.isEmpty)
            Expanded(
              child: EmptyView(
                title: t('quote.praysNeZagrujen'),
                subtitle: t('quote.podklyuchitesKSetiHotya'),
                icon: 'credit-card',
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (context, i) {
                  final item = items[i];
                  final qty = _picked[item.id] ?? 0;
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s4),
                    title: Text(item.name, style: const TextStyle(fontSize: 15, height: 1.3)),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          Money(
                            formatSoums(item.priceFromTiyin),
                            size: 13,
                            color: SozoColors.text,
                            weight: FontWeight.w600,
                          ),
                          Text(
                            t('quote.za', {'p1': item.unit, 'p2': item.category}),
                            style: const TextStyle(fontSize: 12.5, color: SozoColors.textTertiary),
                          ),
                        ],
                      ),
                    ),
                    trailing: QtyStepper(
                      qty: qty,
                      onMinus: () => setState(() {
                        if (qty <= 1) {
                          _picked.remove(item.id);
                        } else {
                          _picked[item.id] = qty - 1;
                        }
                      }),
                      onPlus: () => setState(() => _picked[item.id] = qty + 1),
                    ),
                  );
                },
              ),
            ),
          SafeArea(
            child: Container(
              padding: const EdgeInsets.all(SozoSpace.s16),
              decoration: const BoxDecoration(
                color: SozoColors.surface,
                border: Border(top: BorderSide(color: SozoColors.border)),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t('quote.srochno30'),
                              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                            ),
                            SizedBox(height: 2),
                            Text(
                              t('quote.rabotaVneOcherediPo'),
                              style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: SozoSpace.s12),
                      SozoSwitch(value: _urgent, onChanged: (v) => setState(() => _urgent = v)),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  Row(
                    children: [
                      Text(t('order.itogoKlientu'), style: TextStyle(fontSize: 15, color: SozoColors.textSecondary)),
                      const Spacer(),
                      Money(t('common.ot', {'p1': formatSoums(_totalFrom)}), size: 18, weight: FontWeight.w700),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  PrimaryButton(
                    label: _picked.isEmpty ? t('quote.vyberitePozicii') : t('quote.sohranitSmetu'),
                    busy: _busy,
                    onPressed: _picked.isEmpty ? null : _send,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
