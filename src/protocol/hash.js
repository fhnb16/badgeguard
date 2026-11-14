/* ===== protocol/hash: CAPS 0xD7 + HASH_RANGE 0xD5 на FD00 (Дополнение №1 §6) ===== */
// io.req(char, bytes, pred, note, ms) → {k,u}; в приложении — req() из transport, в тестах — мок
const CAPS={HASH_RANGE:1,RAW_FLASH:2,ASYNC_HASH:4};
const HASH_ERR={1:'E-INT-008 busy',2:'E-INT-007 unsupported',3:'E-INT-006 bad range',4:'E-INT-008 device timeout'};
function buildHashReq(addr,len,algo=1){const b=new Uint8Array(10),d=new DataView(b.buffer);b[0]=0xD5;d.setUint32(1,addr);d.setUint32(5,len);b[9]=algo;return b}
// RESP: D5 | status | algo | digest[32] | crc16(status..digest, BE16)
function parseHashResp(u){
  if(u[0]!==0xD5||u.length<37)throw new Error('E-INT-006 bad response');
  if(u[1])throw new Error(HASH_ERR[u[1]]||'E-INT-006 status '+u[1]);
  if(u[2]!==1)throw new Error('E-INT-006 algo '+u[2]);
  if(crc16(u.subarray(1,35))!==((u[35]<<8)|u[36]))throw new Error('E-INT-006 response CRC');
  return hex(u.subarray(3,35),'').toLowerCase()}
// нет Caps / нет ответа → 0: штатная деградация до L1/L0, не ошибка
async function readCaps(io,ms){try{const r=await io.req('fd00',[0xD7],(k,u)=>k==='fd00'&&u[0]===0xD7,'CAPS',ms);
  return r.u.length>=6&&r.u[1]===0?new DataView(r.u.buffer,r.u.byteOffset).getUint32(2):0}catch{return 0}}
async function hashRange(io,addr,len,flashSize,ms){
  if(len<=0||len>0x400000||addr+len>flashSize)throw new Error('E-INT-006 bad range');
  let r;try{r=await io.req('fd00',buildHashReq(addr,len),(k,u)=>k==='fd00'&&u[0]===0xD5,`HASH_RANGE ${hx(addr)}+${hx(len)}`,ms)}
  catch(e){throw new Error('E-INT-008 '+e.message)}
  return parseHashResp(r.u)}
