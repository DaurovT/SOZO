# infra

- `docker-compose.yml` — PostgreSQL 16, Redis 7, MinIO (S3) для dev/stage.
- CI/CD (M0-E1-S2): GitFlow-lite — `main`=prod (ручной gate), `develop`=stage (автодеплой), PR с ≥1 аппрувом, красный пайплайн блокирует merge (DEV-04 §3).
- Миграции — только файлами Prisma; ручные ALTER на prod запрещены (DEV-04 §3).
- Бэкапы: PITR (WAL) + ежедневный полный дамп, копия во второй бакет в УЗ; тест восстановления ежеквартально (DEV-04 §4).
- ЗРУ-547: продовые ПДн — только на серверах в Узбекистане (DEV-04 §2).
