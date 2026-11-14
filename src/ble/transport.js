/* ===== BLE transport ===== */
const NAMES=['E87','E92','L8','X9','LED Badge','EC-BADGE'];
const SVC={ae00:'0000ae00-0000-1000-8000-00805f9b34fb',fd:'c2e6fd00-e966-1000-8000-bef9c223df6a'};
const OPT=[SVC.ae00,SVC.fd,'battery_service','generic_access'];
const fe=(flag,cmd,body=[])=>Uint8Array.of(0xFE,0xDC,0xBA,flag,cmd,body.length>>8,body.length&255,...body,0xEF);
const isFE=(u,cmd)=>u[0]===0xFE&&u[1]===0xDC&&u[2]===0xBA&&u[4]===cmd;
const setConn=c=>{S.conn=c;render()};

async function w(k,bytes,note=''){const c=S.chars[k];if(!c)throw new Error('E-GATT-001 '+k);const u=bytes instanceof Uint8Array?bytes:Uint8Array.from(bytes);
  log('TX',k,u,note);return gq(()=>c.properties.writeWithoutResponse?c.writeValueWithoutResponse(u):c.writeValueWithResponse(u))}
const waitFor=(pred,ms)=>new Promise((res,rej)=>{const wt={pred,res:x=>{clearTimeout(id);res(x)},rej:e=>{clearTimeout(id);rej(e)}};
  const id=setTimeout(()=>{S.waiters=S.waiters.filter(y=>y!==wt);rej(new Error('timeout'))},ms);S.waiters.push(wt)});
async function req(k,b,pred,note,ms=S.set.reqTo){const p=waitFor(pred,ms);p.catch(()=>{});await w(k,b,note);return p}

function onRx(e){const v=e.target.value,u=new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)),k=short(e.target.uuid);
  log('RX',k,u,decode(k,u));sniff(u);
  S.waiters=S.waiters.filter(x=>{if(x.pred(k,u)){x.res({k,u});return false}return true})}
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
  S.chars=chars;S.gatt=g;
  for(const k of['ae02','fd00','fd01','fd03','fd05']){const c=chars[k];if(!c||!(c.properties.notify||c.properties.indicate))continue;
    try{await gq(()=>c.startNotifications());c.addEventListener('characteristicvaluechanged',onRx,{signal:S.ac.signal})}catch(e){log('EV',k,null,'notify ✕ '+e.message)}}
  S.gattReady=true;log('EV','',null,`GATT ↑ ${g.services.length} services`);setConn('on')}

async function onDisc(){S.gattReady=false;S.waiters.forEach(x=>x.rej(new Error('disconnected')));S.waiters=[];
  log('EV','',null,'disconnected');if(S.phase==='transferring'||S.phase==='resuming')S.phase='paused';setConn('off');
  if(S.userDisc||S.reconnecting)return;S.reconnecting=true;
  try{for(let i=0;i<7;i++){await sleep(Math.min(16000,1000*2**i));if(S.userDisc)return;
    try{await gattUp();return}catch(e){log('EV','',null,`reconnect ${i+1} ✕ ${e.message}`)}}
    toast('E-OTA-003 / E-BLE-003','block')}finally{S.reconnecting=false}}
async function waitConn(want,ms){const end=Date.now()+ms;while(Date.now()<end){if(want?S.gattReady&&S.dev.gatt.connected:!S.dev.gatt.connected)return true;await sleep(300)}return false}
function disconnect(){S.userDisc=true;if(S.dev&&S.dev.gatt.connected)S.dev.gatt.disconnect();S.gattReady=false;setConn('off')}
async function readBatt(){const c=S.chars['2a19'];if(!c)return null;return(await gq(()=>c.readValue())).getUint8(0)}
