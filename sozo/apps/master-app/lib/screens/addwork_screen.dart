import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// M-17 «Вынужденная доп-работа» — работы, без которых исходную не завершить.
///
/// Никогда не смешивается с апсейлом: другой экран, другие правила.
/// Клиенту предлагаются два варианта — минимальный (безопасная времянка)
/// и полный (замена целиком). Молчание по вынужденной работе всегда эскалируется.
class AddworkScreen extends StatefulWidget {
  const AddworkScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<AddworkScreen> createState() => _AddworkScreenState();
}

class _AddworkScreenState extends State<AddworkScreen> {
  String? _photo;
  final Map<String, int> _minimal = {};
  final Map<String, int> _full = {};
  bool _busy = false;

  int _totalOf(Map<String, int> picked) {
    var sum = 0;
    for (final e in picked.entries) {
      final item = session.catalog.where((i) => i.id == e.key).firstOrNull;
      if (item != null) sum += item.priceFromTiyin * e.value;
    }
    return sum;
  }

  bool get _canSend => _photo != null && (_minimal.isNotEmpty || _full.isNotEmpty);

  Future<void> _send() async {
    setState(() => _busy = true);
    final variants = <Map<String, dynamic>>[
      if (_minimal.isNotEmpty)
        {
          'kind': 'minimal',
          'lines': _minimal.entries.map((e) => {'priceItemId': e.key, 'qty': e.value}).toList(),
        },
      if (_full.isNotEmpty)
        {
          'kind': 'full',
          'lines': _full.entries.map((e) => {'priceItemId': e.key, 'qty': e.value}).toList(),
        },
    ];
    final body = {'photoDataUrl': _photo, 'variants': variants};
    try {
      await session.api.sendAddwork(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('work.otpravlenoMojnoVypolnyatSoglas'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'addwork',
          payload: body,
          title: t('work.dopRabota', {'p1': widget.order.number}),
        );
        if (!mounted) return;
        showOk(context, t('work.netSetiUydetPri'));
        Navigator.of(context).pop(true);
      } else if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _pick(Map<String, int> target, String title) async {
    final picked = await Navigator.of(context).push<Map<String, int>>(
      MaterialPageRoute(
        builder: (_) => _CatalogPicker(title: title, initial: target),
      ),
    );
    if (picked != null) {
      setState(() {
        target
          ..clear()
          ..addAll(picked);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('work.vynujdennayaDopRabota')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('work.etoRabotyBezKotoryh'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s16),
          SectionTitle(t('work.fotoProblemyObyazatelno')),
          SozoCard(
            child: Row(
              children: [
                FigmaIcon(
                  _photo != null ? 'check-done' : 'camera',
                  color: _photo != null ? SozoColors.success : SozoColors.textSecondary,
                  size: 20,
                ),
                const SizedBox(width: SozoSpace.s12),
                Expanded(child: Text(t('work.snimokVskrytoyProblemy'))),
                TextButton(
                  onPressed: () => showPhotoCapture(
                    context,
                    title: t('work.fotoProblemy'),
                    stage: 'during',
                    alreadyTaken: _photo != null ? 1 : 0,
                    hint: t('work.klientPoluchitEtoFoto'),
                    onUpload: (dataUrl) async {
                      setState(() => _photo = dataUrl);
                      return true;
                    },
                  ),
                  child: Text(t('common.snyat')),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          _variantCard(t('work.minimalnyy'), t('work.bezopasnayaVremyankaIliChastic'), _minimal),
          const SizedBox(height: SozoSpace.s12),
          _variantCard(t('work.polnyy'), t('work.zamenaCelikom'), _full),
          const SizedBox(height: SozoSpace.s16),
          BlockerNote(icon: 'calendar', text: t('work.klientPoluchitFotoI')),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('common.otpravit'), busy: _busy, onPressed: _canSend ? _send : null),
          if (!_canSend)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s8),
              child: Text(
                t('work.nujnyFotoIHotya'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }

  Widget _variantCard(String title, String subtitle, Map<String, int> picked) {
    final total = _totalOf(picked);
    return SozoCard(
      accent: picked.isNotEmpty,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                    Text(subtitle, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => _pick(picked, title),
                child: Text(picked.isEmpty ? t('work.vybrat') : t('common.izmenit')),
              ),
            ],
          ),
          if (picked.isNotEmpty) ...[
            const Divider(color: SozoColors.border),
            ...picked.entries.map((e) {
              final item = session.catalog.where((i) => i.id == e.key).firstOrNull;
              return Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${item?.name ?? '—'}${e.value > 1 ? ' × ${e.value}' : ''}',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ),
                    Money(
                      formatSoums((item?.priceFromTiyin ?? 0) * e.value),
                      size: 14,
                      color: SozoColors.textSecondary,
                      weight: FontWeight.w500,
                    ),
                  ],
                ),
              );
            }),
            const SizedBox(height: SozoSpace.s8),
            Row(
              children: [
                Text(t('work.itogo'), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                const Spacer(),
                Money(formatSoums(total), size: 15),
              ],
            ),
            Row(
              children: [
                Text(t('common.vashaDolya'), style: TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                const Spacer(),
                Text(
                  formatSoums((total * 0.55).round()),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.accent),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Выбор позиций из кешированного прайса — общий для доп-работ и рекомендаций
class _CatalogPicker extends StatefulWidget {
  const _CatalogPicker({required this.title, required this.initial});

  final String title;
  final Map<String, int> initial;

  @override
  State<_CatalogPicker> createState() => _CatalogPickerState();
}

class _CatalogPickerState extends State<_CatalogPicker> {
  late final Map<String, int> _picked = Map.of(widget.initial);
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final items = _query.isEmpty
        ? session.catalog
        : session.catalog.where((i) => i.name.toLowerCase().contains(_query.toLowerCase())).toList();
    return Scaffold(
      appBar: SozoAppBar(title: widget.title),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: TextField(
              onChanged: (v) => setState(() => _query = v),
              decoration: InputDecoration(
                hintText: t('work.naytiVPrayse'),
                prefixIcon: const FigmaIcon('search', size: 20),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
              ),
            ),
          ),
          Expanded(
            child: items.isEmpty
                ? EmptyView(title: t('work.nichegoNeNaydeno'), icon: 'alert-circle')
                : ListView.builder(
                    itemCount: items.length,
                    itemBuilder: (context, i) {
                      final item = items[i];
                      final qty = _picked[item.id] ?? 0;
                      return ListTile(
                        title: Text(item.name, style: const TextStyle(fontSize: 15)),
                        subtitle: Text(
                          t('common.ot', {'p1': formatSoums(item.priceFromTiyin)}),
                          style: const TextStyle(fontSize: 13),
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
            child: Padding(
              padding: const EdgeInsets.all(SozoSpace.s16),
              child: PrimaryButton(label: t('common.gotovo'), onPressed: () => Navigator.of(context).pop(_picked)),
            ),
          ),
        ],
      ),
    );
  }
}

/// M-19 «Консервация» — безопасное отключение при отказе от вынужденных работ.
/// Юридическая защита: «клиент предупреждён об опасности, от работ отказался».
class ConservationScreen extends StatefulWidget {
  const ConservationScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<ConservationScreen> createState() => _ConservationScreenState();
}

class _ConservationScreenState extends State<ConservationScreen> {
  String? _photo;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.conservation(widget.order.id, _photo!);
      if (!mounted) return;
      showOk(context, t('work.konservaciyaZafiksirovana', {'p1': formatSoums((r['amountTiyin'] as num).toInt())}));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'conservation',
          payload: {'photoDataUrl': _photo},
          title: t('work.konservaciya', {'p1': widget.order.number}),
        );
        if (!mounted) return;
        showOk(context, t('work.netSetiUydetPri2'));
        Navigator.of(context).pop(true);
      } else if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('work.konservaciya2')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          BlockerNote(icon: 'alert-triangle', text: t('work.klientOtkazalsyaOtVynujdennyh')),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Row(
              children: [
                FigmaIcon(
                  _photo != null ? 'check-done' : 'camera',
                  color: _photo != null ? SozoColors.success : SozoColors.textSecondary,
                  size: 20,
                ),
                const SizedBox(width: SozoSpace.s12),
                Expanded(child: Text(t('work.fotoVypolnennoyKonservacii'))),
                TextButton(
                  onPressed: () => showPhotoCapture(
                    context,
                    title: t('work.fotoKonservacii'),
                    stage: 'during',
                    alreadyTaken: _photo != null ? 1 : 0,
                    hint: t('work.snimitePerekrytyyKranObestoche'),
                    onUpload: (dataUrl) async {
                      setState(() => _photo = dataUrl);
                      return true;
                    },
                  ),
                  child: Text(t('common.snyat')),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          Text(
            t('work.zayavkaBudetZakrytaS'),
            style: TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
          ),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('work.vypolnilKonservaciyu'), busy: _busy, onPressed: _photo != null ? _submit : null),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}
