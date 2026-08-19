import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:flutter/services.dart';

import '../api/models.dart';
import '../design_tokens.dart';
import '../widgets/figma_icon.dart';
import '../widgets/app_chrome.dart';
import '../widgets/common.dart';
import 'order_screen.dart';
import '../i18n.dart';

/// M-08 «Маршрут дня на карте».
///
/// Пины пронумерованы по порядку ленты — мастер видит не «где заявки»,
/// а «в каком порядке ехать». Тайлы тянутся из сети; без сети карта
/// заменяется списком — точки лежат локально и порядок известен всегда.
class RouteScreen extends StatefulWidget {
  const RouteScreen({super.key, required this.orders});

  final List<OrderCard> orders;

  @override
  State<RouteScreen> createState() => _RouteScreenState();
}

class _RouteScreenState extends State<RouteScreen> {
  bool _tilesFailed = false;

  List<OrderCard> get _located => widget.orders.where((o) => o.lat != null && o.lng != null).toList();

  LatLng get _center {
    final pts = _located;
    if (pts.isEmpty) return const LatLng(41.2995, 69.2401); // Ташкент
    final lat = pts.map((o) => o.lat!).reduce((a, b) => a + b) / pts.length;
    final lng = pts.map((o) => o.lng!).reduce((a, b) => a + b) / pts.length;
    return LatLng(lat, lng);
  }

  /// Навигатор у мастера уже свой — отдаём адрес в буфер, а не навязываем приложение
  Future<void> _navigate(OrderCard o) async {
    await Clipboard.setData(ClipboardData(text: o.address));
    if (mounted) showOk(context, t('route.adresSkopirovanVstavteV'));
  }

