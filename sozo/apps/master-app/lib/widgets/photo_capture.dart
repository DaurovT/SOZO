import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../design_tokens.dart';
import 'figma_icon.dart';
import 'common.dart';
import '../i18n.dart';

/// Съёмка фото стадии (DEV-09 П-2 «Обязательная камера», экраны M-13, M-27).
///
/// Кнопки галереи здесь нет физически: снимок делается на месте работ,
/// иначе фотодоказательство теряет смысл в споре (ТЗ 7.2). Сжатие до ~1600 px
/// делает сам image_picker — мастер не должен ждать выгрузки мегабайтов на 3G.
class PhotoCaptureSheet extends StatefulWidget {
  const PhotoCaptureSheet({
    super.key,
    required this.title,
    required this.stage,
    required this.alreadyTaken,
    required this.onUpload,
    this.minRequired = 1,
    this.maxPhotos = 10,
    this.hint,
    this.frontCamera = false,
  });

  final String title;
  final String stage;
  final int alreadyTaken;
  final int minRequired;
  final int maxPhotos;
  final String? hint;

  /// Селфи мастера (фото лица) снимается фронтальной камерой, работы — основной
  final bool frontCamera;

  /// Возвращает true, если снимок принят (или лёг в офлайн-очередь)
  final Future<bool> Function(String dataUrl) onUpload;

  @override
  State<PhotoCaptureSheet> createState() => _PhotoCaptureSheetState();
}

class _PhotoCaptureSheetState extends State<PhotoCaptureSheet> {
  final _picker = ImagePicker();
  final List<Uint8List> _taken = [];
  bool _busy = false;

  int get _total => widget.alreadyTaken + _taken.length;
  bool get _enough => _total >= widget.minRequired;

  Future<void> _shoot() async {
    if (_total >= widget.maxPhotos) return;
    setState(() => _busy = true);
    try {
      final file = await _picker.pickImage(
        source: ImageSource.camera, // только камера — галерея недоступна намеренно
        maxWidth: 1600,
        imageQuality: 70,
        preferredCameraDevice: widget.frontCamera ? CameraDevice.front : CameraDevice.rear,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      final mime = file.mimeType ?? (file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      final ok = await widget.onUpload('data:$mime;base64,${base64Encode(bytes)}');
      if (ok && mounted) setState(() => _taken.add(bytes));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SozoSpace.s16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Счётчик выровнен по первой строке заголовка: на узких экранах
              // (375–390) заголовок переносится, и по центру он вставал криво
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ),
                  const SizedBox(width: SozoSpace.s8),
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(
                      t('photo.fotoIz', {'p1': _total, 'p2': widget.maxPhotos}),
                      style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary),
                    ),
                  ),
                ],
              ),
              if (widget.hint != null) ...[
                const SizedBox(height: SozoSpace.s8),
                Text(widget.hint!, style: const TextStyle(fontSize: 14, color: SozoColors.textSecondary, height: 1.4)),
              ],
              const SizedBox(height: SozoSpace.s16),
              SizedBox(
                height: 72,
                child: _total == 0
                    ? Center(
                        child: Text(t('photo.snimkovPokaNet'), style: TextStyle(color: SozoColors.textSecondary)),
                      )
                    : ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          for (var i = 0; i < widget.alreadyTaken; i++)
                            Container(
                              width: 56,
                              height: 56,
                              margin: const EdgeInsets.only(right: SozoSpace.s8),
                              decoration: BoxDecoration(
                                color: SozoColors.success.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(SozoRadius.button),
                              ),
                              child: const FigmaIcon('check-16', size: 16, color: SozoColors.success),
                            ),
                          for (final b in _taken)
                            Container(
                              width: 56,
                              height: 56,
                              margin: const EdgeInsets.only(right: SozoSpace.s8),
                              clipBehavior: Clip.antiAlias,
                              decoration: BoxDecoration(borderRadius: BorderRadius.circular(SozoRadius.button)),
                              child: Image.memory(b, fit: BoxFit.cover),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: SozoSpace.s16),
              Center(
                child: GestureDetector(
                  onTap: _busy || _total >= widget.maxPhotos ? null : _shoot,
                  child: Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _total >= widget.maxPhotos ? SozoColors.border : SozoColors.accent,
                    ),
                    child: _busy
                        ? const Padding(
                            padding: EdgeInsets.all(SozoSpace.s24),
                            child: CircularProgressIndicator(strokeWidth: 2, color: SozoColors.surface),
                          )
                        : const FigmaIcon('camera', size: 32, color: SozoColors.surface),
                  ),
                ),
              ),
              const SizedBox(height: SozoSpace.s8),
              Center(
                child: Text(
                  t('photo.tolkoSemkaNaMeste'),
                  style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
              PrimaryButton(
                label: _enough ? t('common.gotovo') : t('photo.snimiteHotyaByFoto', {'p1': widget.minRequired}),
                onPressed: _enough ? () => Navigator.of(context).pop(true) : null,
              ),
              const SizedBox(height: SozoSpace.s8),
            ],
          ),
        ),
      ),
    );
  }
}

Future<bool> showPhotoCapture(
  BuildContext context, {
  required String title,
  required String stage,
  required int alreadyTaken,
  required Future<bool> Function(String dataUrl) onUpload,
  int minRequired = 1,
  int maxPhotos = 10,
  String? hint,
  bool frontCamera = false,
}) async {
  final r = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: SozoColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SozoRadius.card))),
    builder: (_) => PhotoCaptureSheet(
      title: title,
      stage: stage,
      alreadyTaken: alreadyTaken,
      onUpload: onUpload,
      minRequired: minRequired,
      maxPhotos: maxPhotos,
      hint: hint,
      frontCamera: frontCamera,
    ),
  );
  return r ?? false;
}
