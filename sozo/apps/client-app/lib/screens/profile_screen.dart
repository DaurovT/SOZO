import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/blocks.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import 'addresses_screen.dart';
import 'complaints_screen.dart';
import 'consents_screen.dart';
import 'context_screen.dart';
import 'equipment_screen.dart';
import 'payments_screen.dart';
import 'promos_screen.dart';
import 'b2b/site_screens.dart';
import 'showcase_screen.dart';
import 'shell.dart';

/// C-30. Профиль и настройки.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  /// Имя правится прямо в профиле: раньше его нельзя было ни задать, ни
  /// исправить — оно подставлялось из первой заявки и жило с опечаткой навсегда
  Future<void> _editName() async {
    final ctrl = TextEditingController(text: session.fullName);
    final saved = await showSozoPrompt(
      context,
      title: t('c04.name'),
      hint: t('c04.nameHint'),
      controller: ctrl,
      confirmLabel: t('common.save'),
    );
    ctrl.dispose();
    if (saved == null || saved.trim().isEmpty || !mounted) return;
    try {
      await session.api.updateProfile({'fullName': saved.trim()});
      await session.refreshMe();
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) showSozoToast(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = session.fullName;
    return TabScaffold(
      title: t('tab.profile'),
      titleSize: 18,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s12, SozoSpace.s16, SozoSpace.s32),
        children: [
          SozoCard(
            radius: SozoRadius.tile,
            // Вся карточка ведёт к правке имени: иконка карандаша 20 без
            // собственной кнопки — цель размером с ноготь, промахнуться легко
            onTap: _editName,
            children: [
              Row(
                children: [
                  PersonAvatar(name: name.isEmpty ? '?' : name, size: 56, solid: true),
                  const SizedBox(width: SozoSpace.s16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name.isEmpty ? t('c30.noName') : name,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: authInk),
                        ),
                        const SizedBox(height: SozoSpace.s4),
                        Text(
                          prettyPhone(session.phone),
                          style: const TextStyle(fontSize: 14, color: authHint),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s8),
                  const FigmaIcon('pen', size: 20, color: authHint),
                ],
              ),
              // Тем, кто вошёл до появления вопроса об имени, показываем его
              // здесь: без имени мастер видит в заявке номер телефона
              if (name.isEmpty)
                SozoBanner(text: t('c30.noNameHint'), icon: 'user', tone: BannerTone.warn),
            ],
          ),
          const SizedBox(height: SozoSpace.s20),

          SectionHeading(t('c30.settings')),
          const SizedBox(height: SozoSpace.s8),
          SozoCard(
            gap: 0,
            radius: SozoRadius.tile,
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
            children: [
              NavRow(
                icon: 'globe',
                title: t('c30.language'),
                value: _languageName(l10n.code),
                onTap: _pickLanguage,
              ),
              const SozoDivider(),
              NavRow(
                icon: 'users',
                title: t('c30.context'),
                value: session.currentContext?['title'] as String? ?? t('c05.personal'),
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const ContextScreen()),
                  );
                  if (mounted) setState(() {});
                },
              ),
            ],
          ),

          // В контексте точки профиль отвечал только «как меня зовут». Кто я в
          // этой организации, что могу утвердить сам и куда идти за лимитами —
          // всё это лежало на других экранах или не показывалось вовсе
          if (!session.isB2C) ...[
            const SizedBox(height: SozoSpace.s20),
            SectionHeading(t('c30.site')),
            const SizedBox(height: SozoSpace.s8),
            SozoCard(
              gap: 0,
              radius: SozoRadius.tile,
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
              children: [
                NavRow(
                  icon: 'clipboard',
                  title: t('c30.position'),
                  value: (session.currentContext?['position'] as String?) ?? _roleName(session.role),
                ),
                const SozoDivider(),
                NavRow(
                  icon: 'shield',
                  title: t('c30.myLimit'),
                  value: session.currentContext?['approvalLimitTiyin'] == null
                      ? t('c38.noLimit')
                      : soums(session.currentContext?['approvalLimitTiyin']),
                ),
                const SozoDivider(),
                NavRow(
                  icon: 'users',
                  title: t('c38.title'),
                  value: session.currentContext?['organizationName'] as String?,
                  onTap: () {
                    final loc = session.currentContext?['id'] as String?;
                    if (loc == null) return;
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => LimitsScreen(locationId: loc)),
                    );
                  },
                ),
              ],
            ),
          ],

          const SizedBox(height: SozoSpace.s20),
          SectionHeading(t('c30.myData')),
          const SizedBox(height: SozoSpace.s8),
          SozoCard(
            gap: 0,
            radius: SozoRadius.tile,
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
            children: [
              if (session.isB2C) ...[
                NavRow(
                  icon: 'map-pin',
                  title: t('c29.title'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const AddressesScreen()),
                  ),
                ),
                const SozoDivider(),
              ],
              NavRow(
                icon: 'megaphone',
                title: t('c23.title'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const ComplaintsScreen()),
                ),
              ),
              const SozoDivider(),
              NavRow(
                icon: 'shield-check',
                title: t('c04.title'),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const ConsentsScreen()),
                ),
              ),
              if (session.isB2C) ...[
                const SozoDivider(),
                NavRow(
                  icon: 'toolbox',
                  title: t('c28.title'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const EquipmentScreen()),
                  ),
                ),
              ],
              // Обещание «будем звать его первым» должно быть видно и отзываемо
              // там же, где его дали: иначе клиент не помнит, кого запомнил
              if (favoriteMaster != null) ...[
                const SozoDivider(),
                NavRow(
                  icon: 'user',
                  title: t('c30.favoriteMaster'),
                  value: favoriteMaster,
                  onTap: _forgetFavoriteMaster,
                ),
              ],
            ],
          ),

          // Деньги — своя секция: способ оплаты и история платежей это не
          // «данные обо мне», а отдельный разговор
          if (session.isB2C) ...[
            const SizedBox(height: SozoSpace.s20),
            SectionHeading(t('c30.money')),
            const SizedBox(height: SozoSpace.s8),
            SozoCard(
              gap: 0,
              radius: SozoRadius.tile,
              padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
              children: [
                NavRow(
                  icon: 'credit-card',
                  title: t('pay.title'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const PaymentsScreen()),
                  ),
                ),
                const SozoDivider(),
                // Промокоды живут рядом с деньгами, а не в «моих данных»:
                // человек приходит сюда с вопросом «сколько я плачу»
                NavRow(
                  icon: 'star',
                  title: t('promo.title'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const PromosScreen()),
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: SozoSpace.s20),
          SectionHeading(t('c30.support')),
          const SizedBox(height: SozoSpace.s8),
          SozoCard(
            gap: 0,
            radius: SozoRadius.tile,
            padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
            children: [
              NavRow(
                icon: 'phone',
                title: t('c30.callSupport'),
                value: (session.me?['supportPhone'] as String?) == null
                    ? null
                    : prettyPhone(session.me!['supportPhone'] as String),
                onTap: () => callPhone(context, session.me?['supportPhone'] as String?),
              ),
              const SozoDivider(),
              // Смена номера — только через поддержку: номер и есть учётная запись
              NavRow(icon: 'qr-code', title: t('c30.changePhone'), onTap: _changePhoneInfo),
            ],
          ),

          const SizedBox(height: SozoSpace.s24),
          // «Выйти» в макете янтарное, а не красное: выход не разрушает данные,
          // а подтверждение всё равно спросим отдельно
          Center(child: AmberAction(t('c30.signOut'), onTap: _signOut)),
          const SizedBox(height: SozoSpace.s8),
          // Витрина экранов — инструмент показа, а не часть продукта. Держать
          // её пунктом меню значит показывать клиенту служебный вход; прятать
          // совсем — терять способ провести демонстрацию. Долгий тап по версии:
          // случайно не нажать, знающему объяснять не надо
          Center(
            child: GestureDetector(
              onLongPress: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const ShowcaseScreen()),
              ),
              child: Text(
                t('c01.version', {'version': '1.0.0'}),
                style: const TextStyle(fontSize: 12, color: authHint),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Имя запомненного мастера — из `me`, отдельного запроса ради строки не делаем
  String? get favoriteMaster => session.me?['favoriteMasterName'] as String?;

  Future<void> _forgetFavoriteMaster() async {
    final ok = await showSozoConfirm(
      context,
      title: t('c30.forgetMasterTitle'),
      text: t('c30.forgetMasterBody', {'name': favoriteMaster ?? ''}),
      confirmLabel: t('c30.forgetMasterConfirm'),
      danger: true,
    );
    if (!ok) return;
    await session.api.forgetFavoriteMaster();
    await session.refreshMe();
    if (mounted) setState(() {});
  }

  /// Роль словами, когда должность не заполнена: «Сотрудник» понятнее пустоты
  static String _roleName(String role) => switch (role) {
        'site_manager' => t('c05.roleSiteManager'),
        'org_manager' => t('c05.roleOrgManager'),
        'owner' => t('c05.roleOwner'),
        _ => t('c05.roleStaff'),
      };

  /// Название языка — на нём самом: человек, ищущий английский, узнаёт слово
  /// «English», а не «Английский»
  static String _languageName(String code) => switch (code) {
        'uz' => t('c01.langUz'),
        'en' => 'English',
        _ => t('c01.langRu'),
      };

  Future<void> _pickLanguage() async {
    await showSozoSheet<void>(
      context,
      title: t('c30.language'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final code in L10n.codes)
              Padding(
                padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                child: SecondaryButton(
                  _languageName(code),
                  icon: code == l10n.code ? 'check' : null,
                  onTap: () async {
                    await l10n.set(code);
                    // Язык уходит и в профиль: на нём же приходят SMS и документы
                    await session.api.saveConsents({'locale': code});
                    if (!mounted) return;
                    Navigator.of(context).pop();
                  },
                ),
              ),
          ],
        ),
      ),
    );
    if (mounted) setState(() {});
  }

  Future<void> _changePhoneInfo() async {
    await showSozoConfirm(
      context,
      title: t('c30.changePhone'),
      text: t('c30.changePhoneText'),
      confirmLabel: t('c02.call'),
      cancelLabel: t('common.close'),
    );
  }

  Future<void> _signOut() async {
    final ok = await showSozoConfirm(
      context,
      title: t('c30.signOutTitle'),
      text: t('c30.signOutText'),
      confirmLabel: t('c30.signOut'),
      danger: true,
    );
    if (!ok) return;
    await session.signOut();
    shellTab.value = 0;
  }
}
