import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../main.dart';
import '../widgets/brand.dart';
import '../widgets/common.dart';
import '../widgets/figma_blocks.dart';
import '../i18n.dart';

/// Вход по телефону и коду (M-00).
///
/// Адрес сервера меняется прямо здесь: браузер ходит на localhost, телефон —
/// на IP компьютера в той же Wi-Fi, боевой аппарат — на домен. Одна сборка на всё.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneCtrl = TextEditingController(text: '+998');
  final _codeCtrl = TextEditingController();
  final _serverCtrl = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  bool _serverOpen = false;

  @override
  void initState() {
    super.initState();
    _phoneCtrl.text = session.lastPhone ?? '+998';
    _serverCtrl.text = session.baseUrl;
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _codeCtrl.dispose();
    _serverCtrl.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final phone = _phoneCtrl.text.trim();
    if (!RegExp(r'^\+998\d{9}$').hasMatch(phone)) {
      showError(context, t('login.telefonVFormate998xxxxxxxxx'));
      return;
    }
    setState(() => _busy = true);
    try {
      await session.api.requestOtp(phone);
      if (mounted) setState(() => _codeSent = true);
    } on ApiError catch (e) {
      if (mounted) showError(context, e.isOffline ? t('login.serverNedostupen', {'p1': session.baseUrl}) : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() => _busy = true);
    try {
      await session.login(_phoneCtrl.text.trim(), _codeCtrl.text.trim());
      if (session.accessDeniedMessage != null && mounted) {
        showError(context, session.accessDeniedMessage!);
      }
    } on ApiError catch (e) {
      if (mounted) showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          // Без Center колонка прижимается к левому краю на всём, что шире 420
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(SozoSpace.s24, 0, SozoSpace.s24, SozoSpace.s24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Логотип не в самом верху: экран открывается с клавиатурой,
                    // и снизу должно остаться место под кнопку (макет 77:5)
                    const SizedBox(height: 144),
                    const SizedBox(height: 20),
                    const Center(child: SozoWordmark(height: 50)),
                    const SizedBox(height: SozoSpace.s16),
                    Center(
                      child: Text(
                        t('login.prilojenieMastera'),
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: SozoColors.textSecondary),
                      ),
                    ),
                    // Язык переключается до входа: иначе узбекоязычный кандидат
                    // должен сперва пройти русский экран, чтобы найти переключатель
                    const SizedBox(height: SozoSpace.s16),
                    const Center(child: LanguageSwitch()),
                    SizedBox(height: _codeSent ? 36 : 34),
                    if (session.accessDeniedMessage != null) ...[
                      BlockerNote(text: session.accessDeniedMessage!, icon: 'alert-circle'),
                      const SizedBox(height: SozoSpace.s16),
                    ],
                    FloatingLabelField(
                      label: t('login.telefon'),
                      icon: 'phone',
                      controller: _phoneCtrl,
                      enabled: !_codeSent,
                      keyboardType: TextInputType.phone,
                    ),
                    if (!_codeSent) const SizedBox(height: SozoSpace.s24),
                    if (_codeSent) ...[
                      const SizedBox(height: SozoSpace.s16),
                      FloatingLabelField(
                        label: t('login.kodIzSms'),
                        controller: _codeCtrl,
                        active: true,
                        keyboardType: TextInputType.number,
                        maxLength: 5,
                        autofocus: true,
                        onChanged: (_) => setState(() {}),
                      ),
                      FieldCounter(current: _codeCtrl.text.length, total: 5),
                      const SizedBox(height: SozoSpace.s8),
                    ],
                    PrimaryButton(
                      label: _codeSent ? t('login.voyti') : t('login.poluchitKod'),
                      busy: _busy,
                      onPressed: _codeSent ? _verify : _requestCode,
                    ),
                    if (_codeSent) ...[
                      const SizedBox(height: SozoSpace.s16),
                      Center(
                        child: InkWell(
                          onTap: () => setState(() => _codeSent = false),
                          child: Padding(
                            padding: EdgeInsets.all(SozoSpace.s8),
                            child: Text(
                              t('login.izmenitNomer'),
                              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: SozoColors.accent),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: SozoSpace.s8),
                      Center(
                        child: Text(
                          t('login.testovyyKonturKod00000'),
                          style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                        ),
                      ),
                    ],
                    const SizedBox(height: SozoSpace.s24),
                    // Адрес сервера в макете не нарисован, но без него не войти
                    // ни с браузера, ни с телефона: контуры разные
                    if (!_serverOpen)
                      Center(
                        child: InkWell(
                          onTap: () => setState(() => _serverOpen = true),
                          child: Padding(
                            padding: const EdgeInsets.all(SozoSpace.s8),
                            child: Text(
                              session.baseUrl,
                              style: const TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                            ),
                          ),
                        ),
                      )
                    else ...[
                      FloatingLabelField(label: t('login.adresServera'), controller: _serverCtrl),
                      const SizedBox(height: SozoSpace.s8),
                      Text(
                        t('login.vBrauzereLocalhostNa'),
                        style: TextStyle(fontSize: 12, color: SozoColors.textSecondary),
                      ),
                      const SizedBox(height: SozoSpace.s12),
                      SecondaryButton(
                        label: t('login.sohranitAdres'),
                        onPressed: () async {
                          await session.setBaseUrl(_serverCtrl.text);
                          if (mounted) setState(() => _serverOpen = false);
                        },
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
