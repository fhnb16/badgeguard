# BadgeGuard v1.1 — инспекция и безопасный OTA бейджей E87 (JieLi AC707N)

Web Bluetooth SPA, fail-closed. ТЗ v1.0 + Дополнение №1 (целостность: L0/L1/L2, HASH_RANGE, сертификаты дампов).
**Только своё железо, research-use. Кирпич восстанавливается только USB-ISP.**

## Быстрый старт
- `dist-single/index.html` — один файл, открыть через `localhost` или HTTPS в Chrome/Edge/Brave/Opera (десктоп, Android).
- `dist/` — PWA-сборка (manifest + service worker, офлайн), раздавать как статику.
- Node ≥ 18, зависимостей нет: `node tests/run.mjs` (50 тестов), `node build.mjs` (сборка), `npm run check` (оба).

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
src/protocol/auth.js meta.js   auth-handshake, паспорт    src/image/image.js    разбор образа в Web Worker
src/ota/flasher.js        машина состояний, preflight, окна, resume, interlocks
src/ui/*  src/state/*  src/util/*  src/main.js  src/pwa/*
```

## PORT-адаптеры (wire-детали не выдумываются; без порта → BLOCK / partial / unverified)
| Адаптер | Источник | Контракт |
|---|---|---|
| `AUTH.encrypt` | auracast `jl-auth.ts`, e87_badge `jieli_auth.py` | `(data16, {key,magic}) → Uint8Array(16)`; профиль активен только при прохождении вектора |
| `UFW.parse` | jieli-ble-badge-research `ufw-repack/jltech` | kind, chipkey, ubootHash, appBinSize, crc{hdr,list,data,qix}, geometry, version, **flashBin, appBin, internalJlCrcOk** |
| `QIX.*` | `qix-ble` + `ROBUSTNESS.md` | begin, sendWindow→`{crcOk}`, resume (без 0xC0), apply→`{wholeFileCrcOk}`, probe, abort?, enterService? |
| `READBACK.dumpRange` | `qix dump --type flash` | `(ctx, addr, len, onProgress) → Uint8Array`, ставит TEST_MODE |
| `JL.*` | `jl-flash-decrypt` | decrypt, parseHeader, verifyCrcs, layoutOk |

## Наблюдения HIL (E87, 2026-11-15)
- GATT: сервис `C2E6FD00` есть, но характеристик только `FD01…FD05` (FD03 — read/write/notify), **FD00 нет** → профиль `e87-ac707n-rcsp`, READ-ONLY, Qix-OTA невозможен (R-CHIP/R-PATH = BLOCK).
- 9E-кадр: `[3]=cmd`, `[4..5]=len LE`, payload с `[6]`; C7 (13 B, u16 BE) = `360×360`, `368×368`, `500`, `16`, `0` — смысл полей после 360×360 не подтверждён.
- `2A19` read возвращает 0 байт → подписка на notify + повтор после bootstrap.
- Непрошенные кадры: `cmd 0x21` (00 80 / 01 80), `cmd 0x27` (00 5F), FD03 `cmd 0xFF` (29 00, похоже на ack heartbeat 0x29) — не декодированы.

## Допущения — сверить на HIL
- Год в кадре времени `9E 45…` — big-endian.
- HASH_RANGE: CRC16 ответа считается по `status..digest`; CAPS-ответ начинается с эха `0xD7`.
- Срезы: offset в `flash.bin` = адрес флеша; хвост за пределами образа = `0xFF`; app.bin дополняется `0xFF` до VERIFY_SPAN.
- Сертификат подписан HMAC-ключом этого браузера (IndexedDB, non-extractable): в другом браузере дамп надо сертифицировать заново.

## Не реализовано
RCSP restore-передача (`RCSP_READY=false` → R-PATH BLOCK), патч прошивки `qix_hash.c`, async `0xD6`, full double-read, mock полного OTA-цикла, docs/PROTOCOL.md и SAFETY.md.
