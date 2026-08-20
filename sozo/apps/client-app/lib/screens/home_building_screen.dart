import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/figma_icon.dart';

/// C-51 «Мой дом» (PRD-01 §3.N, DEV-15 §10.3).
///
/// Раздел появляется только у жителя подключённого объекта. Для всех остальных
/// приложение выглядит ровно как в v2.25 — ни одного нового элемента.
///
/// Первым блоком — аварийная служба. Не потому, что она используется чаще,
/// а потому что в момент, когда она нужна, искать её некогда.
class HomeBuildingScreen extends StatefulWidget {
  const HomeBuildingScreen({super.key});

  @override
  State<HomeBuildingScreen> createState() => _HomeBuildingScreenState();
}

class _HomeBuildingScreenState extends State<HomeBuildingScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await session.api.get('/app/my-building');
      if (!mounted) return;
      setState(() {
        _data = Map<String, dynamic>.from(r as Map);
        _loading = false;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _call(String? phone) async {
    if (phone == null || phone.isEmpty) return;
    await launchUrl(Uri.parse('tel:$phone'));
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('building.moyDom')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      _emergencyCard(d),
                      const SizedBox(height: SozoSpace.s16),
                      if (_shutdowns(d).isNotEmpty) ...[
                        _shutdownCard(_shutdowns(d).first),
                        const SizedBox(height: SozoSpace.s16),
                      ],
                      _actions(),
                      const SizedBox(height: SozoSpace.s24),
                      if (_announcements(d).isNotEmpty) _announcementsBlock(d),
                    ],
                  ),
                ),
    );
  }

  Widget _errorView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const FigmaIcon('alert-circle', size: 40, color: SozoColors.textSecondary),
              const SizedBox(height: SozoSpace.s12),
              Text(t('building.neUdalosZagruzit'), textAlign: TextAlign.center),
              const SizedBox(height: SozoSpace.s12),
              SecondaryButton(t('common.retry'), onTap: _load),
            ],
          ),
        ),
      );

  List<dynamic> _shutdowns(Map<String, dynamic>? d) => (d?['shutdowns'] as List?) ?? const [];
  List<dynamic> _announcements(Map<String, dynamic>? d) => (d?['announcements'] as List?) ?? const [];

  /// Аварийный телефон крупно и первым: его ищут в панике.
  Widget _emergencyCard(Map<String, dynamic>? d) {
    final phone = d?['emergencyPhone'] as String?;
    return SozoCard(
      children: [
        Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(color: SozoColors.error, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: const FigmaIcon('phone', size: 22, color: Colors.white),
            ),
            const SizedBox(width: SozoSpace.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t('building.avariynayaSluzhba'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: SozoSpace.s4),
                  Text(phone ?? t('building.telefonNeUkazan'),
                      style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                ],
              ),
            ),
            if (phone != null) SmallButton(t('building.pozvonit'), onTap: () => _call(phone)),
          ],
        ),
      ],
    );
  }

  Widget _shutdownCard(dynamic s) {
    final m = Map<String, dynamic>.from(s as Map);
    return SozoBanner(
      tone: BannerTone.warn,
      icon: 'zap',
      title: t('building.otklyuchenie', {'p1': '${m['resourceLabel'] ?? m['resourceType']}'}),
      text: '${m['windowText'] ?? ''}\n${m['reason'] ?? ''}',
    );
  }

  Widget _actions() {
    return SozoCard(
      children: [
        CardTitle(t('building.chtoMozhno')),
        _row('alert-triangle', t('building.problemaVDome'), t('building.peredadimVUk'), () {
          Navigator.of(context).pushNamed('/building/report');
        }),
        const SozoDivider(),
        _row('calendar', t('building.otklyucheniyaIRaboty'), t('building.kalendarRabot'), () {
          Navigator.of(context).pushNamed('/building/shutdowns');
        }),
        const SozoDivider(),
        _row('credit-card', t('building.propuskGostyu'), t('building.qrZa10Sekund'), () {
          Navigator.of(context).pushNamed('/building/pass');
        }),
      ],
    );
  }

  Widget _row(String icon, String title, String subtitle, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
          child: Row(
            children: [
              FigmaIcon(icon, size: 22, color: SozoColors.textSecondary),
              const SizedBox(width: SozoSpace.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                  ],
                ),
              ),
              const FigmaIcon('chevron-right', size: 18, color: SozoColors.textTertiary),
            ],
          ),
        ),
      );

  Widget _announcementsBlock(Map<String, dynamic>? d) {
    return SozoCard(
      children: [
        CardTitle(t('building.obyavleniyaUk')),
        for (final a in _announcements(d)) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: SozoSpace.s8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${(a as Map)['body'] ?? ''}', style: const TextStyle(fontSize: 14, height: 1.4)),
                const SizedBox(height: SozoSpace.s4),
                Text('${a['dateText'] ?? ''}',
                    style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary)),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
