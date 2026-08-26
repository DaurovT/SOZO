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
  /// Штрихи хранятся в долях от размера холста, а не в точках экрана.
  ///
  /// Поворот телефона или появление клавиатуры меняют размер поля, и подпись,
  /// записанная в точках, уезжала за край или пропадала совсем — а расписался
  /// клиент уже один раз, второй раз просить неловко.
  final List<List<Offset>> _strokes = [];
  final _nameCtrl = TextEditingController();
  bool _busy = false;

  /// Размер поля на последней отрисовке — по нему нормируем и восстанавливаем
  Size _canvas = Size.zero;

  bool get _hasSignature => _strokes.any((s) => s.length > 2);

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || _canvas.isEmpty) return;
    setState(() => _busy = true);
    try {
      // Растр в физических пикселях, а не в логических: подпись — юридический
      // документ, а на экране 3x получалось ~350×400 точек, то есть мыло,
      // на котором в споре ничего не разобрать
      final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0);
      final size = _canvas;
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, size.width * dpr, size.height * dpr));
      canvas.scale(dpr);
      canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), Paint()..color = SozoColors.surface);
      paintSignature(canvas, size, _strokes);
      final img = await recorder.endRecording().toImage(
        (size.width * dpr).round(),
        (size.height * dpr).round(),
      );
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

  /// Начало штриха. Список мог опустеть между нажатием и движением — если
  /// в этот момент нажали «Стереть», `_strokes.last` бросал исключение
  void _startStroke(Offset local, Size size) {
    _canvas = size;
    setState(() => _strokes.add([_norm(local, size)]));
  }

  void _extendStroke(Offset local, Size size) {
    _canvas = size;
    setState(() {
      if (_strokes.isEmpty) _strokes.add(<Offset>[]);
      _strokes.last.add(_norm(local, size));
    });
  }

  Offset _norm(Offset p, Size size) =>
      Offset(size.width == 0 ? 0 : p.dx / size.width, size.height == 0 ? 0 : p.dy / size.height);

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
                decoration: BoxDecoration(
                  color: SozoColors.surface,
                  border: Border.all(color: SozoColors.border, width: 2),
                  borderRadius: BorderRadius.circular(SozoRadius.card),
                ),
                clipBehavior: Clip.antiAlias,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final size = constraints.biggest;
                    // Размер поля запоминаем на отрисовке: по нему нормируются
                    // штрихи и по нему же собирается растр при отправке
                    _canvas = size;
                    return GestureDetector(
                      onPanStart: (d) => _startStroke(d.localPosition, size),
                      onPanUpdate: (d) => _extendStroke(d.localPosition, size),
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
                    );
                  },
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

/// Один код рисует и на экране, и в файле: расхождение между тем, что видел
/// клиент, и тем, что уехало на сервер, в подписи недопустимо
void paintSignature(Canvas canvas, Size size, List<List<Offset>> strokes) {
  final paint = Paint()
    ..color = SozoColors.text
    ..strokeWidth = 2.5
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  Offset at(Offset p) => Offset(p.dx * size.width, p.dy * size.height);
  for (final stroke in strokes) {
    if (stroke.length < 2) continue;
    final path = Path()..moveTo(at(stroke.first).dx, at(stroke.first).dy);
    for (final p in stroke.skip(1)) {
      final o = at(p);
      path.lineTo(o.dx, o.dy);
    }
    canvas.drawPath(path, paint);
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes);

  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) => paintSignature(canvas, size, strokes);

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
