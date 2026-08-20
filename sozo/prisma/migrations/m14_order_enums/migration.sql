-- Виды доп-сметы и необязательные поля заявки.
--
-- Перечень QuoteKind знал одно значение `additional`, а код различает две
-- доп-сметы с разными последствиями: вынужденная блокирует конвейер и
-- требует фото, апсейл никогда не автостартует. Одно значение их смешивало,
-- и по журналу нельзя было отличить «пришлось» от «предложили».
--
-- Релиз прайса у заявки становится необязательным: аварийная создаётся
-- минуя оценку, и до сметы привязывать её к прайсу не к чему.
--
-- Ключ фото в хранилище тоже необязателен: отметка диспетчера «фото у
-- мастера есть» файла не имеет, и NOT NULL заставлял бы выдумывать имя.

ALTER TYPE "QuoteKind" ADD VALUE IF NOT EXISTS 'additional_forced';
ALTER TYPE "QuoteKind" ADD VALUE IF NOT EXISTS 'additional_upsell';

ALTER TABLE "order"     ALTER COLUMN price_list_release_id DROP NOT NULL;
ALTER TABLE order_photo ALTER COLUMN s3_key DROP NOT NULL;
