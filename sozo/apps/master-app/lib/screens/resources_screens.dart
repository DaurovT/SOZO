import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_icon.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/photo_capture.dart';
import '../i18n.dart';

/// M-36 «Сумка / MasterStock» — расходники, которые мастер возит с собой.
///
/// Пополняется только по чеку: зачисление идёт по себестоимости из него,
/// иначе возмещение превращается в честное слово. Списание в заявку — автоматом.
class StockScreen extends StatefulWidget {
  const StockScreen({super.key});

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.stock();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _refill() async {
    final catalog = ((_data?['catalog'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final picked = <String, int>{};
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Ручка листа: подсказывает, что панель тянется, а не приклеена
            Padding(
              padding: const EdgeInsets.only(top: 10, bottom: 6),
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: SozoColors.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  t('res.chtoKupili'),
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  for (final c in catalog) ...[
                    _refillRow(
                      name: c['name'].toString(),
                      price: t('res.za', {'p1': formatSoums(tiyinOf(c['costTiyin'])), 'p2': c['unit']}),
                      qty: picked[c['id']] ?? 0,
                      onMinus: () => setLocal(() {
                        final q = picked[c['id']] ?? 0;
                        if (q <= 1) {
                          picked.remove(c['id']);
                        } else {
                          picked[c['id'].toString()] = q - 1;
                        }
                      }),
                      onPlus: () => setLocal(() => picked[c['id'].toString()] = (picked[c['id']] ?? 0) + 1),
                    ),
                    const SizedBox(height: SozoSpace.s16),
                  ],
                ],
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: SozoColors.border)),
              ),
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, 20, SozoSpace.s16, SozoSpace.s8),
              child: SafeArea(
                top: false,
                child: DarkButton(
                  label: t('res.snyatChekIZachislit'),
                  onPressed: picked.isEmpty ? null : () => Navigator.of(ctx).pop(true),
                ),
              ),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;

    String? receipt;
    await showPhotoCapture(
      context,
      title: t('res.chekNaRashodniki'),
      stage: 'receipt',
      alreadyTaken: 0,
      hint: t('res.zachislenieIdetPoSebestoimosti'),
      onUpload: (dataUrl) async {
        receipt = dataUrl;
        return true;
      },
    );
    if (receipt == null || !mounted) return;
    try {
      final r = await session.api.refillStock({
        'items': picked.entries.map((e) => {'catalogId': e.key, 'qty': e.value}).toList(),
        'receiptDataUrl': receipt,
      });
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('res.zachisleno')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = ((_data?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final belowMin = (_data?['belowMin'] as num?)?.toInt() ?? 0;
    return Scaffold(
      appBar: SozoAppBar(title: t('res.sumka')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s16),
              children: [
                if (belowMin > 0) ...[
                  WarningBanner(t('res.nijeNormativaPoziciyPopolnite', {'p1': belowMin})),
                  const SizedBox(height: SozoSpace.s12),
                ],
                if (items.isEmpty)
                  EmptyView(title: _data!['empty']?.toString() ?? t('res.sumkaPusta'), icon: 'toolbox')
                else
                  ...items.map(
                    (i) => Padding(
                      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                      child: _stockRow(i),
                    ),
                  ),
                const SizedBox(height: SozoSpace.s8),
                Text(
                  _data!['note']?.toString() ?? '',
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4),
                ),
              ],
            ),
      bottomNavigationBar: _data == null
          ? null
          : StickyFooter(
              child: DarkButton(label: t('res.popolnitChekom'), onPressed: _refill),
            ),
    );
  }

