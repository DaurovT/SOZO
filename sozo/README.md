# SOZO (рабочее название USTAPRO) — монорепозиторий

Платформа технического сервиса (Ташкент). Структура — по **DEV-07** (обязательная), схема данных — **DEV-02**, API-контракт — **DEV-03**, графы статусов — **DEV-10**.

## Структура

```
apps/
  api/            NestJS-монолит — единственный бэкенд (16 модулей, DEV-07 §2)
  admin-web/      React SPA: админ + бухгалтерия (PRD-04)
  dispatcher-web/ React SPA: диспетчерская (PRD-03)
  landing/        Next.js SSR: лендинги + веб-карточка + верификация мастера (PRD-06)
  client-app/     Flutter: приложение «Клиент» (PRD-01, DEV-08)
  master-app/     Flutter: приложение «Мастер», офлайн-first (PRD-02, DEV-09)
packages/
  contracts/      Единственный источник типов API (enum'ы DEV-03, схемы запросов)
  kernel/         Money (BIGINT тийины), StateMachine (исполнитель графов DEV-10), outbox-интерфейсы
  config/         Общие tsconfig/линт-правила
prisma/           Одна схема на весь монолит (DEV-02)
infra/            docker-compose (PostgreSQL, Redis, MinIO), заготовка CI
```

## Правила зависимостей (DEV-07 §3 — нарушение = отклонённый PR)

1. Все модули могут зависеть от `kernel` и `platform`; **ни один — от `billing`**.
2. `billing` подписан на события (`order.closed`, …) и не импортирует доменные модули.
3. Статус заявки меняется **только** через сервис переходов (`orders`), граф — из `kernel` по DEV-10.
4. Внешние API — только через порты/адаптеры в `integrations`.
5. Веб-приложения ходят только в HTTP API по типам из `contracts`.

## Быстрый старт (dev, in-memory — без Docker и БД)

```bash
npm install && npm run build   # workspaces: contracts → kernel → api
npm test                       # тесты kernel: Money + StateMachine (графы DEV-10)
npm run api                    # бэкенд      → http://localhost:3000/v1
npm run admin                  # админка     → http://localhost:5173
cd apps/dispatcher-web && npm run dev   # диспетчерская → http://localhost:5174
```

**Dev-вход:** любой телефон `+998XXXXXXXXX`, OTP-код всегда `00000` (заглушка, решение владельца).
Сид-пользователи: `+998900000000` админ · `+998900000001` бухгалтер · `+998900000002` диспетчер.
Данные in-memory: рестарт API сбрасывает к сид-состоянию (прайс — из Excel-каталога v33).

Позже (M0-E2-S1): `cd infra && docker compose up -d` → `npm run prisma:migrate` → замена in-memory репозиториев на Prisma.
Flutter-приложения: `cd apps/client-app && flutter run` (аналогично master-app).

## Деньги

Все суммы — `BIGINT` в **тийинах** (1 сум = 100 тийин, DEV-02). Округление до 100 сум: списания — в пользу клиента, начисления — в пользу мастера (ТЗ 8.1). Float в денежном коде запрещён — используйте `Money` из `@sozo/kernel`.
