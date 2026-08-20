import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import '../i18n.dart';
import 'wallet_screen.dart';

/// M-46 «Моя выработка» (DEV-09, DEV-15 §7.1).
///
/// Замещает кошелёк M-34 у сотрудника эксплуатирующей организации: он на
/// окладе, и доли с заработком ему показывать нечего. Денежных величин здесь
/// нет вовсе — и это обеспечено сервером, а не фильтрацией на экране.
///
/// Экран read-only и кешируемый: сотрудник смотрит его в подвале и на кровле,
/// поэтому цифры сопровождаются меткой давности, а не притворяются свежими.
class OutputScreen extends StatefulWidget {
  /// `initial` приходит от обёртки, которая уже сходила за этими же данными,
  /// чтобы решить, какую вкладку показать. Без него экран делал второй
  /// одинаковый запрос при каждом открытии вкладки
  const OutputScreen({super.key, this.initial});

  final Map<String, dynamic>? initial;

  @override
  State<OutputScreen> createState() => _OutputScreenState();
}

class _OutputScreenState extends State<OutputScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _data = widget.initial;
    if (_data == null) _load();
  }

  Future<void> _load() async {
    try {
      final r = await session.api.output();
      if (!mounted) return;
      setState(() {
        _data = r;
        _error = null;
        _offline = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      // Офлайн не стирает уже показанные цифры: у сотрудника в подвале лучше
      // старые данные с честной меткой, чем пустой экран
      setState(() {
        _offline = e.isOffline;
        if (_data == null) _error = e.message;
      });
    }
  }

  String _hours(int minutes) {
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '$h ${t('output.chas')}' : '$h ${t('output.chas')} $m ${t('output.min')}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return _error != null
          ? EmptyView(title: t('output.nedostupna'), subtitle: _error, icon: 'alert-circle')
          : const Center(child: CircularProgressIndicator());
    }

    final period = (d['period'] as Map?) ?? const {};
    final shift = (d['shift'] as Map?) ?? const {};
    final orders = (d['orders'] as Map?) ?? const {};
    final sla = (d['sla'] as Map?) ?? const {};
    final walks = (d['walkthroughs'] as Map?) ?? const {};
    final obs = (d['observations'] as Map?) ?? const {};
    final buildings = ((d['buildings'] as List?) ?? const []).cast<Map<String, dynamic>>();

    final green = (sla['green'] as num?)?.toInt() ?? 0;
    final amber = (sla['amber'] as num?)?.toInt() ?? 0;
    final red = (sla['red'] as num?)?.toInt() ?? 0;
    final rated = green + amber + red;

    return Column(
      children: [
        SozoTabHeader(t('output.title')),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s16, SozoSpace.s8, SozoSpace.s16, SozoSpace.s24),
              children: [
                if (_offline) ...[
                  BlockerNote(text: t('output.danneyeIzKesha'), icon: 'cloud-off'),
                  const SizedBox(height: SozoSpace.s12),
                ],
                Text(
                  '${period['from'] ?? ''} — ${period['to'] ?? ''}',
                  style: const TextStyle(fontSize: 13, color: SozoColors.textTertiary),
                ),
                const SizedBox(height: SozoSpace.s12),

                SozoCard(
                  child: Column(
                    children: [
                      InfoRow(
                        label: t('output.chasovVSmenah'),
                        value: _hours((shift['plannedMinutes'] as num?)?.toInt() ?? 0),
                        icon: 'clock',
                      ),
                      InfoRow(
                        label: t('output.smen'),
                        value: '${(shift['days'] as num?)?.toInt() ?? 0}',
                        icon: 'calendar',
                      ),
                      InfoRow(
                        label: t('output.zakrytoZayavok'),
                        value: '${(orders['closed'] as num?)?.toInt() ?? 0}',
                        icon: 'check-done',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: SozoSpace.s12),

                SozoCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t('output.sla'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      const SizedBox(height: SozoSpace.s8),
                      if (rated == 0)
                        Text(t('output.slaPusto'), style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary))
                      else ...[
                        InfoRow(label: t('output.vSrok'), value: '$green', valueColor: SozoColors.success),
                        InfoRow(label: t('output.naGrani'), value: '$amber', valueColor: SozoColors.warning),
                        InfoRow(label: t('output.prosrocheno'), value: '$red', valueColor: SozoColors.error),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: SozoSpace.s12),

                SozoCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t('output.reglamenty'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      const SizedBox(height: SozoSpace.s8),
                      InfoRow(
                        label: t('output.obhodovProvedeno'),
                        value: '${(walks['done'] as num?)?.toInt() ?? 0}',
                        icon: 'navigation',
                      ),
                      InfoRow(
                        label: t('output.obhodovZhdet'),
                        value: '${(walks['due'] as num?)?.toInt() ?? 0}',
                        icon: 'clock',
                      ),
                      InfoRow(
                        label: t('output.zamechaniyZafiksirovano'),
                        value: '${(obs['created'] as num?)?.toInt() ?? 0}',
                        icon: 'alert-circle',
                      ),
                      InfoRow(
                        label: t('output.zamechaniyUstraneno'),
                        value: '${(obs['resolved'] as num?)?.toInt() ?? 0}',
                        icon: 'check-done',
                      ),
                    ],
                  ),
                ),

                if (buildings.isNotEmpty) ...[
                  const SizedBox(height: SozoSpace.s12),
                  SozoCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t('output.obekty'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: SozoSpace.s8),
                        ...buildings.map(
                          (b) => Padding(
                            padding: const EdgeInsets.only(bottom: 4),
                            child: InfoRow(
                              label: (b['name'] ?? '').toString(),
                              value: (b['address'] ?? '').toString(),
                              icon: 'home',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                // Совмещающий работает и на платформу: его заработок по свободным
                // сменам живёт в кошельке, и путь туда обязан остаться
                const SizedBox(height: SozoSpace.s16),
                TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => Scaffold(
                        appBar: AppBar(title: Text(t('money.koshelek'))),
                        body: const WalletScreen(),
                      ),
                    ),
                  ),
                  child: Text(t('output.otkrytKoshelek')),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Что показать на вкладке: выработку или кошелёк.
///
/// Спецификация говорит «по владельцу текущей смены», но владельца у смены в
/// модели пока нет, поэтому признак приходит с сервера по аффилиации — состоит
/// ли человек в штате хоть одного объекта. Пока решение не принято, вкладка
/// показывает кошелёк: он привычнее и никогда не бывает лишним.
class WalletOrOutputScreen extends StatefulWidget {
  const WalletOrOutputScreen({super.key});

  @override
  State<WalletOrOutputScreen> createState() => _WalletOrOutputScreenState();
}

class _WalletOrOutputScreenState extends State<WalletOrOutputScreen> {
  bool? _operatorStaff;
  Map<String, dynamic>? _output;

  @override
  void initState() {
    super.initState();
    _decide();
  }

  Future<void> _decide() async {
    try {
      final r = await session.api.output();
      if (!mounted) return;
      setState(() {
        _output = r;
        _operatorStaff = r['isOperatorStaff'] == true;
      });
    } on ApiError {
      // Связи нет — показываем кошелёк: он умеет работать по кешу
      if (mounted) setState(() => _operatorStaff = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_operatorStaff == null) return const Center(child: CircularProgressIndicator());
    return _operatorStaff! ? OutputScreen(initial: _output) : const WalletScreen();
  }
}
