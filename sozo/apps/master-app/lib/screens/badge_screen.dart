import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/app_chrome.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import '../i18n.dart';

/// Удостоверение специалиста (L-07, паттерн П-4 «QR-показ»).
///
/// Это то, что мастер показывает в дверях: клиент сканирует код и на сайте видит,
/// что перед ним действующий сотрудник. Телефон и контакты не раскрываются —
/// проверка отвечает только «действует» или «недействителен» (PRD-06 §3).
///
/// Экран специально контрастный и без лишнего: его смотрят секунд пять,
/// стоя на пороге, часто против света.
class BadgeScreen extends StatefulWidget {
  const BadgeScreen({super.key, required this.profile, required this.verifyBaseUrl});

  final MasterProfile profile;

  /// Адрес проверки: клиент попадает на него по QR
  final String verifyBaseUrl;

  @override
  State<BadgeScreen> createState() => _BadgeScreenState();
}

class _BadgeScreenState extends State<BadgeScreen> {
  @override
  void initState() {
    super.initState();
    // Бейдж читают с чужого телефона — гасить экран посреди сканирования нельзя
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersive);
  }

  @override
  void dispose() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  String get _verifyUrl => '${widget.verifyBaseUrl}/verify/${widget.profile.qrBadgeCode}';

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;
    return Scaffold(
      backgroundColor: SozoColors.text,
      body: SafeArea(
        child: Column(
          children: [
            SizedBox(
              height: 64,
              child: Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.only(left: SozoSpace.s16),
                  child: SozoBackButton(onTap: () => Navigator.of(context).pop()),
                ),
              ),
            ),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: SozoSpace.s8),
                  child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 380), child: _card(p)),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: SozoSpace.s32, vertical: SozoSpace.s16),
              child: Text(
                t('badge.klientSkaniruetKodI'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, height: 18 / 13, color: SozoColors.textSecondary),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Карточка удостоверения (макет 58:669). Порядок сверху вниз —
  /// порядок взгляда клиента: чей документ → кто вы → код → допуск.
  Widget _card(MasterProfile p) {
    final active = p.status == 'active';
    return Container(
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        boxShadow: badgeShadow,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          // Шапка: знак компании — первое, что видит клиент
          Container(
            width: double.infinity,
            color: SozoColors.accent,
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: SozoSpace.s16),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: SozoColors.text,
                    borderRadius: BorderRadius.circular(SozoRadius.badge),
                  ),
                  child: const SozoMark(size: 20),
                ),
                const SizedBox(width: SozoSpace.s12),
                Expanded(
                  child: Text(
                    t('badge.udostoverenieSpecialista'),
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.onAccent),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(SozoSpace.s24, 28, SozoSpace.s24, 10),
            child: Column(
              children: [
                Container(
                  width: 100,
                  height: 100,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: badgeAvatarBg,
                    borderRadius: BorderRadius.circular(50),
                    border: Border.all(color: SozoColors.surface, width: 3),
                  ),
                  child: Text(
                    p.fullName.isEmpty ? '?' : p.fullName.characters.first.toUpperCase(),
                    style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w700, color: SozoColors.text),
                  ),
                ),
                const SizedBox(height: 11),
                Text(
                  p.fullName,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
                const SizedBox(height: 6),
                Text(
                  p.skillTags.isEmpty ? t('badge.master') : p.skillTags.map(tv).join(' · '),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                ),
                const SizedBox(height: 11),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s12, vertical: 6),
                  decoration: BoxDecoration(color: softSuccessBg, borderRadius: BorderRadius.circular(SozoRadius.chip)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const FigmaIcon('sparkles', size: 12),
                      const SizedBox(width: 6),
                      Text(
                        p.gradeTitle,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: softSuccessFg),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 11),
                Container(
                  width: 204,
                  height: 204,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(SozoRadius.tile),
                    border: Border.all(color: SozoColors.border),
                  ),
                  // QR строго чёрный на белом: стилизованный код читается хуже
                  child: Padding(
                    padding: const EdgeInsets.all(SozoSpace.s12),
                    child: QrImageView(
                      data: _verifyUrl,
                      version: QrVersions.auto,
                      backgroundColor: SozoColors.surface,
                      eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: SozoColors.text),
                      dataModuleStyle: const QrDataModuleStyle(
                        dataModuleShape: QrDataModuleShape.square,
                        color: SozoColors.text,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 11),
                // Код буквами — если камера клиента не справилась, его можно продиктовать
                SelectableText(
                  p.qrBadgeCode.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 2,
                    color: SozoColors.text,
                  ),
                ),
                const SizedBox(height: SozoSpace.s4),
                Text(t('badge.kodProverki'), style: TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
              ],
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: active ? softSuccessBg : softWarnBg,
              border: Border(top: BorderSide(color: active ? softSuccessFg : softWarnFg)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                FigmaIcon(
                  active ? 'shield-check' : 'alert-circle',
                  size: 16,
                  color: active ? softSuccessFg : softWarnFg,
                ),
                const SizedBox(width: SozoSpace.s8),
                Text(
                  active ? t('badge.dopuschenKRabote') : t('badge.ispytatelnyySrok'),
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: active ? softSuccessFg : softWarnFg,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
