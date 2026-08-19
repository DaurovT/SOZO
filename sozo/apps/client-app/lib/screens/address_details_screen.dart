import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';

/// C-50. Детали адреса для мастера.
///
/// В визарде создания их не спрашивают намеренно (ТЗ 17.17 п.1): пять полей
/// между «сломалось» и «отправить» — самый дорогой отвал в воронке. Клиент
/// заполняет их, когда мастер уже назначен и мотивация максимальная.
class AddressDetailsScreen extends StatefulWidget {
  const AddressDetailsScreen({super.key, required this.order});

  final Map<String, dynamic> order;

  @override
  State<AddressDetailsScreen> createState() => _AddressDetailsScreenState();
}

class _AddressDetailsScreenState extends State<AddressDetailsScreen> {
  final _apartment = TextEditingController();
  final _entrance = TextEditingController();
  final _floor = TextEditingController();
  final _intercom = TextEditingController();
  final _comment = TextEditingController();
  bool _hasLift = false;
  bool _save = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Поля предзаполняются тем, что уже известно: этаж и лифт могли собрать
    // на шаге 2 визарда (парная работа), остальное — из сохранённого адреса
    final d = widget.order['addressDetails'] as Map<String, dynamic>?;
    if (d != null) {
      _apartment.text = (d['apartment'] as String?) ?? '';
      _entrance.text = (d['entrance'] as String?) ?? '';
      _floor.text = (d['floor'] as String?) ?? '';
      _intercom.text = (d['intercom'] as String?) ?? '';
      _comment.text = (d['comment'] as String?) ?? '';
      _hasLift = d['hasLift'] == true;
    }
  }

  @override
  void dispose() {
    _apartment.dispose();
    _entrance.dispose();
    _floor.dispose();
    _intercom.dispose();
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await session.api.saveAddressDetails(widget.order['id'] as String, {
        'apartment': _apartment.text,
        'entrance': _entrance.text,
        'floor': _floor.text,
        'intercom': _intercom.text,
        'hasLift': _hasLift,
        'comment': _comment.text,
        'saveToAddresses': _save,
      });
      unawaited(session.api.track('address_details_completed', {'when': 'after_assign'}));
      if (!mounted) return;
      showSozoToast(context, t('c50.sent'));
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final master = widget.order['master'] as Map<String, dynamic>?;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c50.title')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(SozoSpace.s16),
                children: [
                  SozoBanner(
                    icon: 'user',
                    tone: BannerTone.info,
                    text: t('c50.context', {'master': master?['name'] ?? t('c50.masterFallback')}),
                  ),
                  const SizedBox(height: SozoSpace.s16),
                  SozoCard(
                    children: [
                      Text(
                        (widget.order['address'] as String?) ?? '',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: SozoColors.text),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s16),
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
                      SwitchRow(
                        title: t('c50.lift'),
                        subtitle: t('c50.liftHelp'),
                        value: _hasLift,
                        onChanged: (v) => setState(() => _hasLift = v),
                      ),
                    ],
                  ),
                  const SizedBox(height: SozoSpace.s12),
                  SozoField(
                    label: t('c50.comment'),
                    controller: _comment,
                    hint: t('c50.commentHint'),
                    maxLines: 3,
                  ),
                  SozoCard(
                    children: [
                      SwitchRow(
                        title: t('c50.saveAddress'),
                        value: _save,
                        onChanged: (v) => setState(() => _save = v),
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
                PrimaryButton(t('common.done'), busy: _busy, onTap: _submit),
                Text(
                  t('c50.footerNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
