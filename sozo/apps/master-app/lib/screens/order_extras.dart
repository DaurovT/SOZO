import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// M-16 «Вилка запчастей эконом / стандарт / премиум».
///
/// Для запчастей дороже 200 000 сум ценовую категорию выбирает клиент, а не мастер.
/// Это защита от спора «мне поставили дешёвку» и от навязывания дорогого.
class SpareTierScreen extends StatefulWidget {
  const SpareTierScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<SpareTierScreen> createState() => _SpareTierScreenState();
}

class _SpareTierScreenState extends State<SpareTierScreen> {
  final _partCtrl = TextEditingController();
  final _tiers = {
    'economy': (title: t('order.ekonom'), price: TextEditingController(), note: TextEditingController()),
    'standard': (title: t('order.standart'), price: TextEditingController(), note: TextEditingController()),
    'premium': (title: t('order.premium'), price: TextEditingController(), note: TextEditingController()),
  };
  String _mode = 'catalog';
  bool _busy = false;
  List<Map<String, dynamic>> _sent = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _partCtrl.dispose();
    for (final tier in _tiers.values) {
      tier.price.dispose();
      tier.note.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.spareTiers(widget.order.id);
      if (!mounted) return;
      setState(() => _sent = ((r['items'] as List?) ?? const []).cast<Map<String, dynamic>>());
    } on ApiError {
      // офлайн — покажем только форму
    }
  }

  int _filled() => _tiers.values.where((tier) => (int.tryParse(tier.price.text.trim()) ?? 0) > 0).length;

  Future<void> _send() async {
    setState(() => _busy = true);
    final variants = _tiers.entries
        .where((e) => (int.tryParse(e.value.price.text.trim()) ?? 0) > 0)
        .map(
          (e) => {
            'tier': e.key,
            'title': e.value.title,
            'amountSoums': int.parse(e.value.price.text.trim()),
            'note': e.value.note.text.trim(),
          },
        )
        .toList();
    final body = {'partName': _partCtrl.text.trim(), 'mode': _mode, 'variants': variants};
    try {
      await session.api.sendSpareTiers(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('order.otpravlenoKlientuJdemVybor'));
      await _load();
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'spare_tiers',
          payload: body,
          title: t('order.vilkaZapchasti', {'p1': widget.order.number}),
        );
        if (mounted) showOk(context, t('work.netSetiUydetPri2'));
      } else if (mounted) {
        showError(context, e.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('order.vilkaZapchasti2')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('order.zapchastDoroje200000'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s16),
          TextField(
            controller: _partCtrl,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: t('order.kakayaDetal'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'catalog', label: Text(t('order.izKataloga'))),
              ButtonSegment(value: 'photo', label: Text(t('order.fotoCennikov'))),
            ],
            selected: {_mode},
            onSelectionChanged: (s) => setState(() => _mode = s.first),
          ),
          const SizedBox(height: SozoSpace.s16),
          for (final e in _tiers.entries) ...[
            SozoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(e.value.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  const SizedBox(height: SozoSpace.s8),
                  TextField(
                    controller: e.value.price,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(labelText: t('order.cenaSum'), isDense: true),
                  ),
                  TextField(
                    controller: e.value.note,
                    decoration: InputDecoration(labelText: t('order.chemOtlichaetsyaResursGarantiy'), isDense: true),
                  ),
                ],
              ),
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
          const SizedBox(height: SozoSpace.s8),
          PrimaryButton(
            label: t('order.otpravitKlientu'),
            busy: _busy,
            onPressed: _partCtrl.text.trim().isNotEmpty && _filled() >= 2 ? _send : null,
          ),
          if (_filled() < 2)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s8),
              child: Text(
                t('order.nujnoMinimumDvaVarianta'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ),
          if (_sent.isNotEmpty) ...[
            const SizedBox(height: SozoSpace.s24),
            SectionTitle(t('order.otpravlennye')),
            ..._sent.map((s) {
              final chosen = s['chosenTier'] as String?;
              return SozoCard(
                child: Row(
                  children: [
                    FigmaIcon(
                      chosen != null ? 'check-done' : 'hourglass',
                      color: chosen != null ? SozoColors.success : SozoColors.textSecondary,
                      size: 18,
                    ),
                    const SizedBox(width: SozoSpace.s8),
                    Expanded(child: Text(s['partName'].toString())),
                    Text(
                      chosen != null ? t('order.vybran', {'p1': chosen}) : t('order.klientVybiraet'),
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                    ),
                  ],
                ),
              );
            }),
          ],
          const SizedBox(height: SozoSpace.s16),
          BlockerNote(icon: 'calendar', text: t('order.netOtveta30Min')),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// M-20 «Рекомендовать» — апсейл «заодно».
/// НЕ доп-смета: конвейер не блокирует, не эскалируется, на рейтинг не влияет.
class RecommendScreen extends StatefulWidget {
  const RecommendScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<RecommendScreen> createState() => _RecommendScreenState();
}

class _RecommendScreenState extends State<RecommendScreen> {
  final Map<String, int> _picked = {};
  final _commentCtrl = TextEditingController();
  String? _photo;
  bool _busy = false;
  Map<String, dynamic>? _stats;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadStats() async {
    try {
      final r = await session.api.recommendations();
      if (mounted) setState(() => _stats = r['stats'] as Map<String, dynamic>?);
    } on ApiError {
      // не критично — экран работает и без статистики
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final body = {
      'lines': _picked.entries.map((e) => {'priceItemId': e.key, 'qty': e.value}).toList(),
      'comment': _commentCtrl.text.trim(),
      'photoDataUrl': _photo,
    };
    try {
      await session.api.recommend(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('order.rekomendaciyaOtpravlenaKonveye'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'recommendation',
          payload: body,
          title: t('order.rekomendaciya', {'p1': widget.order.number}),
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
    final total = _picked.entries.fold<int>(0, (s, e) {
      final item = session.catalog.where((i) => i.id == e.key).firstOrNull;
      return s + (item?.priceFromTiyin ?? 0) * e.value;
    });
    return Scaffold(
      appBar: SozoAppBar(title: t('order.rekomendovat')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('order.zametiliChtoStoitSdelat'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
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
                Expanded(child: Text(t('order.fotoPomogaetKlientuPonyat'))),
                TextButton(
                  onPressed: () => showPhotoCapture(
                    context,
                    title: t('branch.foto'),
                    stage: 'during',
                    alreadyTaken: _photo != null ? 1 : 0,
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
          SectionTitle(t('order.chtoRekomenduete')),
          if (_picked.isEmpty)
            Text(t('order.poziciiNeVybrany'), style: TextStyle(color: SozoColors.textSecondary))
          else
            ..._picked.entries.map((e) {
              final item = session.catalog.where((i) => i.id == e.key).firstOrNull;
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(item?.name ?? '—', style: const TextStyle(fontSize: 14)),
                trailing: Text(formatSoums((item?.priceFromTiyin ?? 0) * e.value)),
              );
            }),
          SecondaryButton(
            label: _picked.isEmpty ? t('order.dobavitPozicii') : t('common.izmenit'),
            onPressed: () async {
              final r = await Navigator.of(
                context,
              ).push<Map<String, int>>(MaterialPageRoute(builder: (_) => _SimplePicker(picked: Map.of(_picked))));
              if (r != null) {
                setState(() {
                  _picked
                    ..clear()
                    ..addAll(r);
                });
              }
            },
          ),
          const SizedBox(height: SozoSpace.s16),
          TextField(
            controller: _commentCtrl,
            maxLines: 2,
            decoration: InputDecoration(
              labelText: t('branch.kommentariyPoJelaniyu'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          if (total > 0) ...[
            const SizedBox(height: SozoSpace.s16),
            Row(
              children: [
                Text(t('order.summaRekomendacii'), style: TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
                const Spacer(),
                Money(formatSoums(total), size: 16),
              ],
            ),
          ],
          const SizedBox(height: SozoSpace.s16),
          Text(
            t('order.rabotaPoNeprinyatoyRekomendaci'),
            style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(
            label: t('order.otpravitRekomendaciyu'),
            busy: _busy,
            onPressed: _picked.isEmpty ? null : _send,
          ),
          if (_stats != null) ...[
            const SizedBox(height: SozoSpace.s24),
            SozoCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionTitle(t('order.vashiRekomendacii')),
                  Text(
                    t('order.prinyatoVyruchka', {
                      'p1': _stats!['conversionPercent'],
                      'p2': formatSoums((_stats!['revenueTiyin'] as num?)?.toInt() ?? 0),
                    }),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: SozoSpace.s4),
                  Text(t('order.naReytingNeVliyaet'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                ],
              ),
            ),
          ],
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

class _SimplePicker extends StatefulWidget {
  const _SimplePicker({required this.picked});

  final Map<String, int> picked;

  @override
  State<_SimplePicker> createState() => _SimplePickerState();
}

class _SimplePickerState extends State<_SimplePicker> {
  late final Map<String, int> _picked = widget.picked;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final items = _q.isEmpty
        ? session.catalog
        : session.catalog.where((i) => i.name.toLowerCase().contains(_q.toLowerCase())).toList();
    return Scaffold(
      appBar: SozoAppBar(title: t('order.poziciiPraysa')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(SozoSpace.s16),
            child: TextField(
              onChanged: (v) => setState(() => _q = v),
              decoration: InputDecoration(
                hintText: t('order.poisk'),
                prefixIcon: const FigmaIcon('search', size: 20),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final item = items[i];
                final qty = _picked[item.id] ?? 0;
                return CheckboxListTile(
                  value: qty > 0,
                  onChanged: (v) => setState(() => v == true ? _picked[item.id] = 1 : _picked.remove(item.id)),
                  title: Text(item.name, style: const TextStyle(fontSize: 15)),
                  subtitle: Text(
                    t('common.ot', {'p1': formatSoums(item.priceFromTiyin)}),
                    style: const TextStyle(fontSize: 13),
                  ),
                  activeColor: SozoColors.accent,
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

/// M-24 «Фиксация техники клиента» — сервисный след.
/// Гейт условный: для категорий без оборудования шаг закрывается одним тапом,
/// потому что запись «Смеситель, -, -» хуже отсутствия записи.
class AssetScreen extends StatefulWidget {
  const AssetScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<AssetScreen> createState() => _AssetScreenState();
}

class _AssetScreenState extends State<AssetScreen> {
  Map<String, dynamic>? _data;
  final _brandCtrl = TextEditingController();
  final _modelCtrl = TextEditingController();
  String _type = 'кондиционер';
  String? _photo;
  bool _unreadable = false;
  bool _busy = false;
  List<String> _types = const ['кондиционер', 'котёл', 'бойлер', 'стиральная машина', 'смеситель', 'другое'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _brandCtrl.dispose();
    _modelCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.assets(widget.order.id);
      final d = await session.api.dictionaries();
      if (!mounted) return;
      setState(() {
        _data = r;
        _types = ((d['assetTypes'] as List?) ?? _types).map((e) => e.toString()).toList();
        _type = _types.first;
      });
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _skip() async {
    try {
      await session.api.addAsset(widget.order.id, {'skip': true});
      if (!mounted) return;
      showOk(context, t('order.shagZakryt'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final body = {
      'type': _type,
      'brand': _brandCtrl.text.trim(),
      'model': _modelCtrl.text.trim(),
      'photoDataUrl': _photo,
      'plateUnreadable': _unreadable,
    };
    try {
      await session.api.addAsset(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('order.tehnikaZafiksirovanaPovtornyeZ'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'asset',
          payload: body,
          title: t('order.tehnika', {'p1': widget.order.number}),
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
    final required = _data?['requiresAsset'] == true;
    final known = ((_data?['known'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: SozoAppBar(title: t('order.tehnikaKlienta')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s16),
              children: [
                if (!required) ...[
                  Text(
                    _data!['hint']?.toString() ?? t('order.dlyaEtoyKategoriiTehnika'),
                    style: const TextStyle(fontSize: 13, height: 18 / 13, color: SozoColors.textSecondary),
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  OutlineIconButton(icon: 'check-16', label: t('order.tehnikiNetZakrytShag'), onPressed: _skip),
                  const SizedBox(height: SozoSpace.s12),
                  Text(
                    t('order.zapisSmesitelHujeOtsutstviya'),
                    style: TextStyle(fontSize: 11, color: SozoColors.textSecondary),
                  ),
                  const SizedBox(height: SozoSpace.s16),
                ] else ...[
                  Text(
                    _data!['hint']?.toString() ?? '',
                    style: const TextStyle(fontSize: 13, height: 18 / 13, color: SozoColors.textSecondary),
                  ),
                  const SizedBox(height: SozoSpace.s16),
                ],
                if (known.isNotEmpty) ...[
                  ScreenHeading(t('order.ujeIzvestnayaTehnikaKlienta')),
                  const SizedBox(height: SozoSpace.s16),
                  ...known.map(
                    (a) => Padding(
                      padding: const EdgeInsets.only(bottom: SozoSpace.s12),
                      child: FigmaCard(
                        children: [
                          Row(
                            children: [
                              const IconBadge('crosshair'),
                              const SizedBox(width: SozoSpace.s12),
                              Expanded(
                                child: Text(
                                  '${a['type']} ${a['brand'] ?? ''} ${a['model'] ?? ''}'.trim(),
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: SozoSpace.s4),
                ],
                ScreenHeading(t('order.novayaEdinica')),
                const SizedBox(height: SozoSpace.s16),
                FigmaCard(
                  gap: SozoSpace.s16,
                  children: [
                    Wrap(
                      spacing: SozoSpace.s8,
                      runSpacing: SozoSpace.s8,
                      children: _types
                          // Значение уходит на сервер как есть, мастеру показываем перевод
                          .map(
                            (type) => ChoicePill(
                              label: tv(type),
                              selected: _type == type,
                              onTap: () => setState(() => _type = type),
                            ),
                          )
                          .toList(),
                    ),
                    const FigmaDivider(),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: SozoSpace.s4),
                      child: Row(
                        children: [
                          FigmaIcon(_photo != null ? 'check-16' : 'camera', size: 18),
                          const SizedBox(width: SozoSpace.s8),
                          Expanded(
                            child: Text(
                              _unreadable ? t('order.fotoObschegoVida') : t('order.fotoShildika'),
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                            ),
                          ),
                          SmallChipButton(
                            label: t('common.snyat'),
                            onTap: () => showPhotoCapture(
                              context,
                              title: _unreadable ? t('order.obschiyVidTehniki') : t('order.shildik'),
                              stage: 'during',
                              alreadyTaken: _photo != null ? 1 : 0,
                              hint: t('order.modelIGodDozapolnit'),
                              onUpload: (dataUrl) async {
                                setState(() => _photo = dataUrl);
                                return true;
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
                    CheckboxRow(
                      label: t('order.shildikOtsutstvuetIliNechitaem'),
                      value: _unreadable,
                      onChanged: (v) => setState(() => _unreadable = v),
                    ),
                    Column(
                      children: [
                        TextField(
                          controller: _brandCtrl,
                          decoration: InputDecoration(hintText: t('order.brendPoJelaniyu'), isDense: true),
                        ),
                        const SizedBox(height: SozoSpace.s12),
                        TextField(
                          controller: _modelCtrl,
                          decoration: InputDecoration(hintText: t('order.modelPoJelaniyu'), isDense: true),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
      bottomNavigationBar: _data == null
          ? null
          : StickyFooter(
              child: PrimaryButton(label: t('order.sohranit'), busy: _busy, onPressed: _photo != null ? _save : null),
            ),
    );
  }
}

/// M-23 «Список закупки клиенту» — клиент покупает сам, мастер свободен
class ShoppingListScreen extends StatefulWidget {
  const ShoppingListScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<ShoppingListScreen> createState() => _ShoppingListScreenState();
}

class _ShoppingListScreenState extends State<ShoppingListScreen> {
  final List<({TextEditingController name, TextEditingController qty, TextEditingController price})> _rows = [];
  DateTime? _revisit;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _add();
  }

  void _add() => setState(
    () => _rows.add((
      name: TextEditingController(),
      qty: TextEditingController(text: '1'),
      price: TextEditingController(),
    )),
  );

  @override
  void dispose() {
    for (final r in _rows) {
      r.name.dispose();
      r.qty.dispose();
      r.price.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final body = {
      'items': _rows
          .where((r) => r.name.text.trim().isNotEmpty)
          .map(
            (r) => {
              'name': r.name.text.trim(),
              'qty': int.tryParse(r.qty.text.trim()) ?? 1,
              'approxSoums': int.tryParse(r.price.text.trim()) ?? 0,
            },
          )
          .toList(),
      'revisitAt': _revisit?.toUtc().toIso8601String(),
    };
    try {
      await session.api.shoppingList(widget.order.id, body);
      if (!mounted) return;
      showOk(context, t('order.spisokUKlientaVy'));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (e.isOffline) {
        await session.outbox.enqueue(
          orderId: widget.order.id,
          kind: 'shopping_list',
          payload: body,
          title: t('order.spisokZakupki', {'p1': widget.order.number}),
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
    final ready = _rows.any((r) => r.name.text.trim().isNotEmpty);
    return Scaffold(
      appBar: SozoAppBar(title: t('order.spisokZakupki2')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('order.klientPokupaetMaterialySam'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s16),
          ..._rows.asMap().entries.map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SozoCard(
                child: Column(
                  children: [
                    TextField(
                      controller: e.value.name,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(labelText: t('order.chtoKupit'), isDense: true),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: e.value.qty,
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(labelText: t('order.kolVo'), isDense: true),
                          ),
                        ),
                        const SizedBox(width: SozoSpace.s12),
                        Expanded(
                          flex: 2,
                          child: TextField(
                            controller: e.value.price,
                            keyboardType: TextInputType.number,
                            decoration: InputDecoration(labelText: t('order.orientirCenySum'), isDense: true),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          SecondaryButton(label: t('order.dobavitStroku'), onPressed: _add),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            onTap: () async {
              final d = await showDatePicker(
                context: context,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 60)),
                initialDate: DateTime.now().add(const Duration(days: 3)),
              );
              if (d != null) setState(() => _revisit = d);
            },
            child: Row(
              children: [
                const FigmaIcon('calendar', size: 20, color: SozoColors.textSecondary),
                const SizedBox(width: SozoSpace.s12),
                Expanded(
                  child: Text(
                    _revisit == null
                        ? t('order.dataPovtornogoVizita')
                        : t('order.vernus', {'p1': _revisit!.day, 'p2': _revisit!.month}),
                  ),
                ),
                const FigmaIcon('chevron-right', size: 16, color: SozoColors.textSecondary),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          Text(t('order.povtornoeFotoDoPri'), style: TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
          const SizedBox(height: SozoSpace.s24),
          PrimaryButton(label: t('order.otpravitKlientu'), busy: _busy, onPressed: ready ? _send : null),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}
