-- Прогон таймера: «запущен руками», а не «вхолостую».
--
-- Колонка называлась simulated, и это неправда. В коде значение true ставят
-- ручной запуск из админки и прогон дней вперёд, а расписание ставит false.
-- Никакого «вхолостую» при этом нет: побочные действия выполняются в обоих
-- случаях одинаково, флаг влияет только на то, писать ли в журнал пустой тик.
--
-- Имя, которое врёт, хуже отсутствующего: читающий журнал видит «simulated»
-- и решает, что напоминания клиентам не уходили, — а они ушли.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'timer_run' AND column_name = 'simulated') THEN
    ALTER TABLE timer_run RENAME COLUMN simulated TO manual;
  END IF;
END $rename$;
