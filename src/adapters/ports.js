/* ===== ADAPTERS — wire-детали портируются из референсов (ТЗ §14), не выдумываются. Без порта → fail-closed. ===== */
/* PORT: jl-auth (auracast jl-auth.ts / e87_badge jieli_auth.py)
   AUTH.encrypt = (data: Uint8Array(16), prof: {key: Uint8Array, magic: Uint8Array}) => Uint8Array(16)
   Профиль активен только если его тест-вектор проходит (для A впишите vector). */
const AUTH={encrypt:null,ok:{A:false,B:false},profiles:{
  A:{key:'6BE9B2C083D94A1E5AF89C4E7B6D3F20',magic:'B3A1D7E94C2F8560',vector:null},
  B:{key:'06775F87918DD423005DF1D8CF0C142B',magic:'112233332211',vector:['70B75992E05EA78FEC533BA12979B590','FFE9E6C80CE1F40F5CCEAE20831C5879']}}};
/* PORT: ufw (jieli-ble-badge-research ufw-repack/jltech)
   UFW.parse = async (u8, base) => ({kind, chipkey, ubootHash(sha256 hex lower), appBinSize, crc:{hdr,list,data,qix}, geometry:{flashSize,codeSpan,appSlot}, version}) */
const UFW={parse:null};
/* PORT: qix-ble + ROBUSTNESS.md. ctx = {w, req, waitFor, set, log, image, report, passport}
   begin(ctx) — 0xC0 REQ_UPDATE на FD00 + negotiation, отказ → throw
   sendWindow(ctx,{offset,chunks:[{off,data,crc}]}) — окно + ожидание ack
   resume(ctx,offset) — продолжение после reconnect БЕЗ повторного 0xC0
   apply(ctx), probe(ctx) — probe: только negotiation, 0 записей; abort(ctx) — опционально
   ready=true только после порта и HIL-проверки. */
const QIX={ready:false,begin:null,sendWindow:null,resume:null,apply:null,probe:null,abort:null};
const RCSP_READY=false; // v1.1: vanilla RCSP restore

/* PORT: readback (qix dump --type flash / TEST_GET_*; нужен auth+bootstrap, SET_TEST_MODE 0xA0)
   READBACK.dumpRange(ctx, addr, len, onProgress(doneBytes)) => Uint8Array(len), on-flash форма. Ставит TEST_MODE. */
const READBACK={ready:false,dumpRange:null};
/* PORT: jl-flash-decrypt + JL CRC (jieli-ble-badge-research)
   JL.decrypt(code) => Uint8Array (descrambled CODE) · JL.parseHeader(code) => bool
   JL.verifyCrcs(code) => bool (app_area_head, dcrc/listcrc/hdrcrc) · JL.layoutOk(dump, profile) => bool. Без порта дамп не verified. */
const JL={decrypt:null,parseHeader:null,verifyCrcs:null,layoutOk:null};
/* Контракты, расширенные Дополнением №1:
   UFW.parse(...) → ещё flashBin (Uint8Array, on-flash, offset = адрес флеша), appBin (plaintext), internalJlCrcOk (bool)
   QIX.sendWindow(...) → {crcOk:boolean} — ack окна; QIX.apply(ctx) → {wholeFileCrcOk:boolean} — completion 0x20/0x1C
   QIX.enterService(ctx) — опц.: вход в Update-режим перед HASH_RANGE, если прошивка этого требует */
