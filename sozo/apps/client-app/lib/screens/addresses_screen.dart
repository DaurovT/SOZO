import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/async_view.dart';
import '../widgets/blocks.dart';

/// C-29. Мои адреса. Детали доступа хранятся здесь один раз и подставляются
/// в новые заявки — чтобы клиент не диктовал домофон каждый раз заново.
class AddressesScreen extends StatelessWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(
        title: t('c29.title'),
        titleSize: 18,
        action: SozoAppBarAction(
          icon: 'pen',
          onTap: () async {
            final saved = await _edit(context, null);
            if (saved == true) key.currentState?.reload();
          },
        ),
      ),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          key: key,
          load: () => session.api.addresses(),
          builder: (context, data, reload) {
            final items = ((data['addresses'] as List?) ?? const []).cast<Map<String, dynamic>>();
            if (items.isEmpty) {
              return EmptyState(
                icon: 'map-pin',
                text: t('c29.empty'),
                actionLabel: t('c29.add'),
                onAction: () async {
                  final saved = await _edit(context, null);
                  if (saved == true) await reload();
                },
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(SozoSpace.s16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: SozoSpace.s12),
              itemBuilder: (context, i) {
                final a = items[i];
                final details = [
                  if ((a['entrance'] as String?)?.isNotEmpty ?? false) t('c29.entrance', {'v': a['entrance']}),
                  if ((a['floor'] as String?)?.isNotEmpty ?? false) t('c29.floor', {'v': a['floor']}),
                  if ((a['intercom'] as String?)?.isNotEmpty ?? false) t('c29.intercom', {'v': a['intercom']}),
                  if (a['hasLift'] == true) t('c29.lift'),
                ].join(' · ');
                return SozoCard(
                  radius: SozoRadius.tile,
                  padding: const EdgeInsets.all(SozoSpace.s12),
                  gap: 6,
                  onTap: () async {
                    final saved = await _edit(context, a);
                    if (saved == true) await reload();
                  },
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            [a['street'], a['apartment'] == null || (a['apartment'] as String).isEmpty
                                    ? null
                                    : t('c29.apartment', {'v': a['apartment']})]
                                .where((v) => v != null)
                                .join(', '),
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: authInk),
                          ),
                        ),
                        if (a['primary'] == true) ...[
                          const SizedBox(width: SozoSpace.s8),
                          TagChip(
                            t('c29.primary'),
                            bg: SozoColors.accent.withValues(alpha: 0.11),
                            fg: authInk,
                            pill: true,
                          ),
                        ],
                      ],
                    ),
                    if (details.isNotEmpty)
                      Text(
                        details,
                        style: const TextStyle(fontSize: 13, height: 1.3, color: authHint),
                      ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        AmberAction(
                          t('common.delete'),
                          onTap: () async {
                            final ok = await showSozoConfirm(
                              context,
                              title: t('c29.deleteTitle'),
                              text: t('c29.deleteText'),
                              confirmLabel: t('common.delete'),
                              danger: true,
                            );
                            if (!ok) return;
                            try {
                              await session.api.deleteAddress(a['id'] as String);
                              await reload();
                            } on ApiError catch (e) {
                              if (context.mounted) showSozoToast(context, e.message);
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }

  Future<bool?> _edit(BuildContext context, Map<String, dynamic>? address) {
    return Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(builder: (_) => AddressFormScreen(address: address)),
    );
  }
}

class AddressFormScreen extends StatefulWidget {
  const AddressFormScreen({super.key, this.address});

  final Map<String, dynamic>? address;

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  final _label = TextEditingController();
  final _street = TextEditingController();
  final _apartment = TextEditingController();
  final _entrance = TextEditingController();
  final _floor = TextEditingController();
  final _intercom = TextEditingController();
  final _comment = TextEditingController();
  bool _hasLift = false;
  bool _primary = false;
  bool _busy = false;
  bool _touched = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final a = widget.address;
    if (a != null) {
      _label.text = (a['label'] as String?) ?? '';
      _street.text = (a['street'] as String?) ?? '';
      _apartment.text = (a['apartment'] as String?) ?? '';
      _entrance.text = (a['entrance'] as String?) ?? '';
      _floor.text = (a['floor'] as String?) ?? '';
      _intercom.text = (a['intercom'] as String?) ?? '';
      _comment.text = (a['comment'] as String?) ?? '';
      _hasLift = a['hasLift'] == true;
      _primary = a['primary'] == true;
    }
  }

  @override
  void dispose() {
    for (final c in [_label, _street, _apartment, _entrance, _floor, _intercom, _comment]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _touched = true);
    if (_street.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await session.api.saveAddress({
        'id': widget.address?['id'],
        'label': _label.text.trim(),
        'street': _street.text.trim(),
        'apartment': _apartment.text.trim(),
        'entrance': _entrance.text.trim(),
        'floor': _floor.text.trim(),
        'intercom': _intercom.text.trim(),
        'comment': _comment.text.trim(),
        'hasLift': _hasLift,
        'primary': _primary,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: widget.address == null ? t('c29.add') : t('c29.edit')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SozoField(label: t('c29.label'), controller: _label, hint: t('c29.labelHint')),
                  SozoField(
                    label: t('c10.addressLabel'),
                    controller: _street,
                    error: _touched && _street.text.trim().isEmpty ? t('c10.addressError') : null,
                    onChanged: (_) => setState(() {}),
                  ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: SozoField(label: t('c50.apartment'), controller: _apartment)),
                      const SizedBox(width: SozoSpace.s12),
                      Expanded(child: SozoField(label: t('c50.entrance'), controller: _entrance)),
                    ],
                  ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: SozoField(
                          label: t('c50.floor'),
                          controller: _floor,
                          keyboardType: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: SozoSpace.s12),
                      Expanded(child: SozoField(label: t('c50.intercom'), controller: _intercom)),
                    ],
                  ),
                  SozoCard(
                    children: [
                      SwitchRow(title: t('c50.lift'), value: _hasLift, onChanged: (v) => setState(() => _hasLift = v)),
                      const SozoDivider(),
                      SwitchRow(
                        title: t('c29.makePrimary'),
                        subtitle: t('c29.makePrimaryHint'),
                        value: _primary,
                        onChanged: (v) => setState(() => _primary = v),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  SozoField(label: t('c50.comment'), controller: _comment, maxLines: 3),
                  if (_error != null) SozoBanner(icon: 'alert-circle', tone: BannerTone.danger, text: _error!),
                ],
              ),
            ),
            StickyFooter(children: [PrimaryButton(t('common.save'), busy: _busy, onTap: _save)]),
          ],
        ),
      ),
    );
  }
}
