import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/external_actions.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';
import '../widgets/photo_capture.dart';
import '../widgets/signature_pad.dart';
import 'addwork_screen.dart';
import 'branch_screens.dart';
import 'order_extras.dart';
import 'permit_screen.dart';
import 'quote_screen.dart';
import 'resources_screens.dart';
import 'route_screen.dart';
import 'stages_helper_payment.dart';
import '../i18n.dart';

/// Карточка заявки и конвейер (экраны M-08…M-30).
///
/// Кнопки шагов приходят с сервера вместе с причиной блокировки — приложение
/// не решает само, что можно, а что нельзя. Так мастер видит ту же причину,
/// которую вернёт сервер, и не упирается в немой отказ на объекте.
class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  OrderCard? _order;
  String? _error;
  bool _busy = false;
  Map<String, dynamic>? _addwork; // ожидающая доп-смета: плашка-таймлайн

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final j = await session.api.order(widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = OrderCard.fromJson(j);
        _error = null;
      });
      _loadAddwork();
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      if (e.isOffline) session.outbox.markOnline(false);
    }
  }

  Future<void> _loadAddwork() async {
    try {
      final r = await session.api.addworkStatus(widget.orderId);
      if (mounted) setState(() => _addwork = r['pending'] as Map<String, dynamic>?);
    } on ApiError {
      // без сети таймлайн просто не показываем — конвейер он не блокирует
    }
  }

  /// Открыть ветку и перечитать карточку: любая ветка меняет состояние заявки
  Future<void> _openBranch(Widget screen) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => screen));
    if (changed == true && mounted) await _load();
  }

  Future<void> _delay(int minutes) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('order.sdvinutPlanNaMin', {'p1': minutes})),
        content: Text(t('order.klientPoluchitNovoeVremya')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('order.sdvinut'))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final r = await session.api.delay(widget.orderId, minutes);
      if (mounted) showOk(context, (r['message'] ?? t('order.planSdvinut')).toString());
    } on ApiError catch (e) {
      if (e.keepsData) {
        await session.outbox.enqueue(
          orderId: widget.orderId,
          kind: 'delay',
          payload: {'minutes': minutes},
          title: t('order.zaderjka', {'p1': _order?.number, 'p2': minutes}),
        );
        if (mounted) {
          showOk(context, t('order.netSetiKlientUvidit'));
        }
      } else if (mounted) {
        showError(context, e.message);
      }
    }
  }

  // ---------- Действия конвейера ----------

  Future<void> _act(String action, {Map<String, dynamic>? payload, String? reason}) async {
    final o = _order!;
    setState(() => _busy = true);
    final body = <String, dynamic>{'action': action, 'version': o.version, 'reason': ?reason, 'payload': ?payload};
    try {
      final j = await session.api.act(o.id, body);
      if (!mounted) return;
      setState(() => _order = OrderCard.fromJson(j));
      session.outbox.markOnline(true);
      unawaitedFlush();
    } on ApiError catch (e) {
      if (e.keepsData) {
        // Сети нет — операция не теряется, а встаёт в очередь в правильном порядке
        await session.outbox.enqueue(orderId: o.id, kind: 'action', payload: body, title: '${o.number}: $action');
        session.outbox.markOnline(false);
        if (mounted) showOk(context, queuedMessage(e));
      } else if (mounted) {
        showError(context, e.message);
        await _load();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _uploadPhoto(String stage, String dataUrl) async {
    final o = _order!;
    final body = {'stage': stage, 'dataUrl': dataUrl};
    try {
      await session.api.uploadPhoto(o.id, body);
      session.outbox.markOnline(true);
      return true;
    } on ApiError catch (e) {
      if (e.keepsData) {
        await session.outbox.enqueue(
          orderId: o.id,
          kind: 'photo',
          payload: body,
          title: t('order.foto', {'p1': o.number, 'p2': stage}),
        );
        session.outbox.markOnline(false);
        return true; // для мастера снимок сделан; отправка — забота очереди
      }
      if (mounted) showError(context, e.message);
      return false;
    }
  }

  Future<void> _capture(String stage, String title, String hint) async {
    final o = _order!;
    final done = await showPhotoCapture(
      context,
      title: title,
      stage: stage,
      alreadyTaken: o.photosOf(stage),
      hint: hint,
      onUpload: (dataUrl) => _uploadPhoto(stage, dataUrl),
    );
    if (done) await _load();
  }

  Future<void> _confirmEstimate() async {
    final o = _order!;
    final choice = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.all(SozoSpace.s16),
              child: Text(
                t('order.kakKlientSoglasovalSmetu'),
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
            ),
            ListTile(
              leading: const FigmaIcon('phone', size: 20),
              title: Text(t('order.podtverdilDispetcheruPoTelefon')),
              onTap: () => Navigator.of(ctx).pop('phone_dispatcher'),
            ),
            ListTile(
              leading: const FigmaIcon('pen', size: 20),
              title: Text(t('order.raspisalsyaZdes')),
              subtitle: Text(t('order.paketUydetSPometkoy')),
              onTap: () => Navigator.of(ctx).pop('offline_signature'),
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == 'offline_signature') {
      final sig = await captureSignature(
        context,
        title: t('order.soglasovanieSmety'),
        subtitle: t('order.itogPoprositeKlientaRaspisatsy', {'p1': formatSoums(o.totalFromTiyin)}),
        signerLabel: t('order.ktoPodpisyvaet'),
      );
      if (sig == null || !mounted) return;
    }
    await _act('confirm_estimate', payload: {'via': choice, 'amountSoums': (o.totalFromTiyin / 100).round()});
  }

  Future<void> _fixAcceptance() async {
    final o = _order!;
    final method = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.all(SozoSpace.s16),
              child: Text(t('order.kakPrinimaemRabotu'), style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            ListTile(
              leading: const FigmaIcon('keypad', size: 20),
              title: Text(t('order.kodIzPrilojeniyaKlienta')),
              onTap: () => Navigator.of(ctx).pop('code'),
            ),
            ListTile(
              leading: const FigmaIcon('pen', size: 20),
              title: Text(t('order.podpisKlientaZdes')),
              onTap: () => Navigator.of(ctx).pop('signature'),
            ),
            ListTile(
              leading: const FigmaIcon('user-x', size: 20),
              title: Text(t('order.klientaNeByloNa')),
              subtitle: Text(t('order.priemkaFiksiruetsyaFotografiya')),
              onTap: () => Navigator.of(ctx).pop('absent_with_photo'),
            ),
            const SizedBox(height: SozoSpace.s8),
          ],
        ),
      ),
    );
    if (method == null || !mounted) return;

    Map<String, dynamic> body = {'method': method};
    if (method == 'code') {
      final code = await _askCode();
      if (code == null) return;
      body['code'] = code;
    } else if (method == 'signature') {
      final sig = await captureSignature(
        context,
        title: t('order.priemkaRabot'),
        subtitle: t('order.klientPodtverjdaetChtoRaboty', {'p1': o.number}),
        signerLabel: t('order.ktoPrinimaet'),
      );
      if (sig == null) return;
      body['signatureDataUrl'] = sig.dataUrl;
      body['signerName'] = sig.signerName;
    }
    try {
      await session.api.fixAcceptance(o.id, body);
      if (mounted) showOk(context, t('order.priemkaZafiksirovana'));
      await _load();
    } on ApiError catch (e) {
      if (e.keepsData) {
        await session.outbox.enqueue(
          orderId: o.id,
          kind: 'acceptance',
          payload: body,
          title: t('order.priemka', {'p1': o.number}),
        );
        if (mounted) showOk(context, queuedMessage(e));
      } else if (mounted) {
        showError(context, e.message);
      }
    }
  }

  Future<String?> _askCode() async {
    // Контроллер живёт ровно столько, сколько диалог: без dispose каждый
    // вызов оставлял за собой висящий объект с подписчиками
    final ctrl = TextEditingController();
    try {
      return await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t('order.kodPriemki')),
          content: TextField(
            controller: ctrl,
            keyboardType: TextInputType.number,
            maxLength: 4,
            autofocus: true,
            decoration: InputDecoration(hintText: t('order.nCifryIzPrilojeniya')),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: Text(t('common.gotovo'))),
          ],
        ),
      );
    } finally {
      ctrl.dispose();
    }
  }

  /// Внести материал.
  ///
  /// Название и сумма живут в контроллерах снаружи цикла: если мастер
  /// отменил камеру, форма открывается заново с уже введённым. Раньше в
  /// этом месте всё стиралось, и на морозе приходилось набирать заново.
  Future<void> _addMaterial() async {
    final o = _order!;
    final nameCtrl = TextEditingController();
    final sumCtrl = TextEditingController();
    var kind = 'spare_part';
    try {
      while (true) {
        final done = await _materialStep(o, nameCtrl, sumCtrl, kind, (k) => kind = k);
        if (done) return;
      }
    } finally {
      nameCtrl.dispose();
      sumCtrl.dispose();
    }
  }

  /// Один проход формы. Возвращает true, когда дальше делать нечего:
  /// материал внесён либо мастер отказался от него совсем
  Future<bool> _materialStep(
    OrderCard o,
    TextEditingController nameCtrl,
    TextEditingController sumCtrl,
    String kind,
    void Function(String) onKind,
  ) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(t('order.material')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SegmentedButton<String>(
                segments: [
                  ButtonSegment(value: 'spare_part', label: Text(t('order.zapchast'))),
                  ButtonSegment(value: 'consumable', label: Text(t('order.rashodnik'))),
                ],
                selected: {kind},
                onSelectionChanged: (s) => setLocal(() {
                  kind = s.first;
                  onKind(kind);
                }),
              ),
              const SizedBox(height: SozoSpace.s12),
              TextField(
                controller: nameCtrl,
                decoration: InputDecoration(labelText: t('order.naimenovanie')),
              ),
              TextField(
                controller: sumCtrl,
                keyboardType: TextInputType.number,
                // Разряды прямо при наборе: «150 000» мастер пишет с
                // пробелом всегда, и раньше это давало ноль в смете
                inputFormatters: [ThousandsFormatter()],
                decoration: InputDecoration(labelText: t('common.summaSum')),
              ),
              const SizedBox(height: SozoSpace.s8),
              if (kind == 'spare_part')
                Text(
                  t('order.zapchastProvoditsyaTolkoS'),
                  style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('common.otmena'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('order.dalee'))),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return true;

    String? receipt;
    if (kind == 'spare_part') {
      await showPhotoCapture(
        context,
        title: t('order.chekNaZapchast'),
        stage: 'receipt',
        alreadyTaken: 0,
        hint: t('order.snimiteChekCelikomChtoby'),
        onUpload: (dataUrl) async {
          receipt = dataUrl;
          return true;
        },
      );
      if (receipt == null) {
        if (!mounted) return true;
        // Камеру закрыли: спрашиваем, снять чек ещё раз или отменить
        // материал целиком. Введённое остаётся в контроллерах в обоих случаях
        final retry = await showSozoConfirm(
          context,
          title: t('order.chekNeSnyat'),
          body: t('order.chekNeSnyatPoyasnenie'),
          confirmLabel: t('order.snyatChek'),
          cancelLabel: t('order.otmenitMaterial'),
        );
        return retry != true;
      }
    }
    final body = {
      'kind': kind,
      'name': nameCtrl.text.trim(),
      'amountSoums': soumsOf(sumCtrl.text),
      'sourceChannel': 'partner_store',
      'receiptDataUrl': ?receipt,
    };
    try {
      await session.api.addMaterial(o.id, body);
      await _load();
    } on ApiError catch (e) {
      if (e.keepsData) {
        await session.outbox.enqueue(
          orderId: o.id,
          kind: 'material',
          payload: body,
          title: t('order.material2', {'p1': o.number}),
        );
        if (mounted) showOk(context, queuedMessage(e));
      } else if (mounted) {
        showError(context, e.message);
      }
    }
    return true;
  }

  Future<void> _pause() async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('order.pauzaVRabote')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(labelText: t('order.prichinaJdemDetalNet')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: Text(t('order.postavit'))),
        ],
      ),
    );
    ctrl.dispose();
    if (reason == null || reason.isEmpty) return;
    await _act('pause', reason: reason, payload: {'reason': reason});
  }

  Future<void> _complete() async {
    final o = _order!;
    final cash = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('order.oplata')),
        content: Text(t('order.itogPoZayavkeDengi', {'p1': formatSoums(o.totalFromTiyin)})),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t('order.net'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t('order.daPoluchil'))),
        ],
      ),
    );
    if (cash == null || !mounted) return;
    if (!cash) {
      // Тупик: раньше приложение отвечало «позвоните в диспетчерскую» и на
      // этом заканчивалось — кнопки звонка не было ни здесь, ни выше
      final call = await showSozoConfirm(
        context,
        title: t('order.oplata'),
        body: t('order.uhodBezOplatySoglasovyvaet'),
        confirmLabel: t('order.pozvonitDispetcheru'),
      );
      if (call == true && mounted) await callNumber(context, session.dispatcherPhone);
      return;
    }
    await _act('complete', payload: {'paymentCollected': true});
  }

  Future<void> _runStep(OrderStep step) async {
    if (_busy) return;
    switch (step.action) {
      case 'confirm_estimate':
        await _confirmEstimate();
      case 'complete':
        await _complete();
      case 'pause':
        await _pause();
      case 'request_addwork':
        await _capture('during', t('order.fotoObosnovaniya'), t('order.dopRabotySoglasuyutsyaTolko'));
        if (mounted) await _act('request_addwork', payload: {'isUpsell': false});
      default:
        await _act(step.action);
    }
  }

  // ---------- Вёрстка ----------

  @override
  Widget build(BuildContext context) {
    final o = _order;
    // Помощник не ведёт конвейер — у него две кнопки и всё (M-33)
    if (o != null && o.role == 'helper') {
      return HelperOrderScreen(
        order: o,
        onDepart: () => _act('depart'),
        onArrive: () => _act('depart', payload: {'arrivedOnly': true}),
      );
    }
    return Scaffold(
      appBar: SozoAppBar(title: o?.number ?? t('order.zayavka'), action: o == null ? null : _troubleButton(o)),
      body: o == null
          ? (_error != null
                ? EmptyView(title: t('order.neUdalosOtkrytZayavku'), subtitle: _error, icon: 'alert-circle')
                : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
                children: [
                  for (final block in [
                    _statusCard(o),
                    if (_addwork != null) _addworkTimeline(o),
                    _locationCard(o),
                    if (o.status == 'master_departed') _enRoute(o),
                    _estimateCard(o),
                    _materialsCard(o),
                    _photosCard(o),
                    _pipeline(o),
                    _extras(o),
                    ..._secondarySteps(o),
                    _troubleRow(o),
                  ]) ...[block, const SizedBox(height: SozoSpace.s12)],
                ],
              ),
            ),
      // Главный шаг — прилипшей панелью, а не девятым блоком ленты.
      // До правки до кнопки «Выехал» или «Завершить» надо было прокрутить
      // около двух тысяч точек, и мастер видел гору карточек вместо действия
      bottomNavigationBar: o == null ? null : _primaryFooter(o),
    );
  }

  /// Ветки «работа идёт не по плану» (M-11).
  ///
  /// Раньше это были тринадцать пунктов за безымянной иконкой «…» размером
  /// 20 в поле 36. Мастер, у которого сломалась машина или не пускают в
  /// подъезд, искать их там не будет. Теперь то же самое открывается
  /// названной кнопкой в ленте, а список разбит на две понятные группы.
  Widget _troubleButton(OrderCard o) {
    return SozoAppBarAction(icon: 'more-horizontal', onTap: () => _openTrouble(o));
  }

  /// На закрытой заявке ветки «работа идёт не по плану» уже ничего не
  /// значат — кнопку не показываем
  static const _finished = ['completed', 'verified', 'closed', 'rated', 'cancelled'];

  Widget _troubleRow(OrderCard o) {
    if (_finished.contains(o.status)) return const SizedBox.shrink();
    return OutlineIconButton(
      icon: 'alert-triangle',
      label: t('order.chtoToPoshloNeTak'),
      amber: false,
      onPressed: () => _openTrouble(o),
    );
  }

  Future<void> _openTrouble(OrderCard o) async {
    // «Не смогу доехать» остаётся до начала работ, а не только до «Выехал»:
    // сломанная машина и пробка случаются уже в пути, и раньше мастеру
    // оставалось врать про «небезопасно» или ставить паузу
    final beforeWork = o.status == 'assigned' || o.status == 'master_departed';
    final working = o.status == 'in_progress' || o.status == 'addwork_approval';

    final action = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(SozoSpace.s16),
                child: Text(
                  t('order.chtoToPoshloNeTak'),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              ),
              _troubleGroup(t('order.gruppaNeRabotaetsya')),
              if (beforeWork) _troubleTile(ctx, 'cant_go', 'car', t('branch.neMoguPoehat')),
              _troubleTile(ctx, 'client_unavailable', 'phone', t('branch.klientNedostupen')),
              _troubleTile(ctx, 'no_access', 'shield', t('order.netDostupaTretyaStorona')),
              _troubleTile(ctx, 'unsafe', 'alert-triangle', t('branch.prervatNebezopasno')),
              if (working) ...[
                _troubleGroup(t('order.gruppaNujnoSoglasovat')),
                _troubleTile(ctx, 'addwork', 'wrench', t('work.vynujdennayaDopRabota')),
                _troubleTile(ctx, 'spare_tiers', 'toolbox', t('order.vilkaZapchasti2')),
                _troubleTile(ctx, 'recommend', 'trending-up', t('order.rekomendovat')),
                _troubleTile(ctx, 'conservation', 'shield', t('work.konservaciya2')),
                _troubleTile(ctx, 'shopping', 'shopping-bag', t('order.spisokZakupkiKlientu')),
                _troubleTile(ctx, 'helper', 'users', t('order.nujenPomoschnik')),
                _troubleTile(ctx, 'purchase_code', 'qr-code', t('order.kodZakupki')),
                _troubleTile(ctx, 'replacement_proof', 'image', t('order.dokazatelstvoZameny')),
                _troubleTile(ctx, 'inspection', 'clipboard', t('order.chekListOsmotra')),
              ],
              const SizedBox(height: SozoSpace.s16),
            ],
          ),
        ),
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'cant_go':
        await _openBranch(BranchScreen(orderId: o.id, orderNumber: o.number, kind: BranchKind.cantGo));
      case 'client_unavailable':
        await _openBranch(BranchScreen(orderId: o.id, orderNumber: o.number, kind: BranchKind.clientUnavailable));
      case 'no_access':
        await _openBranch(BranchScreen(orderId: o.id, orderNumber: o.number, kind: BranchKind.noAccess));
      case 'unsafe':
        await _openBranch(BranchScreen(orderId: o.id, orderNumber: o.number, kind: BranchKind.unsafe));
      case 'helper':
        await _openBranch(HelperRequestScreen(order: o));
      case 'recommend':
        await _openBranch(RecommendScreen(order: o));
      case 'addwork':
        await _openBranch(AddworkScreen(order: o));
      case 'conservation':
        await _openBranch(ConservationScreen(order: o));
      case 'shopping':
        await _openBranch(ShoppingListScreen(order: o));
      case 'spare_tiers':
        await _openBranch(SpareTierScreen(order: o));
      case 'purchase_code':
        await _openBranch(PurchaseCodeScreen(order: o));
      case 'replacement_proof':
        await _openBranch(ReplacementProofScreen(order: o));
      case 'inspection':
        await _openBranch(InspectionScreen(order: o));
    }
  }

  Widget _troubleGroup(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s4),
      child: Text(
        title,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: SozoColors.textSecondary),
      ),
    );
  }

  /// Строка ветки: высота 56 — по ней попадают в перчатке
  Widget _troubleTile(BuildContext ctx, String value, String icon, String title) {
    return InkWell(
      onTap: () => Navigator.of(ctx).pop(value),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16, vertical: SozoSpace.s16),
        child: Row(
          children: [
            FigmaIcon(icon, size: 20, color: SozoColors.textSecondary),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            ),
            const FigmaIcon('chevron-right', size: 16),
          ],
        ),
      ),
    );
  }

  /// Блок «В пути» (M-12 объединён с карточкой): ETA, задержки, приход на место
  Widget _enRoute(OrderCard o) {
    return SozoCard(
      accent: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              FigmaIcon('car', size: 20, color: SozoColors.accent),
              SizedBox(width: SozoSpace.s8),
              Text(t('order.vPuti'), style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: SozoSpace.s4),
          Text(t('order.klientuOtpravlenyVremyaPribyti'), style: TextStyle(fontSize: 13, color: SozoColors.success)),
          const SizedBox(height: SozoSpace.s12),
          Row(
            children: [
              Expanded(
                child: SecondaryButton(label: t('order.zaderjivayus30'), onPressed: () => _delay(30)),
              ),
              const SizedBox(width: SozoSpace.s8),
              Expanded(
                child: SecondaryButton(label: t('order.n0Min'), onPressed: () => _delay(60)),
              ),
            ],
          ),
          if (o.arrivedAt != null)
            Padding(
              padding: EdgeInsets.only(top: SozoSpace.s8),
              child: Text(t('order.pribytieOtmecheno'), style: TextStyle(fontSize: 13, color: SozoColors.success)),
            ),
        ],
      ),
    );
  }

  /// Плашка-таймлайн доп-согласования (M-18 объединён с карточкой)
  Widget _addworkTimeline(OrderCard o) {
    final steps = ((_addwork?['escalation'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return SozoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(SozoSpace.s8),
            decoration: BoxDecoration(
              color: SozoColors.success.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(SozoRadius.button),
            ),
            child: Row(
              children: [
                FigmaIcon('play', size: 18, color: SozoColors.success),
                SizedBox(width: SozoSpace.s8),
                Expanded(child: Text(t('order.mojnoVypolnyatSoglasovannuyuCh'), style: TextStyle(fontSize: 14))),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s12),
          SectionTitle(t('order.jdemOtvetPoDop')),
          ...steps.map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s4),
              child: Row(
                children: [
                  StepMarker(s['done'] == true ? SozoStepState.done : SozoStepState.pending),
                  const SizedBox(width: SozoSpace.s8),
                  Expanded(child: Text(s['step'].toString(), style: const TextStyle(fontSize: 14))),
                  Text(hhmm(s['at']), style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
                ],
              ),
            ),
          ),
          const SizedBox(height: SozoSpace.s8),
          Text(
            t('order.bezOtvetaZavershiteSoglasovann'),
            style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.35),
          ),
          const SizedBox(height: SozoSpace.s8),
          SecondaryButton(
            label: t('order.pereytiKKonservacii'),
            onPressed: () => _openBranch(ConservationScreen(order: o)),
          ),
        ],
      ),
    );
  }

  /// Степпер конвейера — всегда видно, где мы и что дальше (M-11)
  Widget _pipeline(OrderCard o) {
    // Материалы нужны не всегда: замена прокладки и прочистка закрываются
    // без единой запчасти. Пока шаг считался выполненным «по факту непустого
    // списка», на таких заявках он навсегда оставался серым, а вместе с ним
    // и всё, что ниже — мастер решал, что обязан что-то внести
    final materialsExpected = o.materials.isNotEmpty || o.toBuy.isNotEmpty;
    final stages = [
      (
        t('order.vyehal'),
        ['master_departed', 'in_progress', 'addwork_approval', 'completed', 'verified', 'closed', 'rated'],
      ),
      (t('order.fotoDo'), <String>[]),
      (t('order.smeta'), <String>[]),
      (materialsExpected ? t('order.materialy') : t('order.materialyEsliNujny'), <String>[]),
      (t('order.fotoPosle'), <String>[]),
      (t('order.priemka2'), <String>[]),
      (t('order.oplata'), <String>[]),
    ];
    final done = <bool>[
      [
        'master_departed',
        'in_progress',
        'addwork_approval',
        'completed',
        'verified',
        'closed',
        'rated',
      ].contains(o.status),
      o.photosOf('before') > 0,
      o.hasApprovedQuote,
      materialsExpected ? o.materials.isNotEmpty : true,
      o.photosOf('after') > 0,
      o.hasAcceptance,
      ['completed', 'verified', 'closed', 'rated'].contains(o.status),
    ];
    final currentIndex = done.indexWhere((x) => !x);
    return FigmaCard(
      gap: SozoSpace.s16,
      children: [
        CardTitle(t('onb.konveyer')),
        Column(
          children: [
            for (var i = 0; i < stages.length; i++) ...[
              if (i > 0) const SizedBox(height: SozoSpace.s12),
              _pipelineRow(
                stages[i].$1,
                done[i]
                    ? SozoStepState.done
                    : i == currentIndex
                    ? SozoStepState.current
                    : SozoStepState.pending,
              ),
            ],
          ],
        ),
      ],
    );
  }

  /// Шаг конвейера: выполненный — обычным весом, текущий — полужирным,
  /// будущий — серым. Разный вес важнее цвета: цвет на солнце теряется.
  Widget _pipelineRow(String label, SozoStepState state) {
    return Row(
      children: [
        StepMarker(state),
        const SizedBox(width: SozoSpace.s12),
        Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: switch (state) {
              SozoStepState.done => FontWeight.w500,
              SozoStepState.current => FontWeight.w700,
              SozoStepState.pending => FontWeight.w400,
            },
            color: state == SozoStepState.pending ? SozoColors.textSecondary : SozoColors.text,
          ),
        ),
      ],
    );
  }

  /// Разделы, доступные весь период работы: этапы, техника, оплата, помощник
  /// Подпись пункта наряда: мастер должен понять состояние, не открывая экран
  String _permitSubtitle(PermitInfo p) {
    if (p.isClosed) return t('permit.subZonaZakryta');
    if (p.isOpen) return t('permit.subZonaVskrytaNeZabud');
    if (p.canOpenOffline) return t('permit.subSoglasovan', {'p1': p.windowText});
    return t('permit.subJdetSoglasovaniya');
  }

  Widget _extras(OrderCard o) {
    return FigmaCard(
      children: [
        CardTitle(t('order.eschePoZayavke')),
        RowGroup(
          children: [
            // Контур «Дом»: без открытого наряда заявку нельзя начать — пункт
            // стоит первым, иначе мастер найдёт его последним
            if (o.permit != null)
              FigmaNavRow(
                icon: 'shield',
                title: t('permit.naryadDopusk'),
                subtitle: _permitSubtitle(o.permit!),
                onTap: () => _openBranch(PermitScreen(
                  session: session,
                  orderId: o.id,
                  permit: o.permit!,
                )),
              ),
            FigmaNavRow(
              icon: 'trending-up',
              title: t('order.etapyRaboty'),
              subtitle: t('order.dlyaRabotSTehnologicheskimi'),
              onTap: () => _openBranch(StagesScreen(order: o)),
            ),
            FigmaNavRow(
              icon: 'crosshair',
              title: t('order.tehnikaKlienta'),
              subtitle: t('order.shildikPovtornyeZayavkiPridut'),
              onTap: () => _openBranch(AssetScreen(order: o)),
            ),
            FigmaNavRow(
              icon: 'qr-code',
              title: t('order.kodZakupki'),
              subtitle: t('order.kupitVDolgKompanii'),
              onTap: () => _openBranch(PurchaseCodeScreen(order: o)),
            ),
            FigmaNavRow(
              icon: 'credit-card',
              title: t('order.oplata'),
              subtitle: o.totalFromTiyin > 0 ? formatSoums(o.totalFromTiyin) : t('order.summaPoyavitsyaPosleSmety'),
              onTap: () => _openBranch(PaymentScreen(order: o)),
            ),
            if (o.role == 'lead')
              FigmaNavRow(
                icon: 'users',
                title: t('order.pomoschZavershena'),
                subtitle: t('order.bezEtoyOtmetkiPriemka'),
                onTap: () async {
                  try {
                    final r = await session.api.helperConfirm(o.id);
                    if (mounted) showOk(context, (r['message'] ?? t('order.podtverjdeno')).toString());
                  } on ApiError catch (e) {
                    if (mounted) showError(context, e.message);
                  }
                },
              ),
          ],
        ),
      ],
    );
  }

  /// Первая карточка: статус, доля мастера и суть заявки одним взглядом
  Widget _statusCard(OrderCard o) {
    return FigmaCard(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Wrap(
                spacing: SozoSpace.s8,
                runSpacing: SozoSpace.s4,
                children: [
                  FigmaStatusChip(label: o.statusTitle, status: o.status),
                  if (o.isUrgent) FigmaStatusChip(label: t('common.srochno'), status: 'dispute'),
                  if (o.role == 'helper') FigmaStatusChip(label: t('order.yaPomoschnik'), status: 'assigned'),
                  if (o.paused) FigmaStatusChip(label: t('order.pauza'), status: 'new'),
                ],
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(t('common.vashaDolya'), style: TextStyle(fontSize: 11, color: SozoColors.textSecondary)),
                const SizedBox(height: 2),
                Money(formatSoums(o.myShareTiyin), size: 15, weight: FontWeight.w700),
              ],
            ),
          ],
        ),
        Text(
          o.description,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text, height: 1.25),
        ),
      ],
    );
  }

  /// Клиент и адрес. Номер телефона не показывается и не копируется —
  /// звонок идёт кнопкой через сервер (F-59 «Защита данных клиента»).
  Widget _locationCard(OrderCard o) {
    return FigmaCard(
      gap: SozoSpace.s16,
      children: [
        Row(
          children: [
            const IconBadge('map-pin', round: true),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(o.address, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, height: 1.3)),
                  const SizedBox(height: 2),
                  Text(o.clientName, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                ],
              ),
            ),
          ],
        ),
        if (o.addressDetails != null) _accessNote(o.addressDetails!),
        if (o.siteAccess != null) _siteAccessNote(o.siteAccess!),
        if (o.toBuy.isNotEmpty) _toBuyNote(o),
        if (o.clientAssets.any((a) => !a.fromThisOrder)) _assetsNote(o),
        // Три кнопки, которые мастер жмёт стоя у подъезда. До правки все три
        // показывали тост-заглушку: url_launcher не был подключён вовсе
        Row(
          children: [
            Expanded(
              child: ActionTile(
                icon: 'phone',
                label: t('order.klientu'),
                onTap: () => callNumber(context, o.clientPhone),
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Expanded(
              child: ActionTile(
                icon: 'headset',
                label: t('order.dispetcheru'),
                onTap: () => callNumber(context, session.dispatcherPhone),
              ),
            ),
            const SizedBox(width: SozoSpace.s8),
            Expanded(
              child: ActionTile(
                icon: 'navigation',
                label: t('order.marshrut'),
                onTap: () => openNavigation(context, lat: o.lat, lng: o.lng, address: o.address),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// Как попасть внутрь — со слов клиента.
  ///
  /// Это не предупреждение и не ошибка, поэтому блок нейтральный: серый фон,
  /// без цветовой тревоги. Показываем только заполненные поля — пустые строки
  /// вида «Домофон: —» ничего не сообщают, а карточку удлиняют.
  Widget _accessNote(AddressDetails d) {
    final rows = <(String, String)>[
      if (d.apartment != null) (t('order.kvartira'), d.apartment!),
      if (d.entrance != null) (t('order.podezd'), d.entrance!),
      if (d.floor != null) (t('order.etaj'), d.hasLift == false ? t('order.liftaNet', {'p1': d.floor}) : d.floor!),
      if (d.intercom != null) (t('order.domofon'), d.intercom!),
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: SozoColors.chipGrey, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('keypad', size: 16, color: SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s8),
              Text(
                t('order.kakPopast'),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.textSecondary),
              ),
            ],
          ),
          if (rows.isNotEmpty) const SizedBox(height: SozoSpace.s8),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 76,
                    child: Text(label, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                  ),
                  Expanded(
                    child: Text(
                      value,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.text),
                    ),
                  ),
                ],
              ),
            ),
          if (d.comment != null) ...[
            const SizedBox(height: SozoSpace.s8),
            Text(d.comment!, style: const TextStyle(fontSize: 13, color: SozoColors.text, height: 1.35)),
          ],
        ],
      ),
    );
  }

  /// Что купить до выезда.
  ///
  /// Тон тревожный, и это не преувеличение: приехать без детали, которую
  /// клиент уже выбрал и ждёт, — сорванный визит и повторный выезд.
  /// Отметка снимается сама, когда мастер вносит материал в заявку.
  Widget _toBuyNote(OrderCard o) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: softWarnBg, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('shopping-bag', size: 16, color: softWarnFg),
              const SizedBox(width: SozoSpace.s8),
              Text(
                t('order.kupitDoVyezda'),
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: softWarnFg),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
          for (final p in o.toBuy)
            Padding(
              padding: const EdgeInsets.only(bottom: SozoSpace.s4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${p.partName} · ${p.tierTitle}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.text),
                    ),
                  ),
                  Text(formatSoums(p.amountTiyin), style: const TextStyle(fontSize: 13, color: SozoColors.text)),
                  const SizedBox(width: SozoSpace.s8),
                  TextButton(onPressed: _busy ? null : () => _markBought(p), child: Text(t('order.kupil'))),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _markBought(PartToBuy p) async {
    setState(() => _busy = true);
    try {
      await session.api.markPartBought(p.id);
      await _load();
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Пропускной режим объекта.
  ///
  /// «Съёмка запрещена» вынесена отдельной строкой и тоном тревоги: это не
  /// справка, а запрет, из-за которого фото-цикл конвейера на этом объекте
  /// не работает, и узнать о нём на месте — поздно.
  Widget _siteAccessNote(SiteAccess a) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: SozoColors.chipGrey, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('home', size: 16, color: SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s8),
              Expanded(
                child: Text(
                  a.locationName,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
          for (final line in [a.schedule, a.accessNotes, a.hoaContact])
            if (line != null && line.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(line, style: const TextStyle(fontSize: 13, color: SozoColors.text, height: 1.35)),
              ),
          if (a.photoForbidden) ...[
            const SizedBox(height: SozoSpace.s8),
            NoteBox(icon: 'camera-off', text: t('order.naObekteSemkaZapreschena'), tone: NoteTone.warn),
          ],
        ],
      ),
    );
  }

  /// Что у этого клиента уже стоит.
  ///
  /// Технику по текущей заявке не показываем: она ещё не история, а то, что
  /// ставим прямо сейчас. Смысл блока в другом — не начинать диагностику
  /// с нуля там, где полгода назад уже работали.
  Widget _assetsNote(OrderCard o) {
    final past = o.clientAssets.where((a) => !a.fromThisOrder).toList();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(SozoSpace.s12),
      decoration: BoxDecoration(color: SozoColors.chipGrey, borderRadius: BorderRadius.circular(SozoRadius.thumb)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const FigmaIcon('toolbox', size: 16, color: SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s8),
              Text(
                t('order.tehnikaKlienta'),
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s8),
          for (final a in past)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                a.year == null ? a.title : t('order.g', {'p1': a.title, 'p2': a.year}),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.text),
              ),
            ),
        ],
      ),
    );
  }

  Widget _estimateCard(OrderCard o) {
    return FigmaCard(
      children: [
        CardTitle(
          t('order.smeta'),
          actionLabel: o.lines.isEmpty ? t('order.sostavit') : t('common.izmenit'),
          onAction: () async {
            final changed = await Navigator.of(
              context,
            ).push<bool>(MaterialPageRoute(builder: (_) => QuoteScreen(order: o)));
            if (changed == true) await _load();
          },
        ),
        if (o.lines.isEmpty)
          Text(t('order.poziciiNeVybrany'), style: TextStyle(fontSize: 14, color: SozoColors.textSecondary))
        else
          Column(
            children: [
              for (final l in o.lines)
                Padding(
                  padding: const EdgeInsets.only(bottom: SozoSpace.s4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('${l.name}${l.qty > 1 ? ' × ${l.qty}' : ''}', style: const TextStyle(fontSize: 14)),
                      ),
                      Money(formatSoums(l.priceFromTiyin * l.qty), size: 14),
                    ],
                  ),
                ),
            ],
          ),
        const FigmaDivider(),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(t('order.itogoKlientu'), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            Money(formatSoums(o.totalFromTiyin), size: 16, weight: FontWeight.w700),
          ],
        ),
        o.hasApprovedQuote
            ? NoteBox(icon: 'check-done', text: t('order.soglasovanaKlientom'), tone: NoteTone.success)
            : NoteBox(icon: 'alert-circle', text: t('order.neSoglasovanaRabotatNelzya'), tone: NoteTone.warn),
      ],
    );
  }

  Widget _materialsCard(OrderCard o) {
    return FigmaCard(
      children: [
        CardTitle(t('order.materialy')),
        if (o.materials.isEmpty)
          Text(t('order.materialyNeVnosilis'), style: TextStyle(fontSize: 14, color: SozoColors.textSecondary))
        else
          Column(
            children: [
              for (final m in o.materials)
                Padding(
                  padding: const EdgeInsets.only(bottom: SozoSpace.s4),
                  child: Row(
                    children: [
                      FigmaIcon(m.hasReceipt ? 'check-square' : 'alert-triangle', size: 16),
                      const SizedBox(width: SozoSpace.s8),
                      Expanded(child: Text(m.name, style: const TextStyle(fontSize: 14))),
                      Money(formatSoums(m.amountTiyin), size: 14),
                    ],
                  ),
                ),
            ],
          ),
        OutlineAmberButton(label: t('order.dobavitMaterial'), onPressed: _addMaterial),
      ],
    );
  }

  Widget _photosCard(OrderCard o) {
    return FigmaCard(
      gap: SozoSpace.s16,
      children: [
        CardTitle(t('order.fotofiksaciyaIPriemka')),
        RowGroup(
          children: [
            _photoRow(o, 'before', t('order.fotoDo'), t('order.snimiteProblemuDoNachala')),
            _photoRow(o, 'after', t('order.fotoPosle'), t('order.snimiteRezultatUzelStyk')),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
              child: Row(
                children: [
                  const FigmaIcon('check-square', size: 16),
                  const SizedBox(width: SozoSpace.s8),
                  Expanded(
                    child: Text(
                      o.hasAcceptance ? t('order.priemkaZafiksirovana') : t('order.priemkaNeZafiksirovana'),
                      style: TextStyle(
                        fontSize: 14,
                        color: o.hasAcceptance ? SozoColors.text : SozoColors.textSecondary,
                      ),
                    ),
                  ),
                  if (!o.hasAcceptance) AmberAction(t('order.zafiksirovat'), onTap: _fixAcceptance),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _photoRow(OrderCard o, String stage, String label, String hint) {
    final n = o.photosOf(stage);
    final noGeo = o.photos.where((p) => p.stage == stage && p.geoMissing).length;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
      child: Row(
        children: [
          const FigmaIcon('image', size: 16),
          const SizedBox(width: SozoSpace.s8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$label · $n', style: const TextStyle(fontSize: 14)),
                if (noGeo > 0)
                  Text(t('order.chastBezGeometkiEto'), style: TextStyle(fontSize: 10, color: SozoColors.textSecondary)),
              ],
            ),
          ),
          AmberAction(t('common.snyat'), onTap: () => _capture(stage, label, hint)),
        ],
      ),
    );
  }

  /// Главный шаг заявки — то единственное, ради чего мастер открыл экран.
  ///
  /// Сервер присылает шаги вместе с причиной блокировки; причину показываем
  /// прямо над кнопкой, а не в конце ленты — иначе серая кнопка молчит.
  OrderStep? _primaryStep(OrderCard o) {
    final acting = o.steps.where((s) => s.action != 'pause').toList();
    if (acting.isEmpty) return null;
    return acting.firstWhere(
      (s) => s.action == 'complete' || s.action == 'start' || s.action == 'depart',
      orElse: () => acting.first,
    );
  }

  Widget? _primaryFooter(OrderCard o) {
    final primary = _primaryStep(o);
    if (primary == null) return null;
    return StickyFooter(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!primary.enabled && primary.reason != null) ...[
            NoteBox(icon: 'alert-triangle', text: primary.reason!, tone: NoteTone.danger),
            const SizedBox(height: SozoSpace.s8),
          ],
          BigButton(label: primary.title, busy: _busy, onPressed: primary.enabled ? () => _runStep(primary) : null),
        ],
      ),
    );
  }

  /// Остальные шаги остаются в ленте: они равноправные и редкие.
  /// Пауза — последней красной строкой (макет 30:113)
  List<Widget> _secondarySteps(OrderCard o) {
    if (o.steps.isEmpty) {
      return [NoteBox(icon: 'alert-circle', text: t('order.poEtoyZayavkeDeystviy'), tone: NoteTone.warn)];
    }
    final pause = o.steps.where((s) => s.action == 'pause').firstOrNull;
    final primary = _primaryStep(o);
    final rest = o.steps.where((s) => s.action != 'pause' && s.action != primary?.action).toList();
    if (rest.isEmpty && pause == null) return const [];
    return [
      Column(
        children: [
          for (var i = 0; i < rest.length; i++) ...[
            if (i > 0) const SizedBox(height: SozoSpace.s8),
            BigButton(
              label: rest[i].title,
              kind: BigButtonKind.secondary,
              // Блокировка на время запроса нужна и здесь: двойной тап по
              // «Я на месте» давал два перехода подряд, а с недавних пор ещё
              // и конфликт версий вторым ответом
              onPressed: rest[i].enabled && !_busy ? () => _runStep(rest[i]) : null,
            ),
            if (!rest[i].enabled && rest[i].reason != null)
              Padding(
                padding: const EdgeInsets.only(top: SozoSpace.s4),
                child: Text(
                  rest[i].reason!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                ),
              ),
          ],
          if (pause != null) ...[
            const SizedBox(height: SozoSpace.s8),
            DangerTextButton(
              label: t('order.priostanovitPauza'),
              onPressed: pause.enabled && !_busy ? () => _runStep(pause) : null,
            ),
          ],
        ],
      ),
    ];
  }
}

/// Отправку очереди не ждём: мастеру важно продолжить работу, а не смотреть на спиннер
void unawaitedFlush() {
  session.outbox.flush();
}