  @override
  Widget build(BuildContext context) {
    final located = _located;
    return Scaffold(
      appBar: SozoAppBar(title: t('route.marshrutDnya')),
      body: located.isEmpty || _tilesFailed
          ? _listFallback()
          : Stack(
              children: [
                FlutterMap(
                  options: MapOptions(initialCenter: _center, initialZoom: 12),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'uz.sozo.master',
                      errorTileCallback: (tile, error, stack) {
                        if (!_tilesFailed && mounted) {
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            if (mounted) setState(() => _tilesFailed = true);
                          });
                        }
                      },
                    ),
                    MarkerLayer(
                      markers: located.asMap().entries.map((e) {
                        final o = e.value;
                        return Marker(
                          point: LatLng(o.lat!, o.lng!),
                          width: 36,
                          height: 36,
                          child: GestureDetector(
                            onTap: () => Navigator.of(
                              context,
                            ).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: o.id))),
                            child: _marker(e.key + 1),
                          ),
                        );
                      }).toList(),
                    ),
                  ],
                ),
                Positioned(
                  left: SozoSpace.s16,
                  right: SozoSpace.s16,
                  bottom: SozoSpace.s16,
                  child: SafeArea(child: _routeCard(located)),
                ),
              ],
            ),
    );
  }

  /// Пин: янтарный круг 36, белая обводка 3, номер 14/bold (макет 26:220)
  Widget _marker(int number) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: SozoColors.accent,
        border: Border.all(color: SozoColors.surface, width: 3),
        boxShadow: sozoMarkerShadow,
      ),
      alignment: Alignment.center,
      child: Text(
        '$number',
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.text, height: 1.1),
      ),
    );
  }

  /// Сводка маршрута (макет 26:224): что за день и между какими точками едем
  Widget _routeCard(List<OrderCard> stops) {
    final first = stops.first;
    final last = stops.last;
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.card),
        boxShadow: sozoFloatShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Заголовок ужимается первым: счётчик заявок короткий и должен
              // остаться целым, а вместе они не помещались в ширину телефона
              Flexible(
                child: Text(
                  t('route.marshrutNaSegodnya'),
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
              ),
              const SizedBox(width: SozoSpace.s8),
              Text(
                plural(stops.length, t('route.zayavka'), t('route.zayavki'), t('route.zayavok')),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: SozoColors.accent),
              ),
            ],
          ),
          const SizedBox(height: SozoSpace.s12),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8, vertical: SozoSpace.s4),
                decoration: BoxDecoration(color: toggleActiveBg, borderRadius: BorderRadius.circular(SozoRadius.badge)),
                child: Text(
                  'Stop 1 → ${stops.length}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: SozoColors.text),
                ),
              ),
              const SizedBox(width: SozoSpace.s16),
              Expanded(
                child: Text(
                  '${first.address} → ${last.address}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Без сети или без координат — тот же порядок объезда, только списком
  Widget _listFallback() {
    if (widget.orders.isEmpty) {
      return EmptyView(title: t('route.naSegodnyaZayavokNet'), icon: 'map');
    }
    return ListView(
      padding: const EdgeInsets.all(SozoSpace.s16),
      children: [
        BlockerNote(text: t('route.kartaNedostupnaBezSeti'), icon: 'alert-circle'),
        const SizedBox(height: SozoSpace.s16),
        ...widget.orders.asMap().entries.map(
          (e) => Padding(
            padding: const EdgeInsets.only(bottom: SozoSpace.s8),
            child: SozoCard(
              onTap: () =>
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderScreen(orderId: e.value.id))),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: e.value.isUrgent ? SozoColors.error : SozoColors.accent,
                    ),
                    child: Text(
                      '${e.key + 1}',
                      style: const TextStyle(color: SozoColors.surface, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          e.value.description,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15),
                        ),
                        Text(e.value.address, style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary)),
                      ],
                    ),
                  ),
                  IconButton(icon: const FigmaIcon('navigation', size: 20), onPressed: () => _navigate(e.value)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// M-33 «Карточка помощника» — без конвейера, смет и фото-цикла.
/// Всё это на ведущем: помощник только приезжает и отмечается.
class HelperOrderScreen extends StatelessWidget {
  const HelperOrderScreen({super.key, required this.order, required this.onDepart, required this.onArrive});

  final OrderCard order;
  final VoidCallback onDepart;
  final VoidCallback onArrive;

  @override
  Widget build(BuildContext context) {
    final departed = order.status != 'assigned';
    final arrived = order.arrivedAt != null;
    return Scaffold(
      appBar: SozoAppBar(title: order.number),
      body: ListView(
        padding: const EdgeInsets.all(SozoSpace.s16),
        children: [
          StatusChip(label: t('route.vyPomoschnik'), status: 'assigned', icon: 'users'),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(order.address, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                const SizedBox(height: SozoSpace.s8),
                Text(order.description, style: const TextStyle(fontSize: 15, height: 1.4)),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Row(
              children: [
                const FigmaIcon('banknote', size: 20, color: SozoColors.textSecondary),
                const SizedBox(width: SozoSpace.s12),
                Expanded(child: Text(t('route.fiksZaSessiyu'))),
                Text(formatSoums(order.myShareTiyin), style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s16),
          SozoCard(
            child: Row(
              children: [
                const FigmaIcon('users', size: 20, color: SozoColors.textSecondary),
                const SizedBox(width: SozoSpace.s12),
                Expanded(child: Text(t('route.veduschiyMaster'))),
                TextButton(
                  onPressed: () => showOk(context, t('route.zvonokVeduschemu')),
                  child: Text(t('route.pozvonit')),
                ),
              ],
            ),
          ),
          const SizedBox(height: SozoSpace.s24),
          if (!departed)
            PrimaryButton(label: t('order.vyehal'), onPressed: onDepart)
          else if (!arrived)
            PrimaryButton(label: t('route.naMeste'), onPressed: onArrive)
          else
            BlockerNote(icon: 'alert-circle', text: t('route.ojidaetPodtverjdeniyaVeduscheg')),
          const SizedBox(height: SozoSpace.s16),
          Text(
            t('route.smetuMaterialyIFoto'),
            style: TextStyle(fontSize: 13, color: SozoColors.textSecondary, height: 1.4),
          ),
          const SizedBox(height: SozoSpace.s32),
        ],
      ),
    );
  }
}