  /// Позиция сумки (макет 53:639): значок состояния, норматив и остаток
  Widget _stockRow(Map<String, dynamic> i) {
    final low = i['belowMin'] == true;
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            height: 24,
            child: Center(child: FigmaIcon(low ? 'alert-triangle' : 'check-square', size: 20)),
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  i['name'].toString(),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                ),
                const SizedBox(height: 2),
                Text(
                  t('res.normativ', {'p1': i['minStock'], 'p2': i['unit']}),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          Text(
            '${i['qty']} ${i['unit']}',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
          ),
        ],
      ),
    );
  }

  /// Строка счётчика в листе пополнения (макет 53:552)
  Widget _refillRow({
    required String name,
    required String price,
    required int qty,
    required VoidCallback onMinus,
    required VoidCallback onPlus,
  }) {
    Widget btn(String sign, VoidCallback onTap, {required bool plus}) => Material(
      color: plus ? softWarnBg : SozoColors.bg,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: plus ? bannerBorder : SozoColors.border),
          ),
          child: Text(
            sign,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: plus ? SozoColors.text : SozoColors.textSecondary,
            ),
          ),
        ),
      ),
    );

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
              const SizedBox(height: 2),
              Text(price, style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
            ],
          ),
        ),
        const SizedBox(width: SozoSpace.s12),
        btn('−', onMinus, plus: false),
        const SizedBox(width: 14),
        Text(
          '$qty',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
        ),
        const SizedBox(width: 14),
        btn('+', onPlus, plus: true),
      ],
    );
  }
}

/// M-22 «Код закупки» — покупка в долг компании, без денег мастера.
/// Код живёт 4 часа и покрывает бюджет заявки с запасом 10%.
class PurchaseCodeScreen extends StatefulWidget {
  const PurchaseCodeScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<PurchaseCodeScreen> createState() => _PurchaseCodeScreenState();
}

