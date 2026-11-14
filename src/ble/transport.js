/* ===== BLE transport =====
 * GATT E87 сверен с qix-ble service.py: сервис C2E6FD00 = Qix-sideband (TX FD02, RX FD01/FD03) — характеристики FD00 НЕТ ни у одного E87;
 * AE00 = RCSP (TX AE01, RX AE02). FD05 не подписываем: по qix-ble это ломает REQ_UPDATE (silent reject). 2A19 на этой прошивке пустой. */
const NAMES=['E87','E92','L8','X9','LED Badge','EC-BADGE'];
const SVC={ae00:'0000ae00-0000-1000-8000-00805f9b34fb',fd:'c2e6fd00-e966-1000-8000-bef9c223df6a'};
const OPT=[SVC.ae00,SVC.fd,'battery_service','generic_access'];
const NOTIFY=['ae02','fd01','fd03'];
const fe=(flag,cmd,body=[])=>Uint8Array.of(0xFE,0xDC,0xBA,flag,cmd,body.length>>8,body.length&255,...body,0xEF);
let rcspSN=0;const nextSN=()=>rcspSN=rcspSN+1&255;
const isFE=(u,cmd)=>u[0]===0xFE&&u[1]===0xDC&&u[2]===0xBA&&u[4]===cmd;
const setConn=c=>{S.conn=c;render()};

async function w(k,bytes,note=''){const c=S.chars[k];if(!c)throw new Error('E-GATT-001 '+k);const u=bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes);
  log('TX',k,u,note);return gq(()=>c.properties.writeWithoutResponse?c.writeValueWithoutResponse(u):c.writeValueWithResponse(u))}
const waitFor=(pred,ms)=>new Promise((res,rej)=>{const wt={pred,res:x=>{clearTimeout(id);res(x)},rej:e=>{clearTimeout(id);rej(e)}};
  const id=setTimeout(()=>{S.waiters=S.waiters.filter(y=>y!==wt);rej(new Error('timeout'))},ms);S.waiters.push(wt)});
async function req(k,b,pred,note,ms=S.set.reqTo){const p=waitFor(pred,ms);p.catch(()=>{});await w(k,b,note);return p}
// Qix-команда: 9E-кадр с контрольной суммой в FD02; ответ — собранный кадр с FD01/FD03
const qix=(flags,cmd,payload=[],note)=>w('fd02',qixEncode(flags,cmd,payload),note||'Qix '+hx(cmd));
async function qreq(cmd,payload,ms,{flags=0,expect=cmd,match=null}={}){
  const p=waitFor((k,u)=>(k==='fd01'||k==='fd03'||k==='fd05')&&u[0]===0x9E&&(match?match(u):expect==null||u[3]===expect),ms);p.catch(()=>{});
  await qix(flags,cmd,payload);const r=await p;return{k:r.k,cmd:r.u[3],payload:r.u.slice(6)}}

// уведомления фрагментируются: собираем 9E-кадры (FD01/FD03) и FE-кадры (AE02) из потока
const rxBuf={};
const cat=(a,b)=>{if(!a||!a.length)return b;const o=new Uint8Array(a.length+b.length);o.set(a);o.set(b,a.length);return o};
function onRx(e){const v=e.target.value,u=new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)),k=short(e.target.uuid);
  S.maxNotify[k]=Math.max(S.maxNotify[k]||0,u.length); // косвенная оценка MTU: Web Bluetooth её не отдаёт
  const take=k==='fd01'||k==='fd03'||k==='fd05'?qixTake:k==='ae02'&&(u[0]===0xFE||rxBuf.ae02&&rxBuf.ae02.length)?feTake:null;
  if(!take)return dispatch(k,u);
  let b=cat(rxBuf[k],u);for(;;){const r=take(b);b=r.rest;if(r.skipped)log('EV',k,null,`skipped ${r.skipped} B`);if(!r.frame)break;dispatch(k,r.frame)}rxBuf[k]=b}
function dispatch(k,u){log('RX',k,u,decode(k,u));sniff(u);onFrame(k,u);
  S.waiters=S.waiters.filter(x=>{if(x.pred(k,u)){x.res({k,u});return false}return true})}
function onFrame(k,u){if(!S.P)return;
  if(u[0]===0x9E){const f=parse9E(u);if(!f)return;
    if(f.cmd===0xC7)S.P.display=decodeC7(f.payload);
    // push после bootstrap: cmd 0x27 [mode, percent] (qix-ble battery.py); mode 1 ≈ зарядка — не подтверждено, в R-BATT не используем
    else if(f.cmd===0x27&&f.len===2){S.P.battery.level=f.payload[1];S.P.battery.mode=f.payload[0];S.battAt=Date.now();render()}}
  else if(isFE(u,0x03)||isFE(u,0x07)){const r=parseRcspResp(u);if(!r||r.status!==0)return;
    if(r.cmd===0x03){const ti=decodeTargetInfo(parseTlv(r.data));S.P.targetInfo=ti;if(ti.edr_addr)S.P.mac=ti.edr_addr;if(ti.fw_version&&!S.P.fwVersion)S.P.fwVersion=ti.fw_version}
    else S.P.sysInfo=Object.fromEntries(parseTlv(r.data.subarray(1)).map(a=>['attr_'+a.type,hex(a.data,'')]));render()}}
