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

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    if (mounted) setState(() => _loading = _data == null);
    try {
      final data = await widget.load();
      if (!mounted) return;
      widget.onData?.call(data);
      setState(() {
        _data = data;
        _error = null;
        _offline = false;
        _connectionFailed = false;
        _loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
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
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) {
      return widget.skeleton?.call() ?? const SkeletonList();
    }
    if (_data == null) {
      // Сервер не ответил — предлагаем починить адрес прямо здесь: на экране
      // входа человека уже нет, а больше это поле нигде не открыть
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