class _PurchaseCodeScreenState extends State<PurchaseCodeScreen> {
  Map<String, dynamic>? _data;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.purchaseCodes(widget.order.id);
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
      if (mounted) setState(() => _data = const {});
    }
  }

  Future<void> _generate() async {
    setState(() => _busy = true);
    try {
      await session.api.issuePurchaseCode(widget.order.id);
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.isOffline ? t('res.dlyaGeneraciiKodaNujna') : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _invoice(String codeId) async {
    final nameCtrl = TextEditingController();
    final sumCtrl = TextEditingController();
    String? tier;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(t('res.poziciyaNakladnoy')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: InputDecoration(labelText: t('order.naimenovanie')),
              ),
              TextField(
                controller: sumCtrl,
                keyboardType: TextInputType.number,
                inputFormatters: [ThousandsFormatter()],
                onChanged: (_) => setLocal(() {}),
                decoration: InputDecoration(labelText: t('common.summaSum')),
              ),
              if (soumsOf(sumCtrl.text) > 200000) ...[
                const SizedBox(height: SozoSpace.s8),
                Text(t('res.doroje200000Ukajite'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'economy', label: Text(t('order.ekonom'))),
                    ButtonSegment(value: 'standard', label: Text(t('order.standart'))),
                    ButtonSegment(value: 'premium', label: Text(t('order.premium'))),
                  ],
                  selected: tier == null ? <String>{} : {tier!},
                  emptySelectionAllowed: true,
                  onSelectionChanged: (s) => setLocal(() => tier = s.isEmpty ? null : s.first),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('order.dalee'))),
          ],
        ),
      ),
    );
    nameCtrl.dispose();
    sumCtrl.dispose();
    if (ok != true || !mounted) return;

    String? photo;
    await showPhotoCapture(
      context,
      title: t('res.nakladnaya'),
      stage: 'receipt',
      alreadyTaken: 0,
      hint: t('res.dispetcherSveritNakladnuyuSo'),
      onUpload: (dataUrl) async {
        photo = dataUrl;
        return true;
      },
    );
    if (photo == null || !mounted) return;
    try {
      final r = await session.api.attachInvoice(widget.order.id, codeId, {
        'dataUrl': photo,
        'items': [
          {'name': nameCtrl.text.trim(), 'amountSoums': soumsOf(sumCtrl.text), 'priceTier': tier},
        ],
      });
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('res.zafiksirovano')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = ((_data?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final active = items.where((c) => c['status'] == 'active').toList();
    final stores = ((_data?['stores'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final budget = (_data?['budgetTiyin'] as num?)?.toInt() ?? 0;

    return Scaffold(
      appBar: SozoAppBar(title: t('order.kodZakupki')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, 40),
        children: [
          if (active.isEmpty) ...[
            Text(
              _data?['note']?.toString() ?? t('res.zakupkaVDolgKompanii'),
              style: const TextStyle(fontSize: 13, height: 18 / 13, color: SozoColors.textSecondary),
            ),
            const SizedBox(height: SozoSpace.s12),
            PrimaryButton(label: t('res.sgenerirovatKod'), busy: _busy, onPressed: budget > 0 ? _generate : null),
          ] else
            ...active.map(
              (c) => Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                child: _codeCard(c),
              ),
            ),
          if (budget <= 0)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s12),
              child: BlockerNote(icon: 'alert-triangle', danger: true, text: t('res.limitZakupkiPoZayavke')),
            ),
          const SizedBox(height: 20),
          Text(
            t('res.partnerskieMagazinyRyadom'),
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: SozoColors.text),
          ),
          const SizedBox(height: 20),
          ...stores.map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s12),
              child: _storeCard(s),
            ),
          ),
        ],
      ),
    );
  }

  /// Карточка кода (макет 43:20): янтарная рамка 2, QR 180, код 36 в разрядку
  Widget _codeCard(Map<String, dynamic> c) {
    final code = c['code'].toString();
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        border: Border.all(color: SozoColors.accent, width: 2),
      ),
      child: Column(
        children: [
          Container(
            width: 180,
            height: 180,
            padding: const EdgeInsets.all(SozoSpace.s12),
            decoration: BoxDecoration(
              color: SozoColors.surface,
              borderRadius: BorderRadius.circular(SozoRadius.tile),
              border: Border.all(color: SozoColors.chipGrey),
            ),
            child: QrImageView(data: code, backgroundColor: SozoColors.surface),
          ),
          const SizedBox(height: 20),
          // Цифры в разрядку: продавец диктует код по одной, слипшиеся легко перепутать
          Text(
            code.split('').join(' '),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 36,
              fontWeight: FontWeight.w700,
              color: SozoColors.text,
              fontFeatures: moneyFeatures,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 20),
          Text(
            t('res.limitDeystvuetDo', {'p1': formatSoums(tiyinOf(c['limitTiyin'])), 'p2': hhmm(c['expiresAt'])}),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: 20),
          OutlineIconButton(
            icon: 'clipboard',
            label: t('res.zafiksirovatNakladnuyu'),
            onPressed: () => _invoice(c['id'].toString()),
            amber: false,
          ),
        ],
      ),
    );
  }

  /// Карточка магазина (макет 43:31)
  Widget _storeCard(Map<String, dynamic> s) {
    final categories = ((s['categories'] as List?) ?? const []).map((e) => e.toString()).toList();
    return OutlinedCard(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                s['name'].toString(),
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
              ),
            ),
            const FigmaIcon('arrow-up-right', size: 18),
          ],
        ),
        Row(
          children: [
            const FigmaIcon('map-pin', size: 14),
            const SizedBox(width: SozoSpace.s4),
            Expanded(
              child: Text(
                s['address'].toString(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
              ),
            ),
          ],
        ),
        if (categories.isNotEmpty) Wrap(spacing: 6, runSpacing: 6, children: categories.map(TagChip.new).toList()),
      ],
    );
  }
}

/// M-37/M-38 «Оборудование и акты». Акт — это то, чем мастер докажет,
/// что вернул целым, а компания — что выдала целым. Поэтому четыре ракурса обязательны.
class EquipmentFullScreen extends StatefulWidget {
  const EquipmentFullScreen({super.key});

  @override
  State<EquipmentFullScreen> createState() => _EquipmentFullScreenState();
}

