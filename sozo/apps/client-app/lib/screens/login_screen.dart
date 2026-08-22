import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../format.dart';
import '../i18n.dart';
import '../store/session.dart';
import '../widgets/app_chrome.dart';
import '../widgets/blocks.dart';
import '../widgets/brand.dart';
import '../widgets/figma_icon.dart';
import '../widgets/language_sheet.dart';
import 'guest_prices_screen.dart';

/// C-01 → C-02 → C-03. Перенос макета 1:1: `161:1569` sozo-intro-screen,
/// `165:15` login-phone-screen, `167:1587` login-sms-code-screen.
///
/// Один экран с тремя состояниями, а не три маршрута: между шагами
/// переносится номер и таймер повтора, и терять их на push/pop нельзя.
///
/// Согласия в макете живут на экране кода, а не отдельным шагом: внизу одна
/// кнопка — «Ввести код и согласиться». Прежний четвёртый шаг убран, вместе
/// с ним из входа ушло поле имени (в макете его нет; имя остаётся в профиле
/// C-30, где для пустого имени уже есть подсказка).
class LoginFlow extends StatefulWidget {
  const LoginFlow({super.key});

  @override
  State<LoginFlow> createState() => _LoginFlowState();
}

enum _Step { intro, phone, code }

class _LoginFlowState extends State<LoginFlow> {
  _Step _step = _Step.intro;

  final _phone = TextEditingController();
  final _code = TextEditingController();

  String? _error;
  bool _busy = false;
  int _attemptsLeft = 3;

  /// Токен получен, но сессия ещё не зафиксирована: ждём согласий (C-03)
  String? _pendingToken;

  Timer? _timer;
  int _resendIn = 0;

  bool _consentPersonal = false;
  bool _consentMarketing = false;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String get _digits => _phone.text.replaceAll(RegExp(r'\D'), '');
  String get _e164 => '+998$_digits';
  bool get _phoneValid => _digits.length == 9;