function sniff(u){if(!S.P)return;const s=ascii(u),sdk=s.match(/jl_sdk_ac\w+/),ver=s.match(/\d+\.\d+\.\d+\.\d+\.\d+/);
  if(sdk)S.P.sdkString=sdk[0];if(ver)S.P.fwVersion=ver[0];if(/BADGE-FWMARK/.test(s))S.P.bootMarker=true}

async function connect(all){
  if(!navigator.bluetooth)return toast('E-BLE-001','block');
  if(S.dev&&S.dev.gatt.connected)return toast(t('oneConn'),'warn');
  let d;try{d=await navigator.bluetooth.requestDevice(all?{acceptAllDevices:true,optionalServices:OPT}:{filters:[...NAMES.map(namePrefix=>({namePrefix})),{services:[SVC.ae00]}],optionalServices:OPT})}
  catch(e){return toast('E-BLE-002: '+e.message,'warn')}
  if(S.ac)S.ac.abort();S.ac=new AbortController();S.dev=d;S.userDisc=false;
  d.addEventListener('gattserverdisconnected',onDisc,{signal:S.ac.signal});
  try{await gattUp();await collectMeta()}catch(e){log('EV','',null,'E-BLE-003 '+e.message);toast('E-BLE-003: '+e.message,'block');setConn(d.gatt.connected?'on':'off')}}

async function gattUp(){
  setConn('connecting');
  const srv=await withTimeout(S.dev.gatt.connect(),S.set.connectTo,'E-BLE-003 connect timeout');
  const chars={},g={services:[],chars:{}};
  for(const s of await gq(()=>srv.getPrimaryServices())){g.services.push(s.uuid);
    const cs=await gq(()=>s.getCharacteristics()).catch(()=>[]);
    g.chars[s.uuid]=cs.map(c=>`${c.uuid} [${['read','write','writeWithoutResponse','notify','indicate'].filter(p=>c.properties[p]).join(',')}]`);
    for(const c of cs)chars[short(c.uuid)]??=c}
  S.chars=chars;S.gatt=g;S.dumpCs=0;for(const k in rxBuf)delete rxBuf[k];S.boot=false;
  for(const k of NOTIFY){const c=chars[k];if(!c||!(c.properties.notify||c.properties.indicate))continue;
    try{await gq(()=>c.startNotifications());c.addEventListener('characteristicvaluechanged',onRx,{signal:S.ac.signal})}catch(e){log('EV',k,null,'notify ✕ '+e.message)}}
  S.gattReady=true;log('EV','',null,`GATT ↑ ${g.services.length} services`);setConn('on')}

async function onDisc(){S.gattReady=false;S.boot=false;S.waiters.forEach(x=>x.rej(new Error('disconnected')));S.waiters=[];
  log('EV','',null,'disconnected');if(S.phase==='transferring'||S.phase==='resuming')S.phase='paused';setConn('off');
  if(S.userDisc||S.reconnecting)return;S.reconnecting=true;const dev=S.dev;
  try{for(let i=0;i<7;i++){await sleep(Math.min(16000,1000*2**i));if(S.userDisc||S.dev!==dev)return; // новый Connect отменяет старый цикл
    try{await gattUp();return}catch(e){log('EV','',null,`reconnect ${i+1} ✕ ${e.message}`)}}
    toast(t('e_reconn'),'block')}finally{S.reconnecting=false}}
async function waitConn(want,ms){const end=Date.now()+ms;while(Date.now()<end){if(want?S.gattReady&&S.dev.gatt.connected:!S.dev.gatt.connected)return true;await sleep(300)}return false}
function disconnect(){S.userDisc=true;if(S.dev&&S.dev.gatt.connected)S.dev.gatt.disconnect();S.gattReady=false;S.boot=false;setConn('off')}
// Батарея: свежий push 0x27 (триггер — 0x29 [80], как в bootstrap phase 5); стандартный 2A19 — последний шанс
async function readBatt(){
  if(S.chars.fd02){const p=waitFor((k,u)=>k==='fd01'&&u[0]===0x9E&&u[3]===0x27&&u[4]===2,2500);p.catch(()=>{});
    try{await qix(0x0B,0x29,[0x80],'battery trigger');await p}catch{log('EV','fd01',null,'battery: no 0x27 push')}}
  if(S.P&&S.P.battery.level!=null&&Date.now()-(S.battAt||0)<60000)return S.P.battery.level;
  const c=S.chars['2a19'];if(!c)return null;
  try{const d=await gq(()=>c.readValue());if(d.byteLength)return d.getUint8(0);log('EV','2a19',null,'read: 0 bytes')}catch(e){log('EV','2a19',null,'read ✕ '+e.message)}
  return null}
