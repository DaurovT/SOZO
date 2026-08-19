import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../design_tokens.dart';
import '../i18n.dart';
import 'blocks.dart';
import 'figma_icon.dart';

/// Сетка фото (DEV-08 §1 «Фото»): 3 в ряд, gap 8, скругление карточки,
/// обрезка cover, тап — полноэкранный просмотр.
///
/// Клиенту, в отличие от мастера, галерея разрешена: он снимает проблему
/// заранее и может прислать снимок из переписки с соседом.

/// Источник картинки: data URL (только что снятое) или ссылка на сервер
class PhotoRef {
  const PhotoRef({this.dataUrl, this.url, this.label});

  final String? dataUrl;
  final String? url;

  /// Ярлык «До» / «После» / «В процессе» (DEV-06 §4.9)
  final String? label;

  Uint8List? get bytes {
    final d = dataUrl;
    if (d == null) return null;
    final comma = d.indexOf(',');
    if (comma < 0) return null;
    try {
      return base64Decode(d.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }
}

class PhotoGrid extends StatelessWidget {
  const PhotoGrid({
    super.key,
    required this.photos,
    this.onAdd,
    this.onRemove,
    this.max = 5,
    this.columns = 3,
  });

  final List<PhotoRef> photos;

  /// null — сетка только для просмотра (акт, карточка закрытой заявки)
  final VoidCallback? onAdd;
  final ValueChanged<int>? onRemove;
  final int max;
  final int columns;

  @override
  Widget build(BuildContext context) {
    final showAdd = onAdd != null && photos.length < max;
    final count = photos.length + (showAdd ? 1 : 0);
    if (count == 0) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, c) {
        final side = (c.maxWidth - SozoSpace.s8 * (columns - 1)) / columns;
        return Wrap(
          spacing: SozoSpace.s8,
          runSpacing: SozoSpace.s8,
          children: [
            for (var i = 0; i < photos.length; i++) _tile(context, i, side),
            if (showAdd) _addTile(side),
          ],
        );
      },
    );
  }

  Widget _tile(BuildContext context, int i, double side) {
    final p = photos[i];
    final bytes = p.bytes;
    return SizedBox(
      width: side,
      height: side,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              onTap: () => _openViewer(context, i),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(SozoRadius.thumb),
                child: bytes != null
                    ? Image.memory(bytes, fit: BoxFit.cover, width: side, height: side)
                    : (p.url != null
                        ? Image.network(
                            p.url!,
                            fit: BoxFit.cover,
                            width: side,
                            height: side,
                            errorBuilder: (_, _, _) => _broken(side),
                          )
                        : _broken(side)),
              ),
            ),
          ),
          if (p.label != null)
            Positioned(
              left: SozoSpace.s4,
              bottom: SozoSpace.s4,
              child: TagChip(p.label!, bg: SozoColors.text.withValues(alpha: 0.7), fg: SozoColors.surface),
            ),
          if (onRemove != null)
            Positioned(
              right: 0,
              top: 0,
              // Тап-зона 44 при видимом крестике 24 (чек-лист §6 п.5)
              child: GestureDetector(
                onTap: () => onRemove!(i),
                behavior: HitTestBehavior.opaque,
                child: SizedBox(
                  width: 44,
                  height: 44,
                  child: Center(
                    child: Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: SozoColors.text.withValues(alpha: 0.6),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(child: FigmaIcon('circle-x', size: 14, color: SozoColors.surface)),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _broken(double side) => Container(
        width: side,
        height: side,
        color: SozoColors.chipGrey,
        child: const Center(child: FigmaIcon('image', size: 20, color: SozoColors.textTertiary)),
      );

  Widget _addTile(double side) => SizedBox(
        width: side,
        height: side,
        child: Material(
          color: SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.thumb),
          child: InkWell(
            borderRadius: BorderRadius.circular(SozoRadius.thumb),
            onTap: onAdd,
            child: DottedBorderBox(
              child: const Center(child: FigmaIcon('camera', size: 24, color: SozoColors.textSecondary)),
            ),
          ),
        ),
      );

  void _openViewer(BuildContext context, int index) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => PhotoViewer(photos: photos, initial: index),
      ),
    );
  }
}

/// Пунктирная рамка плитки добавления. Рисуется painter'ом:
/// Border в Flutter пунктир не умеет.
class DottedBorderBox extends StatelessWidget {
  const DottedBorderBox({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _DottedPainter(), child: child);
}

class _DottedPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = SozoColors.border
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      const Radius.circular(SozoRadius.thumb),
    );
    final path = Path()..addRRect(rrect);
    const dash = 6.0, gap = 4.0;
    for (final metric in path.computeMetrics()) {
      var d = 0.0;
      while (d < metric.length) {
        canvas.drawPath(metric.extractPath(d, (d + dash).clamp(0, metric.length)), paint);
        d += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Полноэкранный просмотр: чёрный фон, свайп между фото, счётчик, закрытие вниз
class PhotoViewer extends StatefulWidget {
  const PhotoViewer({super.key, required this.photos, this.initial = 0});

  final List<PhotoRef> photos;
  final int initial;

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer> {
  late final _controller = PageController(initialPage: widget.initial);
  late int _index = widget.initial;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SozoColors.text,
      body: GestureDetector(
        onVerticalDragEnd: (d) {
          if ((d.primaryVelocity ?? 0) > 300) Navigator.of(context).pop();
        },
        child: SafeArea(
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const FigmaIcon('circle-x', size: 24, color: SozoColors.surface),
                  ),
                  Text(
                    '${_index + 1} из ${widget.photos.length}',
                    style: const TextStyle(fontSize: 14, color: SozoColors.surface),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
              Expanded(
                child: PageView.builder(
                  controller: _controller,
                  itemCount: widget.photos.length,
                  onPageChanged: (i) => setState(() => _index = i),
                  itemBuilder: (_, i) {
                    final p = widget.photos[i];
                    final bytes = p.bytes;
                    return InteractiveViewer(
                      child: Center(
                        child: bytes != null
                            ? Image.memory(bytes)
                            : (p.url != null
                                ? Image.network(p.url!, errorBuilder: (_, _, _) => _fail())
                                : _fail()),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _fail() => const FigmaIcon('image', size: 48, color: SozoColors.textSecondary);
}

/// Лист выбора источника: камера или галерея (DEV-08 C-07).
/// Возвращает data URL снимка либо null.
Future<String?> pickPhoto(BuildContext context) async {
  final source = await showSozoSheet<ImageSource>(
    context,
    title: t('photo.sheetTitle'),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SecondaryButton(
            t('photo.camera'),
            icon: 'camera',
            onTap: () => Navigator.of(context).pop(ImageSource.camera),
          ),
          const SizedBox(height: SozoSpace.s8),
          SecondaryButton(
            t('photo.gallery'),
            icon: 'image',
            onTap: () => Navigator.of(context).pop(ImageSource.gallery),
          ),
        ],
      ),
    ),
  );
  if (source == null) return null;
  try {
    // Сжатие до ~1600 px делает сам image_picker: клиент не должен ждать
    // выгрузки мегабайтов на мобильном интернете (DEV-08 C-07)
    final file = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 70);
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    final mime = file.mimeType ?? (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    return 'data:$mime;base64,${base64Encode(bytes)}';
  } catch (_) {
    // Отказ в доступе к камере — не ошибка приложения, экран просто не получает фото
    return null;
  }
}
