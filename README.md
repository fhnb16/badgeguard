# BadgeGuard v1.3 — инспекция и безопасный OTA бейджей E87 (JieLi AC707N)

Web Bluetooth SPA, fail-closed. ТЗ v1.0 + Дополнение №1 (целостность: L0/L1/L2, HASH_RANGE, сертификаты дампов).
**Только своё железо, research-use. Кирпич восстанавливается только USB-ISP.**

## Быстрый старт
- `dist-single/index.html` — один файл, открыть через `localhost` или HTTPS в Chrome/Edge/Brave/Opera (десктоп, Android).
- `dist/` — PWA-сборка (manifest + service worker, офлайн), раздавать как статику.
- Node ≥ 18, зависимостей нет: `node tests/run.mjs`, `node build.mjs` (сборка), `npm run check` (оба).

## Структура
```
build.mjs                 сборщик src → dist-single/ + dist/ (порядок модулей — ORDER)
tests/run.mjs             unit + mock: правила §7, CRC/SHA-векторы, HASH_RANGE, валидатор дампа
src/shell.html            разметка (%CSP% %HEAD% %CSS% %JS%)   src/styles.css
src/core/core.js          профили, движок правил (R-CHIP…R-PROBE, R-FORM, R-DUMP-INTEG), самотесты
src/protocol/hash.js      CAPS 0xD7 + HASH_RANGE 0xD5 (FD00)
src/integrity/core.js     формы/срезы, verifyFlash (L0/L1/L2 + калибровка), validateDump, async-самотесты
src/integrity/session.js  post-flash верификация, readback, дамп, HMAC-сертификаты, панель Integrity
src/adapters/ports.js     PORT-адаптеры (см. ниже)        src/ble/transport.js  GATT-очередь, reconnect
src/protocol/{jl-auth,auth,meta,testmode}.js  шифр, handshake, bootstrap/паспорт, BLE-дамп    src/image/image.js    разбор образа в Web Worker
src/ota/flasher.js        машина состояний, preflight, окна, resume, interlocks
src/ui/*  src/state/*  src/util/*  src/main.js  src/pwa/*
```

## PORT-адаптеры
| Адаптер | Статус | Источник |
|---|---|---|
| `AUTH` | **портирован**: шифр `src/protocol/jl-auth.js`, handshake по qix-ble `auth.py`; 4 вектора (ТЗ + 3 KAT, два с железа E87) | web-bluetooth-e87 `jl-auth.ts` (MIT) |
| `READBACK` | **портирован**: `src/protocol/testmode.js` — 0xA0 → 0xAA `<addr LE32><len LE32>` → 0xA6 | qix-ble `cli.py cmd_dump` (MIT) |
| Bootstrap Phase 1–5 | **портирован**: `src/protocol/meta.js` | qix-ble `bootstrap.py` |
| `UFW.parse` | не портирован → R-KEY/R-UBOOT/R-CRC/R-GEOM BLOCK | `ufw-repack` |
| `QIX.*` (OTA) | не портирован → R-PATH BLOCK | qix-ble `update_manager.py` |
| `JL.*` | не портирован → сертификат дампа не `verified` | `jl-flash-decrypt` |

## Исправления относительно ТЗ (сверено с референсами и HIL 2026-11-15)
- **Характеристики FD00 не существует.** `C2E6FD00` — сервис; Qix-команды (в т.ч. `0xC0 REQ_UPDATE`, CAPS/HASH_RANGE) — 9E-кадры в FD02, ответы FD01/FD03.
- 9E-кадр: `[9E][chk = sum(bytes[2:]) & FF][flags][cmd][len LE16][payload]`; пример времени в ТЗ имел неверную сумму; год — **LE**.
- Батарея: стандартный 2A19 пуст; уровень приходит push-кадром `0x27 [mode, percent]` после auth + bootstrap.
- Профиль ключа «A» (6BE9…) есть только в README референсов, их код использует 0677… — удалён.
- FD05 не подписываем: по qix-ble это вызывает silent reject `REQ_UPDATE`.
- SDK-строка `jl_sdk_ac707…` в BLE-трафике AC707N не подтверждена (в референсах встречается только `ac697`) → профиль пока не определяется автоматически.
- ElectronicCats рекомендуют дамп **проводом** как источник для restore; BLE-дамп (TEST_MODE) — резерв, после него обязателен power-cycle.

## Тесты
`node tests/run.mjs` — 56 unit/mock; `npm i -D jsdom && node tests/sim.mjs` — интеграция с виртуальным E87 (auth, bootstrap, фрагменты, батарея, дамп).

## Не реализовано
RCSP restore-передача (`RCSP_READY=false` → R-PATH BLOCK), патч прошивки `qix_hash.c`, async `0xD6`, full double-read, mock полного OTA-цикла, docs/PROTOCOL.md и SAFETY.md.
