import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../widgets/app_chrome.dart';
import '../design_tokens.dart';
import 'common.dart';
import '../i18n.dart';

/// Подпись пальцем (DEV-09 П-3). Применяется там, где клиент подтверждает
/// оффлайн: приёмка работ, согласование сметы без сети, представитель на осмотре.
/// Результат — PNG в base64, уходит на сервер вместе с пакетом операции.
class SignaturePad extends StatefulWidget {
  const SignaturePad({super.key, required this.title, required this.subtitle, this.signerLabel});

  final String title;
  final String subtitle;
  final String? signerLabel;

  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  final List<List<Offset>> _strokes = [];
  final _nameCtrl = TextEditingController();
  final _canvasKey = GlobalKey();
  bool _busy = false;

  bool get _hasSignature => _strokes.any((s) => s.length > 2);

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final box = _canvasKey.currentContext!.findRenderObject() as RenderBox;
      final size = box.size;
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, size.width, size.height));
      canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), Paint()..color = SozoColors.surface);
      _paintStrokes(canvas);
      final img = await recorder.endRecording().toImage(size.width.round(), size.height.round());
      final data = await img.toByteData(format: ui.ImageByteFormat.png);
      final b64 = base64Encode(data!.buffer.asUint8List());
      if (!mounted) return;
      Navigator.of(context).pop((dataUrl: 'data:image/png;base64,$b64', signerName: _nameCtrl.text.trim()));
    } catch (e) {
      if (mounted) {
        showError(context, e);
        setState(() => _busy = false);
      }
    }
  }

  void _paintStrokes(Canvas canvas) {
    final paint = Paint()
      ..color = SozoColors.text
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final stroke in _strokes) {
      if (stroke.length < 2) continue;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: SozoAppBar(title: widget.title),
      body: Padding(
        padding: const EdgeInsets.all(SozoSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.subtitle, style: const TextStyle(fontSize: 15, color: SozoColors.textSecondary, height: 1.4)),
            const SizedBox(height: SozoSpace.s16),
            if (widget.signerLabel != null) ...[
              TextField(
                controller: _nameCtrl,
                decoration: InputDecoration(
                  labelText: widget.signerLabel,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(SozoRadius.button)),
                ),
              ),
              const SizedBox(height: SozoSpace.s16),
            ],
            Expanded(
              child: Container(
                key: _canvasKey,
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  border: Border.all(color: SozoColors.border, width: 2),
                  borderRadius: BorderRadius.circular(SozoRadius.card),
                ),
                clipBehavior: Clip.antiAlias,
                child: GestureDetector(
                  onPanStart: (d) => setState(() => _strokes.add([d.localPosition])),
                  onPanUpdate: (d) => setState(() => _strokes.last.add(d.localPosition)),
                  child: CustomPaint(
                    painter: _SignaturePainter(_strokes),
                    size: Size.infinite,
                    child: _hasSignature
                        ? null
                        : Center(
                            child: Text(
                              t('sign.raspishitesPalcem'),
                              style: TextStyle(color: SozoColors.textSecondary, fontSize: 16),
                            ),
                          ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: SozoSpace.s12),
            Row(
              children: [
                Expanded(
                  child: SecondaryButton(
                    label: t('sign.steret'),
                    onPressed: _hasSignature ? () => setState(_strokes.clear) : null,
                  ),
                ),
              ],
            ),
            const SizedBox(height: SozoSpace.s12),
            PrimaryButton(label: t('sign.podtverditPodpis'), busy: _busy, onPressed: _hasSignature ? _submit : null),
          ],
        ),
      ),
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes);

  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = SozoColors.text
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final stroke in strokes) {
      if (stroke.length < 2) continue;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter old) => true;
}

typedef SignatureResult = ({String dataUrl, String signerName});

Future<SignatureResult?> captureSignature(
  BuildContext context, {
  required String title,
  required String subtitle,
  String? signerLabel,
}) {
  return Navigator.of(context).push<SignatureResult>(
    MaterialPageRoute(
      builder: (_) => SignaturePad(title: title, subtitle: subtitle, signerLabel: signerLabel),
    ),
  );
}
