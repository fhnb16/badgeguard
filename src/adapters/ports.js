/* ===== ADAPTERS — wire-детали портируются из референсов (ТЗ §14), не выдумываются. Без порта → fail-closed. ===== */
/* AUTH — ПОРТИРОВАНО: шифр src/protocol/jl-auth.js (web-bluetooth-e87, MIT), handshake — qix-ble auth.py.
   Профиль включается только если проходят ВСЕ его векторы. Профиль «A» (ключ 6BE9…) удалён: он есть лишь в README
   референсов, а их код использует ключ 0677…; векторов для A нет. */
const AUTH={ok:{},encrypt:(d,p)=>Uint8Array.from(functionE1test(Array.from(p.magic),Array.from(d),Array.from(p.key))),profiles:{
  B:{key:'06775F87918DD423005DF1D8CF0C142B',magic:'112233332211',vectors:[['70B75992E05EA78FEC533BA12979B590','FFE9E6C80CE1F40F5CCEAE20831C5879'],
    ['b6e080ecaff322916d88fad5aa34c2ac','1d8897ac4604d332e8175e81bb292524'],['a53057d376fc0476e5dc68273b5e791e','b3242d82e1df6c545895ecae13b44fea'],
    ['384ac9d8e481e5caaeb8cead20ee8f9e','fe1b5b643a790fdcf585e354dd377b0f']]}}};
/* PORT: ufw (jieli-ble-badge-research ufw-repack/jltech)
   UFW.parse = async (u8, base) => ({kind, chipkey, ubootHash(sha256 hex lower), appBinSize, crc:{hdr,list,data,qix}, geometry:{flashSize,codeSpan,appSlot}, version}) */
const UFW={parse:null};
/* PORT: qix-ble + ROBUSTNESS.md. ctx = {w, req, waitFor, set, log, image, report, passport}
   begin(ctx) — 0xC0 REQ_UPDATE (9E-кадр в FD02, ответ FD01/FD03; см. qix-ble update_manager.py) + negotiation, отказ → throw
   sendWindow(ctx,{offset,chunks:[{off,data,crc}]}) — окно + ожидание ack
   resume(ctx,offset) — продолжение после reconnect БЕЗ повторного 0xC0
   apply(ctx), probe(ctx) — probe: только negotiation, 0 записей; abort(ctx) — опционально
   ready=true только после порта и HIL-проверки. */
const QIX={ready:false,begin:null,sendWindow:null,resume:null,apply:null,probe:null,abort:null};
const RCSP_READY=false; // v1.1: vanilla RCSP restore

/* READBACK — ПОРТИРОВАНО в src/protocol/testmode.js (qix-ble cmd_dump): dumpRange(ctx, addr, len, onProgress) → Uint8Array, on-flash форма, ставит TEST_MODE */
const READBACK={ready:false,dumpRange:null};
/* PORT: jl-flash-decrypt + JL CRC (jieli-ble-badge-research)
   JL.decrypt(code) => Uint8Array (descrambled CODE) · JL.parseHeader(code) => bool
   JL.verifyCrcs(code) => bool (app_area_head, dcrc/listcrc/hdrcrc) · JL.layoutOk(dump, profile) => bool. Без порта дамп не verified. */
const JL={decrypt:null,parseHeader:null,verifyCrcs:null,layoutOk:null};
/* Контракты, расширенные Дополнением №1:
   UFW.parse(...) → ещё flashBin (Uint8Array, on-flash, offset = адрес флеша), appBin (plaintext), internalJlCrcOk (bool)
   QIX.sendWindow(...) → {crcOk:boolean} — ack окна; QIX.apply(ctx) → {wholeFileCrcOk:boolean} — completion 0x20/0x1C
   QIX.enterService(ctx) — опц.: вход в Update-режим перед HASH_RANGE, если прошивка этого требует */