class _EquipmentFullScreenState extends State<EquipmentFullScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.equipmentFull();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _act(Map<String, dynamic> eq, String kind) async {
    final angles = ((_data?['angles'] as List?) ?? [t('res.speredi'), t('res.szadi'), t('res.sleva'), t('res.sprava')])
        .map((e) => e.toString())
        .toList();
    final completeness = ((eq['completeness'] as List?) ?? [t('res.osnovnoyBlok')]).map((e) => e.toString()).toList();
    final photos = <String>[];

    for (final angle in angles) {
      if (!mounted) return;
      var captured = false;
      await showPhotoCapture(
        context,
        title: t('res.rakursIz', {'p1': angles.indexOf(angle) + 1, 'p2': angles.length, 'p3': angle}),
        stage: 'before',
        alreadyTaken: photos.length,
        hint: t('res.snimiteEdinicuSEtoy'),
        onUpload: (dataUrl) async {
          photos.add(dataUrl);
          captured = true;
          return true;
        },
      );
      if (!captured) return; // прервал на середине — акт не оформляем
    }

    if (!mounted) return;
    final checked = <String, bool>{for (final c in completeness) c: true};
    final noteCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(t('res.komplektnost')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ...completeness.map(
                (c) => CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: checked[c],
                  onChanged: (v) => setLocal(() => checked[c] = v ?? false),
                  title: Text(c, style: const TextStyle(fontSize: 14)),
                  activeColor: SozoColors.accent,
                ),
              ),
              if (checked.values.any((v) => !v)) ...[
                const SizedBox(height: SozoSpace.s8),
                TextField(
                  controller: noteCtrl,
                  decoration: InputDecoration(labelText: t('res.rashojdenieObyazatelno')),
                ),
                Text(
                  t('res.budetRazborSKladovschikom'),
                  style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('res.oformit'))),
          ],
        ),
      ),
    );
    noteCtrl.dispose();
    if (ok != true || !mounted) return;

    try {
      final act = await session.api.equipmentAct(eq['id'].toString(), {
        'kind': kind,
        'photos': photos,
        'completeness': checked.entries.map((e) => {'item': e.key, 'ok': e.value}).toList(),
        'discrepancy': noteCtrl.text.trim(),
      });
      if (!mounted) return;
      final code = await _askCode(act['devConfirmCode']?.toString());
      if (code == null || !mounted) return;
      final r = await session.api.confirmAct(act['id'].toString(), code);
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('res.aktOformlen')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.isOffline ? t('res.kodPodtverjdeniyaTrebuetSeti') : e.message);
    }
  }

  Future<String?> _askCode(String? devHint) async {
    final ctrl = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t('res.kodPodtverjdeniya')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: ctrl,
                keyboardType: TextInputType.number,
                maxLength: 4,
                autofocus: true,
                decoration: InputDecoration(hintText: t('res.nCifryOtKladovschika')),
              ),
              if (devHint != null)
                Text(
                  t('res.testovyyKonturKod', {'p1': devHint}),
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: Text(t('prof.podtverdit'))),
          ],
        ),
      );
    } finally {
      ctrl.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = ((_data?['items'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final available = ((_data?['available'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final acts = ((_data?['acts'] as List?) ?? const []).cast<Map<String, dynamic>>();

    return Scaffold(
      appBar: SozoAppBar(title: t('common.moeOborudovanie')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                SectionTitle(t('res.vydanoVam')),
                if (mine.isEmpty)
                  EmptyView(title: _data!['empty']?.toString() ?? t('prof.oborudovanieNeVydano'), icon: 'toolbox')
                else
                  ...mine.map(
                    (e) => Padding(
                      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                      child: SozoCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        e['name'].toString(),
                                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                                      ),
                                      Text(
                                        t('res.inv', {'p1': e['inventoryNo']}),
                                        style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                                      ),
                                    ],
                                  ),
                                ),
                                StatusChip(
                                  label: e['status'] == 'repair' ? t('res.vRemonte') : t('res.vydanoVam'),
                                  status: e['status'] == 'repair' ? 'new' : 'assigned',
                                ),
                              ],
                            ),
                            const SizedBox(height: SozoSpace.s8),
                            SecondaryButton(label: t('res.oformitVozvrat'), onPressed: () => _act(e, 'return')),
                          ],
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: SozoSpace.s16),
                SectionTitle(t('res.dostupnoKVydache')),
                if (available.isEmpty)
                  Text(t('res.svobodnogoOborudovaniyaPoVashi'), style: TextStyle(color: SozoColors.textSecondary))
                else
                  ...available.map(
                    (e) => Padding(
                      padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                      child: SozoCard(
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(e['name'].toString(), style: const TextStyle(fontSize: 15)),
                                  Text(
                                    t('res.inv', {'p1': e['inventoryNo']}),
                                    style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                                  ),
                                ],
                              ),
                            ),
                            TextButton(onPressed: () => _act(e, 'issue'), child: Text(t('res.prinyat'))),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (acts.isNotEmpty) ...[
                  const SizedBox(height: SozoSpace.s16),
                  SectionTitle(t('res.arhivAktov')),
                  ...acts.map(
                    (a) => SozoCard(
                      child: Row(
                        children: [
                          FigmaIcon(
                            a['confirmed'] == true ? 'file-text' : 'hourglass',
                            size: 18,
                            color: a['confirmed'] == true ? SozoColors.success : SozoColors.warning,
                          ),
                          const SizedBox(width: SozoSpace.s8),
                          Expanded(
                            child: Text(
                              t('res.x', {
                                'p1': a['kind'] == 'issue' ? t('res.vydacha') : t('res.vozvrat'),
                                'p2': ymd(a['at']),
                              }),
                              style: const TextStyle(fontSize: 14),
                            ),
                          ),
                          if (a['discrepancy'] != null && a['discrepancy'].toString().isNotEmpty)
                            StatusChip(label: t('res.rashojdenie'), status: 'dispute'),
                        ],
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: SozoSpace.s16),
                Text(
                  _data!['note']?.toString() ?? '',
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4),
                ),
                const SizedBox(height: SozoSpace.s32),
              ],
            ),
    );
  }
}

