import 'package:flutter/material.dart';

import '../../api/client.dart';
import '../../design_tokens.dart';
import '../../i18n.dart';
import '../../store/session.dart';
import '../../widgets/app_chrome.dart';
import '../../widgets/async_view.dart';
import '../../widgets/blocks.dart';
import '../../widgets/photo_grid.dart';

/// C-34. Код приёмки.
///
/// Код и кнопка — одно и то же действие, и это сказано прямо: иначе человек
/// решит, что назвать код мастеру недостаточно, и будет искать «настоящую» кнопку.
class AcceptanceScreen extends StatefulWidget {
  const AcceptanceScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<AcceptanceScreen> createState() => _AcceptanceScreenState();
}

class _AcceptanceScreenState extends State<AcceptanceScreen> {
  final _key = GlobalKey<AsyncViewState<Map<String, dynamic>>>();
  bool _busy = false;

  Future<void> _accept() async {
    setState(() => _busy = true);
    try {
      final r = await session.api.siteAccept(widget.orderId, {});
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject() async {
    final controller = TextEditingController();
    final reason = await showSozoSheet<String>(
      context,
      title: t('c34.rejectTitle'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SozoField(label: t('c34.rejectWhat'), controller: controller, maxLines: 3),
            PrimaryButton(t('common.send'), onTap: () => Navigator.of(context).pop(controller.text.trim())),
          ],
        ),
      ),
    );
    if (reason == null || reason.isEmpty || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await session.api.siteAccept(widget.orderId, {'accept': false, 'reason': reason});
      if (!mounted) return;
      showSozoToast(context, (r['message'] as String?) ?? '');
      Navigator.of(context).pop();
    } on ApiError catch (e) {
      if (mounted) showSozoToast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAppBar(title: t('c34.title')),
      body: SafeArea(
        child: AsyncView<Map<String, dynamic>>(
          key: _key,
          load: () => session.api.acceptanceInfo(widget.orderId),
          builder: (context, data, reload) {
            final accepted = data['accepted'] == true;
            final code = (data['code'] as String?) ?? '';
            final photos = ((data['photos'] as List?) ?? const []).cast<Map<String, dynamic>>();
            final rejections = ((data['rejections'] as List?) ?? const []).cast<Map<String, dynamic>>();

            if (accepted) {
              return EmptyState(icon: 'check-done', text: t('c34.acceptedState'));
            }

            return Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(SozoSpace.s16),
                    children: [
                      SozoCard(
                        children: [
                          Text(
                            (data['number'] as String?) ?? '',
                            style: const TextStyle(fontSize: 13, color: SozoColors.textSecondary),
                          ),
                          Center(
                            child: Text(
                              code.split('').join(' '),
                              style: const TextStyle(
                                fontSize: 44,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 4,
                                color: SozoColors.text,
                                fontFeatures: moneyFeatures,
                              ),
                            ),
                          ),
                          Text(
                            t('c34.hint'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 14, height: 1.4, color: SozoColors.textSecondary),
                          ),
                        ],
                      ),
                      if (rejections.isNotEmpty) ...[
                        const SizedBox(height: SozoSpace.s12),
                        for (final r in rejections)
                          Padding(
                            padding: const EdgeInsets.only(bottom: SozoSpace.s8),
                            child: SozoBanner(
                              icon: 'rotate-ccw',
                              tone: BannerTone.warn,
                              title: t('c34.previousReject'),
                              text: (r['reason'] as String?) ?? '',
                            ),
                          ),
                      ],
                      if (photos.isNotEmpty) ...[
                        const SizedBox(height: SozoSpace.s16),
                        SectionHeading(t('c34.photosAfter')),
                        const SizedBox(height: SozoSpace.s8),
                        PhotoGrid(
                          photos: [
                            for (final p in photos)
                              PhotoRef(url: _absolute(p['url'] as String?), label: t('photo.after')),
                          ],
                        ),
                      ],
                      if (data['requested'] != true) ...[
                        const SizedBox(height: SozoSpace.s16),
                        SozoBanner(icon: 'clock', text: t('c34.notRequested')),
                      ],
                    ],
                  ),
                ),
                StickyFooter(
                  children: [
                    PrimaryButton(
                      t('c34.confirm'),
                      busy: _busy,
                      onTap: data['requested'] == true ? _accept : null,
                    ),
                    DangerTextButton(t('c34.reject'), onTap: data['requested'] == true ? _reject : null),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// Сервер отдаёт путь без токена — фото точки открываются в сессии приложения
  static String? _absolute(String? path) {
    if (path == null) return null;
    if (path.startsWith('http')) return path;
    final token = session.api.token ?? '';
    return '${session.api.baseUrl}$path$token';
  }
}
