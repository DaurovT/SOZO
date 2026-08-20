import 'package:flutter/material.dart';

import '../api/models.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import '../main.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../widgets/figma_icon.dart';
import 'badge_screen.dart';
import 'outbox_screen.dart';
import 'profile_extras.dart';
import 'resources_screens.dart';
import 'walkthrough_screen.dart';

/// «Профиль» (M-39): кто вы в системе и всё, что настраивается.
///
/// Пункты сгруппированы по смыслу: сначала документ, который показывают клиенту,
/// потом работа и допуски, потом настройки. Плоский список из пятнадцати
/// одинаковых плашек прочитать нельзя — глазу не за что зацепиться.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _shiftBusy = false;

  Future<void> _toggleShift(bool value) async {
    setState(() => _shiftBusy = true);
    try {
      await session.setOnline(value);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _shiftBusy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) maybeAskNps(context);
    });
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final p = session.profile;
    if (p == null) return EmptyView(title: t('prof.profilNedostupen'), icon: 'user');

    final docsPending = p.documents.where((d) => d.status != 'verified').length;

    // Шапка над списком, а не внутри него: белая полоса должна идти
    // во всю ширину и оставаться на месте при прокрутке
    return Column(
      children: [
        SozoTabHeader(t('prof.profil')),
        Expanded(child: _content(p, docsPending)),
      ],
    );
  }

  Widget _content(MasterProfile p, int docsPending) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, SozoSpace.s32),
      children: [
        _userCard(p),
        const SizedBox(height: 20),
        _onlineCard(p),
        const SizedBox(height: 20),
        _idCard(p),
        const SizedBox(height: 20),

        NavGroup(
          title: t('prof.rabota'),
          children: [
            NavRow(
              icon: 'trending-up',
              title: t('prof.reytingIApellyacii'),
              subtitle: t('prof.izChegoSkladyvaetsyaVash'),
              onTap: () => _open(const RatingScreen()),
            ),
            NavRow(
              icon: 'wrench',
              title: t('prof.proverkaInstrumenta'),
              subtitle: t('prof.bezPolnogoNaboraNavyk2'),
              onTap: () => _open(const ToolCheckScreen()),
            ),
            NavRow(icon: 'shopping-bag', title: t('prof.sumkaRashodnikov'), onTap: () => _open(const StockScreen())),
            NavRow(
              icon: 'map-pin',
              title: t('walk.obhod'),
              subtitle: t('walk.obhodTolkoDlyaShtata'),
              onTap: () => _open(WalkBuildingsScreen(session: session)),
            ),
            NavRow(
              icon: 'clipboard',
              title: t('walk.moiZamechaniya'),
              onTap: () => _open(MyObservationsScreen(session: session)),
            ),
            NavRow(
              icon: 'archive',
              title: t('common.moeOborudovanie'),
              onTap: () => _open(const EquipmentFullScreen()),
            ),
          ],
        ),
        const SizedBox(height: SozoSpace.s16),

        NavGroup(
          title: t('prof.dokumentyIDopuski'),
          children: [
            NavRow(
              icon: 'file-text',
              title: t('prof.moiDokumenty'),
              subtitle: docsPending == 0 ? t('prof.vseProvereny') : t('prof.jdutProverki', {'p1': docsPending}),
              trailing: docsPending == 0 ? const DoneBadge() : FigmaStatusChip(label: '$docsPending', status: 'new'),
              onTap: () => _open(DocumentsListScreen(documents: p.documents)),
            ),
            NavRow(
              icon: 'shield-check',
              title: t('prof.moiDopuski'),
              subtitle: p.skillTags.isEmpty ? t('prof.dopuskovNet') : p.skillTags.map(tv).join(' · '),
              onTap: () => _open(SkillsScreen(skills: p.skillTags)),
            ),
            NavRow(
              icon: 'map-20',
              title: t('prof.zonyVyezda'),
              subtitle: p.zones.isEmpty ? t('prof.neNaznacheny') : p.zones.map(tv).join(' · '),
            ),
          ],
        ),
        const SizedBox(height: SozoSpace.s16),

        NavGroup(
          title: t('order.esche'),
          children: [
            NavRow(
              icon: 'circle-x',
              title: t('prof.privediMastera'),
              subtitle: t('prof.bonusPosle20Ego'),
              onTap: () => _open(const ReferralScreen()),
            ),
            NavRow(
              icon: 'arrow-up-right',
              title: t('sync.ocheredOtpravki'),
              subtitle: session.outbox.depth == 0
                  ? t('prof.vseSinhronizirovano')
                  : t('prof.vOcheredi', {'p1': session.outbox.depth}),
              trailing: session.outbox.depth == 0
                  ? const DoneBadge(soft: true)
                  : FigmaStatusChip(label: '${session.outbox.depth}', status: 'master_departed'),
              onTap: () => _open(const OutboxScreen()),
            ),
            NavRow(icon: 'globe', title: t('prof.yazykInterfeysa'), trailing: const LanguageSwitch()),
            NavRow(icon: 'globe', title: t('prof.server'), subtitle: session.baseUrl),
          ],
        ),
        const SizedBox(height: 20),

        _logoutButton(),
        const SizedBox(height: 20),
        Text(
          t('prof.sozoMaster', {'p1': Session.appVersion}),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
        ),
      ],
    );
  }

  /// Карточка мастера (макет 58:307): аватар 68, имя 18/bold, чипы грейда
  Widget _userCard(MasterProfile p) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 68,
                height: 68,
                child: Stack(
                  children: [
                    Container(
                      width: 68,
                      height: 68,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: SozoColors.accent, shape: BoxShape.circle),
                      child: Text(
                        p.fullName.isEmpty ? '?' : p.fullName.characters.first.toUpperCase(),
                        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: SozoColors.onAccent),
                      ),
                    ),
                    // Точка «на линии» — единственный признак смены на этом экране
                    if (p.online) const Positioned(bottom: 2, right: 2, child: FigmaIcon('status-indicator', size: 16)),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p.fullName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: SozoColors.text),
                    ),
                    const SizedBox(height: SozoSpace.s4),
                    Text(p.phone, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s16),
          const FigmaDivider(),
          const SizedBox(height: SozoSpace.s16),
          Row(
            children: [
              _gradeChip('sparkles', p.gradeTitle, softSuccessBg, softSuccessFg),
              const SizedBox(width: SozoSpace.s8),
              _gradeChip('star', t('prof.reyting', {'p1': p.rating}), softWarnBg, SozoColors.text),
            ],
          ),
        ],
      ),
    );
  }

  Widget _gradeChip(String icon, String label, Color bg, Color fg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SozoRadius.chip)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          FigmaIcon(icon, size: 12),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg),
          ),
        ],
      ),
    );
  }

  /// Смена (макет 73:4): кружок-состояние 36 и тумблер 44×24
  Widget _onlineCard(MasterProfile p) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(color: SozoColors.surface, borderRadius: BorderRadius.circular(SozoRadius.card)),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: p.online ? softSuccessFg : SozoColors.textSecondary,
              shape: BoxShape.circle,
            ),
            child: const FigmaIcon('circle', size: 18),
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  p.online ? t('prof.naLinii') : t('prof.neRabotayu'),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
                const SizedBox(height: 2),
                Text(
                  p.online ? t('prof.vyPoluchaeteZayavki') : t('prof.pokaSmenaZakrytaZayavki'),
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: SozoSpace.s12),
          if (_shiftBusy)
            const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
          else
            SozoSwitch(value: p.online, onChanged: _toggleShift),
        ],
      ),
    );
  }

  /// Удостоверение (макет 58:324) — отдельной карточкой: это рабочий документ,
  /// а не пункт меню
  Widget _idCard(MasterProfile p) {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.card),
        onTap: () => _open(BadgeScreen(profile: p, verifyBaseUrl: 'https://sozo.uz')),
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Row(
            children: [
              const IconBadge('id-card', size: 40, iconSize: 24, radius: SozoRadius.thumb, background: softWarnBg),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t('badge.udostoverenieSpecialista'),
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                    ),
                    SizedBox(height: 2),
                    Text(
                      t('prof.pokazatKlientuVDveryah'),
                      style: TextStyle(fontSize: 12, color: SozoColors.textSecondary, height: 1.2),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: SozoSpace.s12),
              const FigmaIcon('chevron-right', size: 16),
            ],
          ),
        ),
      ),
    );
  }

  /// Выход (макет 58:442): белая кнопка с красной рамкой — действие редкое,
  /// но должно быть заметным
  Widget _logoutButton() {
    return Material(
      color: SozoColors.surface,
      borderRadius: BorderRadius.circular(SozoRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        onTap: session.logout,
        child: Container(
          constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
          padding: const EdgeInsets.symmetric(vertical: 14),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(SozoRadius.tile),
            border: Border.all(color: softDangerFg),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              FigmaIcon('arrow-left-to-line', size: 20),
              SizedBox(width: 10),
              Text(
                t('prof.vyytiIzAkkaunta'),
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: softDangerFg),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Документы: что проверено, что ждёт, что отклонено
class DocumentsListScreen extends StatelessWidget {
  const DocumentsListScreen({super.key, required this.documents});

  final List<({String name, String status})> documents;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('prof.moiDokumenty')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 40),
        children: [
          Material(
            color: SozoColors.surface,
            borderRadius: BorderRadius.circular(SozoRadius.card),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < documents.length; i++) ...[
                  if (i > 0) const FigmaDivider(),
                  StatusListRow(
                    icon: 'shield-check',
                    title: documents[i].name,
                    // Статус словом, а не только галочкой: «Отклонён» надо прочитать
                    status: switch (documents[i].status) {
                      'verified' => t('onb.prinyat'),
                      'uploaded' => t('onb.naProverke'),
                      'rejected' => t('prof.otklonenPeresnimite'),
                      _ => t('onb.neZagrujen'),
                    },
                    tone: switch (documents[i].status) {
                      'verified' => StatusTone.ok,
                      'rejected' => StatusTone.bad,
                      _ => StatusTone.pending,
                    },
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          AdminNote(icon: 'info', text: t('prof.dokumentyProveryaetAdministrat')),
        ],
      ),
    );
  }
}

/// Допуски: по каким работам приходят заявки и как открыть новый
class SkillsScreen extends StatelessWidget {
  const SkillsScreen({super.key, required this.skills});

  final List<String> skills;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: t('prof.moiDopuski')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s16, SozoSpace.s16, 30),
        children: [
          if (skills.isEmpty)
            EmptyView(title: t('prof.dopuskovNet'), subtitle: t('prof.zayavkiPrihodyatTolkoPo'), icon: 'shield-check')
          else
            Material(
              color: SozoColors.surface,
              borderRadius: BorderRadius.circular(SozoRadius.card),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (var i = 0; i < skills.length; i++) ...[
                    if (i > 0) const FigmaDivider(),
                    StatusListRow(
                      icon: 'shield',
                      // Навык уходит на сервер русским, мастеру показываем перевод
                      title: tv(skills[i]),
                      status: t('prof.ekzamenSdanInstrumentPodtverjd'),
                      tone: StatusTone.ok,
                      titleBold: true,
                    ),
                  ],
                ],
              ),
            ),
          const SizedBox(height: SozoSpace.s16),
          AdminNote(icon: 'lock', text: t('prof.novyyDopuskOtkryvaetsyaTolko')),
          const SizedBox(height: SozoSpace.s16),
          Builder(
            builder: (ctx) => Material(
              color: SozoColors.surface,
              borderRadius: BorderRadius.circular(SozoRadius.card),
              child: InkWell(
                borderRadius: BorderRadius.circular(SozoRadius.card),
                onTap: () => _requestSkill(ctx),
                child: Container(
                  constraints: const BoxConstraints(minHeight: SozoSize.buttonPrimary),
                  padding: const EdgeInsets.all(SozoSpace.s16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(SozoRadius.card),
                    border: Border.all(color: SozoColors.accent, width: 1.5),
                  ),
                  child: Center(
                    child: Text(
                      t('prof.zaprositNovyyDopusk'),
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: SozoColors.text),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _requestSkill(BuildContext context) async {
    final ctrl = TextEditingController();
    final skill = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(t('prof.novyyDopusk')),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: InputDecoration(labelText: t('prof.kakoyNavykHotiteOtkryt')),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(t('common.otmena'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: Text(t('common.otpravit'))),
        ],
      ),
    );
    if (skill == null || skill.isEmpty || !context.mounted) return;
    try {
      final r = await session.api.requestSkill(skill);
      if (context.mounted) showOk(context, (r['message'] ?? t('prof.zayavkaPrinyata')).toString());
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}
