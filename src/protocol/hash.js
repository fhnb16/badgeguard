/* ===== protocol/hash: CAPS 0xD7 + HASH_RANGE 0xD5 (Дополнение №1 §6) ===== */
const CAPS={HASH_RANGE:1,RAW_FLASH:2,ASYNC_HASH:4};
const HASH_ERR={1:'E-INT-008 busy',2:'E-INT-007 unsupported',3:'E-INT-006 bad range',4:'E-INT-008 device timeout'};
// io.qreq(cmd, payload, ms) → {cmd, payload}: Qix 9E-кадр в FD02, ответ с FD01/FD03 (сервис FD00 — характеристики FD00 нет)
function buildHashReq(addr,len,algo=1){const b=new Uint8Array(9),d=new DataView(b.buffer);d.setUint32(0,addr);d.setUint32(4,len);b[8]=algo;return b}
// RESP payload: status | algo | digest[32] | crc16(status..digest, BE16)
function parseHashResp(p){
  if(p.length<36)throw new Error('E-INT-006 bad response');
  if(p[0])throw new Error(HASH_ERR[p[0]]||'E-INT-006 status '+p[0]);
  if(p[1]!==1)throw new Error('E-INT-006 algo '+p[1]);
  if(crc16(p.subarray(0,34))!==((p[34]<<8)|p[35]))throw new Error('E-INT-006 response CRC');
  return hex(p.subarray(2,34),'').toLowerCase()}
// нет Caps / нет ответа → 0: штатная деградация до L1/L0, не ошибка
async function readCaps(io,ms){try{const r=await io.qreq(0xD7,[],ms);return r.payload.length>=5&&r.payload[0]===0?new DataView(r.payload.buffer,r.payload.byteOffset).getUint32(1):0}catch{return 0}}
async function hashRange(io,addr,len,flashSize,ms){
  if(len<=0||len>0x400000||addr+len>flashSize)throw new Error('E-INT-006 bad range');
  let r;try{r=await io.qreq(0xD5,buildHashReq(addr,len),ms)}catch(e){throw new Error('E-INT-008 '+e.message)}
  return parseHashResp(r.payload)}