/// F-54 «Рейтинг» с разбивкой по пяти компонентам и F-50 апелляция.
/// Мастер видит не «69 баллов», а из чего они сложились и что подтянуть.
class RatingScreen extends StatefulWidget {
  const RatingScreen({super.key});

  @override
  State<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends State<RatingScreen> {
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.ratingBreakdown();
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _appeal(String subject, String reference) async {
    // Контроллеры диалогов освобождаем сразу после закрытия: экран ресурсов
    // открывают десятки раз за смену, и каждый оставлял за собой объект
    final ctrl = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('res.apellyaciya')),
        content: TextField(
          controller: ctrl,
          maxLines: 4,
          autofocus: true,
          decoration: InputDecoration(labelText: t('res.sChemNeSoglasny')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: Text(t('common.otpravit'))),
        ],
      ),
    );
    ctrl.dispose();
    if (text == null || text.isEmpty || !mounted) return;
    try {
      final r = await session.api.fileAppeal({'subject': subject, 'reference': reference, 'text': text});
      if (!mounted) return;
      showOk(context, (r['message'] ?? t('common.otpravleno')).toString());
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final components = ((d?['components'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final appeals = ((d?['appeals'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final upsell = d?['upsell'] as Map<String, dynamic>?;

    return Scaffold(
      appBar: SozoAppBar(title: t('res.reyting')),
      body: d == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
              children: [
                // Балл крупно: мастер приходит сюда за одним числом
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(SozoSpace.s24),
                  decoration: BoxDecoration(
                    color: SozoColors.surface,
                    borderRadius: BorderRadius.circular(SozoRadius.card),
                    border: Border.all(color: SozoColors.accent, width: 1.5),
                  ),
                  child: Column(
                    children: [
                      Text(
                        '${d['score']}',
                        style: const TextStyle(
                          fontSize: 64,
                          fontWeight: FontWeight.w800,
                          color: SozoColors.accent,
                          height: 1.1,
                        ),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                      Text(switch (d['grade']) {
                        'gold' => t('res.zoloto'),
                        'silver' => t('res.serebro'),
                        _ => t('res.bronza'),
                      }, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text)),
                      const SizedBox(height: SozoSpace.s8),
                      Text(
                        t('res.vashaDolyaOknoDney', {'p1': tiyinOf(d['sharePermille']) / 10, 'p2': d['windowDays']}),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                if (d['nextGrade'] != null) ...[
                  const SizedBox(height: SozoSpace.s16),
                  _growthBanner(d['nextGrade'].toString()),
                ],
                if (d['note'] != null) ...[
                  const SizedBox(height: SozoSpace.s16),
                  Text(d['note'].toString(), style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                ],
                const SizedBox(height: SozoSpace.s16),
                ScreenHeading(t('res.izChegoSkladyvaetsya')),
                const SizedBox(height: SozoSpace.s16),
                ...components.map(
                  (c) => Padding(
                    padding: const EdgeInsets.only(bottom: SozoSpace.s16),
                    child: _metricCard(c),
                  ),
                ),
                if ((d['penalty'] as num?) != null && (d['penalty'] as num) > 0) ...[
                  BlockerNote(
                    text: t('res.podtverjdennyeJalobyBallov', {'p1': d['penalty']}),
                    icon: 'alert-triangle',
                    danger: true,
                  ),
                  const SizedBox(height: SozoSpace.s16),
                ],
                if (upsell != null) ...[
                  FigmaCard(
                    gap: SozoSpace.s8,
                    children: [
                      Text(
                        t('res.rekomendacii'),
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SozoColors.textSecondary),
                      ),
                      Text(
                        t('order.prinyatoVyruchka', {
                          'p1': upsell['conversionPercent'],
                          'p2': formatSoums((upsell['revenueTiyin'] as num?)?.toInt() ?? 0),
                        }),
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                      ),
                      Text(
                        t('order.naReytingNeVliyaet'),
                        style: TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),
                ],
                OutlineIconButton(
                  icon: 'megaphone',
                  label: t('res.neSoglasnySReytingom'),
                  amber: false,
                  onPressed: () => _appeal('rating', ''),
                ),
                if (appeals.isNotEmpty) ...[
                  const SizedBox(height: SozoSpace.s16),
                  SectionTitle(t('res.moiApellyacii')),
                  ...appeals.map(
                    (a) => SozoCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(switch (a['subject']) {
                                  'deduction' => t('res.uderjanie'),
                                  'sanction' => t('res.sankciya'),
                                  'complaint' => t('res.jaloba'),
                                  _ => t('res.reyting'),
                                }, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                              ),
                              StatusChip(
                                label: switch (a['status']) {
                                  'accepted' => t('res.prinyata'),
                                  'rejected' => t('res.otklonena'),
                                  _ => t('prof.naRassmotrenii'),
                                },
                                status: switch (a['status']) {
                                  'accepted' => 'closed',
                                  'rejected' => 'dispute',
                                  _ => 'new',
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: SozoSpace.s4),
                          Text(a['text'].toString(), style: const TextStyle(fontSize: 13, height: 1.35)),
                          if (a['resolution'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: SozoSpace.s4),
                              child: Text(
                                t('res.reshenie', {'p1': a['resolution']}),
                                style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: SozoSpace.s32),
              ],
            ),
    );
  }

  /// Полоса роста (макет 58:590): своя пара цветов — это не блокер,
  /// а подсказка «до следующего грейда столько-то»
  Widget _growthBanner(String text) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: growthBg,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: growthBorder),
      ),
      child: Row(
        children: [
          const FigmaIcon('trending-up-20', size: 20),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: SozoColors.text, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  /// Компонент рейтинга (макет 58:595): значение 18/bold и полоса 6.
  /// Ниже 70 полоса оранжевая — видно, что именно тянет балл вниз.
  Widget _metricCard(Map<String, dynamic> c) {
    final value = (c['value'] as num?)?.toDouble() ?? 0;
    final good = value >= 70;
    return FigmaCard(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                c['title'].toString(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
            ),
            Text(
              '${c['value']}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: SozoColors.text),
            ),
          ],
        ),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: (value / 100).clamp(0.0, 1.0),
            minHeight: 6,
            backgroundColor: good ? barTrackGood : barTrackWeak,
            valueColor: AlwaysStoppedAnimation(good ? softSuccessFg : barWeak),
          ),
        ),
        Text(
          t('res.vesVklad', {'p1': c['weight'], 'p2': c['contribution'], 'p3': c['formula']}),
          style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.4),
        ),
      ],
    );
  }
}

/// F-30 «Доказательство замены» — три обязательных снимка для дорогой запчасти.
/// Демонтированная деталь остаётся клиенту: это снимает половину споров о подмене.
class ReplacementProofScreen extends StatefulWidget {
  const ReplacementProofScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<ReplacementProofScreen> createState() => _ReplacementProofScreenState();
}

class _ReplacementProofScreenState extends State<ReplacementProofScreen> {
  final _nameCtrl = TextEditingController();
  final Map<String, String?> _slots = {'oldPart': null, 'newPart': null, 'installed': null};
  bool _busy = false;

  /// Геттер, а не поле: подписи зависят от выбранного языка, а поле
  /// посчиталось бы один раз и осталось на языке, который был при запуске.
  static Map<String, String> get _titles => {
    'oldPart': t('res.starayaDetal'),
    'newPart': t('res.novayaVUpakovke'),
    'installed': t('res.ustanovlennaya'),
  };

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.replacementProof(widget.order.id, {'partName': _nameCtrl.text.trim(), ..._slots});
      if (!mounted) return;
      showOk(context, (r['note'] ?? t('res.zafiksirovano')).toString());
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) {
        showError(context, e.message);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final done = _slots.values.where((v) => v != null).length;
    return Scaffold(
      appBar: SozoAppBar(title: t('order.dokazatelstvoZameny')),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          Text(
            t('res.dlyaZapchastiDoroje200'),
            style: TextStyle(fontSize: 15, height: 1.4, color: SozoColors.textSecondary),
          ),
          const SizedBox(height: SozoSpace.s16),
          TextField(
            controller: _nameCtrl,
            decoration: InputDecoration(
              labelText: t('order.kakayaDetal'),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          ..._slots.keys.map(
            (k) => Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s8),
              child: SozoCard(
                child: Row(
                  children: [
                    FigmaIcon(
                      _slots[k] != null ? 'check-done' : 'camera',
                      color: _slots[k] != null ? SozoColors.success : SozoColors.textSecondary,
                      size: 20,
                    ),
                    const SizedBox(width: SozoSpace.s12),
                    Expanded(child: Text(_titles[k]!)),
                    TextButton(
                      onPressed: () => showPhotoCapture(
                        context,
                        title: _titles[k]!,
                        stage: 'during',
                        alreadyTaken: _slots[k] != null ? 1 : 0,
                        onUpload: (dataUrl) async {
                          setState(() => _slots[k] = dataUrl);
                          return true;
                        },
                      ),
                      child: Text(t('common.snyat')),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          PrimaryButton(
            label: done == 3 ? t('common.gotovo') : t('res.snyatoIz3', {'p1': done}),
            busy: _busy,
            onPressed: done == 3 ? _submit : null,
          ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}

/// F-47 «Чек-лист осмотра» — у осмотра нет фото «после».
/// Вместо него заполненный чек-лист и дефекты, каждый со снимком.
class InspectionScreen extends StatefulWidget {
  const InspectionScreen({super.key, required this.order});

  final OrderCard order;

  @override
  State<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionScreenState extends State<InspectionScreen> {
  Map<String, dynamic>? _data;
  final Set<String> _checked = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.inspection(widget.order.id);
      if (mounted) setState(() => _data = r);
    } on ApiError catch (e) {
      if (mounted && !e.isOffline) showError(context, e.message);
    }
  }

  Future<void> _addDefect() async {
    final descCtrl = TextEditingController();
    var severity = 'medium';
    var category = 'водоснабжение';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(t('res.defekt')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: category,
                // Значение уходит в payload как есть — переводим только подпись
                items: const [
                  'водоснабжение',
                  'канализация',
                  'отопление',
                  'электрика',
                  'вентиляция',
                  'прочее',
                ].map((c) => DropdownMenuItem(value: c, child: Text(tv(c)))).toList(),
                onChanged: (v) => setLocal(() => category = v ?? category),
                decoration: InputDecoration(labelText: t('res.kategoriya')),
              ),
              const SizedBox(height: SozoSpace.s8),
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'low', label: Text(t('res.nizkiy'))),
                  ButtonSegment(value: 'medium', label: Text(t('res.sredniy'))),
                  ButtonSegment(value: 'high', label: Text(t('res.vysokiy'))),
                ],
                selected: {severity},
                onSelectionChanged: (s) => setLocal(() => severity = s.first),
              ),
              const SizedBox(height: SozoSpace.s8),
              TextField(
                controller: descCtrl,
                decoration: InputDecoration(labelText: t('res.chtoNeTak')),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('res.snyatFoto'))),
          ],
        ),
      ),
    );
    descCtrl.dispose();
    if (ok != true || !mounted) return;
    await showPhotoCapture(
      context,
      title: t('res.fotoDefekta'),
      stage: 'during',
      alreadyTaken: 0,
      hint: t('res.snimokVoydetVOtchet'),
      onUpload: (dataUrl) async {
        try {
          await session.api.addDefect(widget.order.id, {
            'category': category,
            'severity': severity,
            'description': descCtrl.text.trim(),
            'dataUrl': dataUrl,
          });
          await _load();
          return true;
        } on ApiError catch (e) {
          if (mounted) showError(context, e.message);
          return false;
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final template = ((_data?['template'] as List?) ?? const []).map((e) => e.toString()).toList();
    final defects = (_data?['defects'] as num?)?.toInt() ?? 0;
    return Scaffold(
      appBar: SozoAppBar(title: t('order.chekListOsmotra')),
      body: _data == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(SozoSpace.s16),
              children: [
                Text(
                  _data!['note']?.toString() ?? '',
                  style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.4),
                ),
                const SizedBox(height: SozoSpace.s16),
                SectionTitle(t('res.proverenoIz', {'p1': _checked.length, 'p2': template.length})),
                ...template.map(
                  (item) => CheckboxListTile(
                    value: _checked.contains(item),
                    onChanged: (v) => setState(() => v == true ? _checked.add(item) : _checked.remove(item)),
                    title: Text(item, style: const TextStyle(fontSize: 14)),
                    activeColor: SozoColors.accent,
                    dense: true,
                  ),
                ),
                const SizedBox(height: SozoSpace.s16),
                SectionTitle(t('res.defekty', {'p1': defects})),
                SecondaryButton(label: t('res.zafiksirovatDefekt'), onPressed: _addDefect),
                const SizedBox(height: SozoSpace.s16),
                if (_checked.length < template.length)
                  BlockerNote(text: t('res.otmetteVsePunktyChek'))
                else
                  BlockerNote(icon: 'check-square', text: t('res.chekListZapolnenOstalos')),
                const SizedBox(height: SozoSpace.s32),
              ],
            ),
    );
  }
}
