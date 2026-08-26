import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../design_tokens.dart';
import '../i18n.dart';
import 'blocks.dart';

/// Четыре состояния экрана одним местом (DEV-08 §1, чек-лист §6 п.4).
///
/// Без этого каждый экран пишет загрузку, пустоту, ошибку и офлайн заново —
/// и на четвёртом экране про офлайн уже забывают. Здесь же живёт правило
/// «в офлайне показываем кеш и баннер», а не белый экран.
class AsyncView<T> extends StatefulWidget {
  const AsyncView({
    super.key,
    required this.load,
    required this.builder,
    this.skeleton,
    this.onData,
  });

  final Future<T> Function() load;

  /// `reload` передаётся внутрь: кнопки экрана после действия обновляют данные
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  /// Скелетон под форму будущего контента; по умолчанию — список карточек
  final Widget Function()? skeleton;

  /// Побочный эффект на свежих данных (телеметрия, обновление сессии)
  final void Function(T data)? onData;

  @override
  State<AsyncView<T>> createState() => AsyncViewState<T>();
}

class AsyncViewState<T> extends State<AsyncView<T>> {
  T? _data;
  String? _error;
  bool _loading = true;

  /// Данные показаны из кеша, сеть недоступна
  bool _offline = false;

  /// Последняя попытка сорвалась именно на связи, а не на ответе сервера.
  /// Отдельно от `_offline`: тот включается, только когда данные уже были
  bool _connectionFailed = false;

  /// Конфликт версий уже перечитывали — второй раз не повторяем
  bool _retriedConflict = false;

  /// Номер последней начатой загрузки.
  ///
  /// Флага «идёт загрузка» мало: перезагрузку зовут и таймер опроса, и
  /// pull-to-refresh, и кнопки экрана после действия. Два запроса уходят
  /// внахлёст, медленный первый возвращается после быстрого второго — и
  /// карточка откатывается к устаревшему состоянию: «мастер в пути» поверх
  /// уже показанного «выполнена». Отвечаем только на последний запрос.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    final generation = ++_generation;
    // Устарел, пока летел: ответ на прошлый запрос не должен затирать более
    // свежий — ни данными, ни ошибкой, ни снятым признаком загрузки
    bool stale() => !mounted || generation != _generation;

    if (mounted) setState(() => _loading = _data == null);
    try {
      final data = await widget.load();
      if (stale()) return;
      widget.onData?.call(data);
      _retriedConflict = false;
      setState(() {
        _data = data;
        _error = null;
        _offline = false;
        _connectionFailed = false;
        _loading = false;
      });
    } on ApiError catch (e) {
      if (stale()) return;
      // 409 при чтении означает, что данные под нами поменялись. Просить
      // человека «обновить экран» незачем — обновляемся сами, один раз,
      // чтобы не уйти в петлю, если сервер отвечает так всегда
      if (e.statusCode == 409 && !_retriedConflict) {
        _retriedConflict = true;
        unawaited(reload());
        return;
      }
      setState(() {
        _loading = false;
        // Сеть пропала, а данные уже были — показываем их с баннером,
        // а не выбрасываем пользователя на экран ошибки
        _connectionFailed = e.isOffline;
        if (e.isOffline && _data != null) {
          _offline = true;
        } else {
          _error = e.message;
        }
      });
    } catch (e) {
      if (stale()) return;
      setState(() {
        _loading = false;
        _error = humanError(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) {
      return widget.skeleton?.call() ?? const SkeletonList();
    }
    if (_data == null) {
      // Сервер не ответил. Человеку — одна фраза и кнопка «Позвонить в
      // поддержку»; правка адреса стенда осталась под долгим нажатием по
      // значку ошибки — на экране входа человека уже нет, а больше это поле
      // нигде не открыть
      return ErrorState(
        message: _error ?? t('error.offline'),
        onRetry: reload,
        onEditServer: _connectionFailed
            ? () async {
                await showServerAddressSheet(context);
                await reload();
              }
            : null,
      );
    }
    return Column(
      children: [
        if (_offline) const OfflineBar(),
        Expanded(
          child: RefreshIndicator(
            color: SozoColors.accent,
            onRefresh: reload,
            child: widget.builder(context, _data as T, reload),
          ),
        ),
      ],
    );
  }
}
