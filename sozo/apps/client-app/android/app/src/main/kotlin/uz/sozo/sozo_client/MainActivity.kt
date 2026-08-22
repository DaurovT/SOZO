package uz.sozo.sozo_client

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

/**
 * Каналы уведомлений Android (PRD-02 §5, PRD-01 §5).
 *
 * Заводятся здесь, а не из Dart: канал должен существовать в момент, когда
 * система показывает уведомление, — в том числе когда приложение полностью
 * закрыто и Dart-кода в процессе нет вовсе. Без объявленного канала Android 8+
 * либо не покажет уведомление, либо покажет его тихо: оффер на шестьдесят
 * секунд придёт без звука и будет пропущен.
 *
 * Каналов два, потому что важность у событий разная. Срочное (оффер, авария,
 * решение по доп-работе) обязано будить экран и звучать; обычное (оплата
 * прошла, баллы начислены) — не обязано, и разбудить им человека ночью значит
 * научить его отключать уведомления целиком.
 *
 * Важность канала после создания меняет только пользователь — приложение
 * повторным созданием её не переопределит. Это ограничение системы, и оно
 * правильное: раз человек приглушил канал, вернуть громкость обновлением
 * приложения нельзя.
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel("sozo_urgent", "Срочное", NotificationManager.IMPORTANCE_HIGH)
            )
            manager.createNotificationChannel(
                NotificationChannel("sozo_default", "Уведомления", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
    }
}