  void _startTimer() {
    _timer?.cancel();
    setState(() => _resendIn = 59);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn -= 1);
      if (_resendIn <= 0) t.cancel();
    });
  }

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await session.api.requestOtp(_e164);
      _attemptsLeft = 3;
      _code.clear();
      _startTimer();
      if (mounted) setState(() => _step = _Step.code);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.code == 'USER_BLOCKED') {
        await showSozoConfirm(
          context,
          title: t('c02.blockedTitle'),
          text: t('c02.blockedText'),
          confirmLabel: t('c02.call'),
          cancelLabel: t('common.close'),
        );
      } else {
        showSozoToast(context, e.isOffline ? e.message : t('c02.sendFailed'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Одна кнопка на два действия: проверить код и записать согласия.
  Future<void> _submit() async {
    if (_code.text.length < 5 || !_consentPersonal || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final token = await session.api.verify(_e164, _code.text);
      // Сессия фиксируется только после согласий, поэтому код не сгорает
      _pendingToken = token;
      final me = await session.api.me();
      final consents = (me['consents'] as Map?) ?? const {};
      // Давнему клиенту согласия не переписываем: галочка «новости» на этом
      // экране пустая по умолчанию, и повторная запись молча отписала бы его
      if (consents['personalData'] != true) {
        await session.api.saveConsents({
          'personalData': true,
          'marketing': _consentMarketing,
          'locale': l10n.code,
        });
      }
      await _finish();
    } on ApiError catch (e) {
      if (!mounted) return;
      // Блокировку проверяем до «неверного кода»: она приходит тем же 401, и
      // без этой ветки человеку списывали попытку и предлагали ввести код
      // заново — код, которого ему не присылали
      if (e.code == 'USER_BLOCKED') {
        await showSozoConfirm(
          context,
          title: t('c02.blockedTitle'),
          text: t('c02.blockedText'),
          confirmLabel: t('c02.call'),
          cancelLabel: t('common.close'),
        );
        if (mounted) setState(() => _step = _Step.phone);
      } else if (e.statusCode == 401 || e.code == 'OTP_INVALID') {
        _attemptsLeft -= 1;
        _code.clear();
        if (_attemptsLeft <= 0) {
          await showSozoConfirm(
            context,
            title: t('c03.tooManyTitle'),
            text: t('c03.tooManyText'),
            confirmLabel: t('common.close'),
            cancelLabel: t('c03.changePhone'),
          );
          if (mounted) setState(() => _step = _Step.phone);
        } else {
          setState(() => _error = t('c03.wrongCode', {'left': _attemptsLeft}));
        }
      } else {
        setState(() => _error = e.message);
      }
      session.api.token = null;
    } catch (e) {
      // Любая другая ошибка тоже должна быть видна: молчаливый отказ на экране
      // кода выглядит как «приложение зависло» и не даёт понять, что случилось
      if (mounted) setState(() => _error = '$e');
      session.api.token = null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finish() async {
    await session.signIn(_e164, _pendingToken!);
    await session.refreshMe();
    unawaited(session.api.track('onboarding_completed'));
    unawaited(session.api.track('otp_success'));
  }

  @override
  Widget build(BuildContext context) {
    return switch (_step) {
      _Step.intro => _introScreen(),
      _Step.phone => _phoneScreen(),
      _Step.code => _codeScreen(),
    };
  }

  // ---------------- C-01. Заставка (макет 161:1569) ----------------

  Widget _introScreen() {
    return Scaffold(
      // Единственный экран на белом: ниже фотографии фон не серый, как везде,
      // а белый (162:4)
      backgroundColor: SozoColors.surface,
      body: Stack(
        children: [
          _heroPhoto(),
          SafeArea(
            bottom: false,
            child: Stack(
              children: [
                // Селектор языка в макете лежит поверх блока с логотипом
                // (165:4: right 46, top 56 при статус-баре 44)
                const Positioned(top: SozoSpace.s12, right: 46, child: _LanguageSelector()),
                Column(
                  children: [
                    const SizedBox(height: 80),
                    // Долгое нажатие по знаку открывает адрес сервера: на
                    // телефоне приложение ходит на компьютер в Wi-Fi, а не на
                    // localhost. В макете строки версии нет, поэтому вход в
                    // настройку невидимый — экран от этого не меняется
                    GestureDetector(
                      onLongPress: _editBaseUrl,
                      child: const SozoWordmark(height: 55.97),
                    ),
                    const SizedBox(height: SozoSpace.s16),
                    SizedBox(
                      width: 280,
                      child: Text(
                        t('c01.tagline'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: authMuted,
                        ),
                      ),
                    ),
                    const Spacer(),
                    _introActions(),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Фотография 390×612: в макете снимок отмасштабирован до 1012.79×675 и
  /// сдвинут влево на 106.55 — это кадр, а не «вписать по ширине». Держим ту
  /// же рамку на любой ширине экрана, иначе в кадр попадает другая часть сцены.
  Widget _heroPhoto() {
    final k = MediaQuery.sizeOf(context).width / 390;
    return Positioned(
      left: 0,
      right: 0,
      top: 0,
      height: 612 * k,
      child: ClipRect(
        child: Stack(
          children: [
            Positioned(
              left: -106.55 * k,
              top: 0,
              width: 1012.79 * k,
              height: 675 * k,
              child: Image.asset('assets/photo/intro-hero.jpg', fit: BoxFit.fill),
            ),
          ],
        ),
      ),
    );
  }

  Widget _introActions() {
    return Padding(
      // pb 40 отсчитывается от низа экрана, а не от безопасной зоны: так в
      // макете (162:21) — блок кончается ровно над индикатором «домой»
      padding: const EdgeInsets.fromLTRB(SozoSpace.s24, 0, SozoSpace.s24, 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _AuthButton(
            t('c01.login'),
            height: SozoSize.buttonPrimary,
            color: authAmber,
            onTap: () => setState(() => _step = _Step.phone),
          ),
          // «Продолжить без регистрации» ведёт к ценам «от» по категориям
          // (C-01, экран GuestPricesScreen). Заказать гостем нельзя — заявке
          // нужен телефон, — но узнать порядок цены человек вправе, не отдавая
          // номер.
          //
          // Отступы 3 и 10 вместо 16 и 24 из макета: надпись обёрнута в область
          // нажатия высотой 44 (минимум Apple HIG), и без вычета она разъехалась
          // бы на 27 точек. Сумма от кнопки до карточек та же — 57.
          const SizedBox(height: 3),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _openGuestPrices,
            child: SizedBox(
              height: 44,
              child: Center(
                child: Text(
                  t('c01.guest'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: authInk),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(top: SozoSpace.s12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FeatureCard(icon: 'shield-check-24', label: t('c01.featureVerified')),
                _FeatureCard(icon: 'clock-24', label: t('c01.featureFast')),
                _FeatureCard(icon: 'file-text-24', label: t('c01.featureFair')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _editBaseUrl() => showServerAddressSheet(context);

  /// Цены до входа. Отдельным маршрутом, а не четвёртым состоянием этого
  /// экрана: с шагами входа гостя ничего не связывает, и класть его сюда
  /// значило бы тащить номер и таймер повтора через экран, который их не
  /// касается.
  void _openGuestPrices() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const GuestPricesScreen()),
    );
  }


  // ---------------- C-02. Телефон (макет 165:15) ----------------

  Widget _phoneScreen() {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAuthAppBar(
        title: t('c02.title'),
        onBack: () => setState(() {
          _error = null;
          _step = _Step.intro;
        }),
      ),
      body: _bottomAnchored(
        content: Padding(
          padding: const EdgeInsets.fromLTRB(SozoSpace.s24, 28, SozoSpace.s24, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                t('c02.phoneLabel'),
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: authLabel),
              ),
              const SizedBox(height: SozoSpace.s8),
              _PhoneInput(controller: _phone, onChanged: (_) => setState(() {})),
              const SizedBox(height: SozoSpace.s8),
              Text(t('c02.phoneHint'), style: const TextStyle(fontSize: 13, color: authLabel)),
              const SizedBox(height: 20),
              Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: SozoSpace.s12),
                  child: GestureDetector(
                    onTap: _supportSheet,
                    child: Text(
                      t('c02.cantSignIn'),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: SozoColors.accent,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        bottom: _AuthButton(
          _resendIn > 0 ? t('c02.retryIn', {'time': _mmss(_resendIn)}) : t('c02.getCode'),
          busy: _busy,
          onTap: _phoneValid && _resendIn == 0 ? _requestOtp : null,
        ),
      ),
    );
  }

  Future<void> _supportSheet() async {
    await showSozoSheet<void>(
      context,
      title: t('c02.cantSignIn'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              t('c02.supportSheet', {'phone': '+998 71 200-00-00'}),
              style: const TextStyle(fontSize: 14, height: 1.4, color: SozoColors.textSecondary),
            ),
            const SizedBox(height: SozoSpace.s16),
            SecondaryButton(
              t('c02.call'),
              icon: 'phone',
              onTap: () {
                Navigator.of(context).pop();
                callPhone(context, '+998712000000');
              },
            ),
          ],
        ),
      ),
    );
  }

  // ---------------- C-03. Код и согласия (макет 167:1587) ----------------

  Widget _codeScreen() {
    return Scaffold(
      backgroundColor: SozoColors.bg,
      appBar: SozoAuthAppBar(
        title: t('c03.title'),
        onBack: () => setState(() {
          _error = null;
          _pendingToken = null;
          _step = _Step.phone;
        }),
      ),
      body: _bottomAnchored(
        content: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(SozoSpace.s24, SozoSpace.s24, SozoSpace.s24, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t('c03.sentTo', {'phone': maskedPhone(_e164)}),
                    style: const TextStyle(fontSize: 14, color: authHint),
                  ),
                  const SizedBox(height: SozoSpace.s8),
                  GestureDetector(
                    onTap: () => setState(() => _step = _Step.phone),
                    child: Text(
                      t('c03.changePhone'),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: SozoColors.accent,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  // Боевого SMS-шлюза нет, код всегда «00000». Кнопки для
                  // подстановки в макете не осталось, поэтому она спрятана в
                  // долгое нажатие по ячейкам — на вид экран не меняется
                  GestureDetector(
                    onLongPress: () => setState(() => _code.text = '00000'),
                    child: _CodeField(controller: _code, onChanged: () => setState(() {})),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: SozoSpace.s8),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, color: SozoColors.error),
                    ),
                  ],
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: _resendIn > 0
                        ? Text(
                            t('c03.resendIn', {'time': _mmss(_resendIn)}),
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 14, color: authHint),
                          )
                        : GestureDetector(
                            onTap: _requestOtp,
                            child: Text(
                              t('c03.resend'),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: SozoColors.accent,
                              ),
                            ),
                          ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 74),
            _consentSection(),
          ],
        ),
        bottom: _AuthButton(
          t('c03.submit'),
          busy: _busy,
          onTap: _code.text.length == 5 && _consentPersonal ? _submit : null,
        ),
      ),
    );
  }

  Widget _consentSection() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(SozoSpace.s24, 0, SozoSpace.s24, SozoSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('c04.intro'),
            style: const TextStyle(fontSize: 12, height: 22 / 12, color: authHint),
          ),
          const SizedBox(height: SozoSpace.s12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: SozoColors.surface,
              borderRadius: BorderRadius.circular(SozoRadius.tile),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: _ConsentRow(
                    value: _consentPersonal,
                    onChanged: (v) => setState(() => _consentPersonal = v),
                    text: '${t('c04.personal')} (${t('c04.personalLink')})',
                  ),
                ),
                const Divider(height: 1, thickness: 1, color: authCardDivider),
                Padding(
                  padding: const EdgeInsets.only(top: 20, bottom: SozoSpace.s16),
                  child: _ConsentRow(
                    value: _consentMarketing,
                    onChanged: (v) => setState(() => _consentMarketing = v),
                    text: t('c04.marketing'),
                  ),
                ),
                Text(
                  t('c04.marketingNote'),
                  style: const TextStyle(fontSize: 13, height: 19 / 13, color: authHint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------- Общее ----------------

  /// Раскладка экранов входа: содержимое сверху, кнопка прижата к низу —
  /// в макете это `justify-between` на всю высоту 844.
  Widget _bottomAnchored({required Widget content, required Widget bottom}) {
    return SafeArea(
      top: false,
      child: LayoutBuilder(
        builder: (context, c) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: c.maxHeight),
            child: IntrinsicHeight(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  content,
                  const Spacer(),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      SozoSpace.s24,
                      SozoSpace.s16,
                      SozoSpace.s24,
                      SozoSpace.s12,
                    ),
                    child: bottom,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _mmss(int seconds) {
    final m = seconds ~/ 60, s = seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}

/// Переключатель языка (макет 165:4): белая пилюля с янтарной рамкой.
///
/// Раньше здесь стояли три ячейки с переезжающей подсветкой — на трёх языках
/// это читалось как вкладки. Языков стало десять: в шапку заставки они не
/// помещаются ни в строку, ни в две, а горизонтальная лента из десяти кодов
/// заставляет искать свой язык прокруткой вслепую. Поэтому пилюля показывает
/// текущий язык, а выбор открывается листом со списком названий — тем же,
/// что в профиле, чтобы человек второй раз искал язык там же, где в первый.
class _LanguageSelector extends StatelessWidget {
  const _LanguageSelector();

  static const _height = 28.0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showLanguageSheet(context),
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: _height,
        padding: const EdgeInsets.symmetric(horizontal: SozoSpace.s8),
        decoration: BoxDecoration(
          color: SozoColors.surface,
          borderRadius: BorderRadius.circular(SozoRadius.chip),
          border: Border.all(color: authFeatureBorder),
        ),
        alignment: Alignment.center,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              L10n.shortNames[l10n.code] ?? l10n.code.toUpperCase(),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: authInk,
              ),
            ),
            const SizedBox(width: 2),
            // Стрелка вниз рисуется треугольником, а не иконкой: набор
            // figma-иконок подходящей нет, а Material-иконки в экранах
            // запрещены (DEV-12 правило 3)
            const _Caret(),
          ],
        ),
      ),
    );
  }
}

/// Треугольник 7×4, направленный вниз — метка «откроется список»
class _Caret extends StatelessWidget {
  const _Caret();

  @override
  Widget build(BuildContext context) =>
      const CustomPaint(size: Size(7, 4), painter: _CaretPainter());
}

class _CaretPainter extends CustomPainter {
  const _CaretPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = authMuted);
  }

  @override
  bool shouldRepaint(covariant _CaretPainter oldDelegate) => false;
}

/// Плитка преимущества на заставке (макет 162:27): иконка 24 в поле 56,
/// под ней две строки по 12.
class _FeatureCard extends StatelessWidget {
  const _FeatureCard({required this.icon, required this.label});

  final String icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 100,
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: authFeatureBg,
              borderRadius: BorderRadius.circular(SozoRadius.tile),
              border: Border.all(color: authFeatureBorder),
            ),
            alignment: Alignment.center,
            child: FigmaIcon(icon, size: 24),
          ),
          const SizedBox(height: SozoSpace.s8),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: authInk,
              height: 17 / 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// Кнопка входа (макет 162:23, 165:41): 56 на заставке, 54 на экранах входа,
/// серый неактивный вид — из макета, а не общий `PrimaryButton`.
class _AuthButton extends StatelessWidget {
  const _AuthButton(
    this.label, {
    this.onTap,
    this.busy = false,
    this.height = 54,
    this.color = SozoColors.accent,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null && !busy;
    return SizedBox(
      width: double.infinity,
      height: height,
      child: Material(
        color: enabled ? color : authDisabledBg,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        child: InkWell(
          borderRadius: BorderRadius.circular(SozoRadius.tile),
          onTap: enabled ? onTap : null,
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: authInk),
                  )
                : Text(
                    label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: enabled ? authInk : authDisabledFg,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

/// Поле номера (макет 165:33): «+998» отдельно, вертикальная черта, дальше
/// маска. Рамка янтарная — на этом экране поле всегда в фокусе.
class _PhoneInput extends StatelessWidget {
  const _PhoneInput({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(SozoSpace.s16),
      decoration: BoxDecoration(
        color: SozoColors.surface,
        borderRadius: BorderRadius.circular(SozoRadius.tile),
        border: Border.all(color: SozoColors.accent, width: 1.5),
      ),
      child: Row(
        children: [
          const Text(
            '+998',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: authInk),
          ),
          const SizedBox(width: SozoSpace.s12),
          Container(width: 1, height: 16, color: SozoColors.border),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              autofocus: true,
              keyboardType: TextInputType.phone,
              inputFormatters: [_PhoneMask()],
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: authInk),
              decoration: const InputDecoration(
                isDense: true,
                filled: false,
                contentPadding: EdgeInsets.zero,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                hintText: '90 123-45-67',
                hintStyle: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: authLabel),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Строка согласия (макет 167:1653): квадрат 24 со скруглением 6, текст 12/22.
class _ConsentRow extends StatelessWidget {
  const _ConsentRow({required this.value, required this.onChanged, required this.text});

  final bool value;
  final ValueChanged<bool> onChanged;
  final String text;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      behavior: HitTestBehavior.opaque,
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: value ? SozoColors.accent : SozoColors.surface,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: value ? SozoColors.accent : authCheckboxBorder, width: 1.5),
            ),
            child: value ? const Center(child: FigmaIcon('check-12', size: 12, color: authInk)) : null,
          ),
          const SizedBox(width: SozoSpace.s12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 12, height: 22 / 12, color: authBodyInk),
            ),
          ),
        ],
      ),
    );
  }
}

/// Ячейки кода (макет 167:1641): пять белых плиток 56×64 с мягкой тенью.
/// Плитки рисуются поверх невидимого TextField — так работает системная
/// автоподстановка SMS, а фокус остаётся один на всё поле.
class _CodeField extends StatefulWidget {
  const _CodeField({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final VoidCallback onChanged;

  /// Пять ячеек — длина кода в макете (167:1641)
  static const length = 5;

  @override
  State<_CodeField> createState() => _CodeFieldState();
}

class _CodeFieldState extends State<_CodeField> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.controller.text;
    return Stack(
      children: [
        // На узком экране пять плиток по 56 с зазорами 10 не помещаются
        // в 342 — уменьшаем блок целиком, а не ломаем сетку макета
        Center(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              children: [
                for (var i = 0; i < _CodeField.length; i++) ...[
                  if (i > 0) const SizedBox(width: 10),
                  Container(
                    width: 56,
                    height: 64,
                    decoration: BoxDecoration(
                      color: SozoColors.surface,
                      borderRadius: BorderRadius.circular(SozoRadius.field),
                      boxShadow: authCodeShadow,
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      i < text.length ? text[i] : '',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: authInk),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        Positioned.fill(
          child: Opacity(
            opacity: 0,
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              keyboardType: TextInputType.number,
              maxLength: _CodeField.length,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => widget.onChanged(),
              decoration: const InputDecoration(counterText: '', border: InputBorder.none),
            ),
          ),
        ),
      ],
    );
  }
}

/// Маска «90 123-45-67»: префикс +998 живёт отдельным виджетом и не стирается
class _PhoneMask extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    final d = digits.length > 9 ? digits.substring(0, 9) : digits;
    final buf = StringBuffer();
    for (var i = 0; i < d.length; i++) {
      if (i == 2 || i == 5 || i == 7) buf.write(i == 2 ? ' ' : '-');
      buf.write(d[i]);
    }
    final text = buf.toString();
    return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
  }
}
