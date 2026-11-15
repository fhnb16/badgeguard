// Требует jsdom: npm i -D jsdom; сначала node build.mjs
// Интеграционный прогон: виртуальный E87 (auth, bootstrap, экран/батарея и безопасная блокировка BLE raw dump)
import{JSDOM}from'jsdom';import{readFileSync}from'node:fs';import{webcrypto}from'node:crypto';
const errs=[];const dom=new JSDOM(readFileSync(new URL('../dist-single/index.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,
 beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.confirm=()=>true;w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
  w.addEventListener('error',e=>errs.push(e.message));
  const U=s=>s.length===4?`0000${s}-0000-1000-8000-00805f9b34fb`:s, Q=n=>`c2e6${n}-e966-1000-8000-bef9c223df6a`;
  const chars={},mk=(uuid,props)=>{const L=[];return chars[uuid.slice(4,8)]={uuid,properties:props,L,startNotifications:async()=>{},stopNotifications:async()=>{},addEventListener:(t,f)=>L.push(f),removeEventListener:(t,f)=>{const i=L.indexOf(f);if(i>=0)L.splice(i,1)},
    readValue:async()=>new DataView(new ArrayBuffer(0)),writeValueWithoutResponse:async u=>dev(uuid.slice(4,8),new Uint8Array(u)),writeValueWithResponse:async u=>dev(uuid.slice(4,8),new Uint8Array(u))}};
  const svcs=[{uuid:Q('fd00'),cs:[mk(Q('fd01'),{notify:true}),mk(Q('fd02'),{write:true,writeWithoutResponse:true}),mk(Q('fd03'),{read:true,write:true,notify:true}),mk(Q('fd04'),{writeWithoutResponse:true}),mk(Q('fd05'),{notify:true})]},
    {uuid:U('180f'),cs:[mk(U('2a19'),{read:true,notify:true})]},{uuid:U('ae00'),cs:[mk(U('ae01'),{writeWithoutResponse:true}),mk(U('ae02'),{notify:true})]}];
  const send=(k,arr)=>setTimeout(()=>{const u=Uint8Array.from(arr);for(const f of chars[k].L)f({target:{uuid:chars[k].uuid,value:new DataView(u.buffer)}})},2);
  const q=(cmd,p)=>{const b=[0x9E,0,0x00,cmd,p.length&255,p.length>>8,...p];b[1]=b.slice(2).reduce((a,x)=>a+x,0)&255;return b};
  const KEY=[0x06,0x77,0x5f,0x87,0x91,0x8d,0xd4,0x23,0,0x5d,0xf1,0xd8,0xcf,0x0c,0x14,0x2b],MAG=[0x11,0x22,0x33,0x33,0x22,0x11];
  let ch=null,authed=false;
  function dev(k,u){const E=x=>w.eval('functionE1test')(MAG,[...x],KEY);
    if(k==='ae01'){if(u[0]===0&&u.length===17)send('ae02',[1,...E(u.slice(1))]);
      else if(u.length===5&&u[0]===2){ch=Array.from({length:16},(_,i)=>i*13&255);send('ae02',[0,...ch])}
      else if(u[0]===1&&u.length===17){if(E(ch).every((x,i)=>x===u[1+i])){authed=true;send('ae02',[2,0x70,0x61,0x73,0x73])}}
      else if(u[0]===0xFE){const cmd=u[4],body=cmd===3?[0,u[7],4,16,0x45,0x38,0x37,7,2,0xAA,0xBB,0xCC,0x11,0x22,0x33,5,10,0x05,0xD6,0x06,0x16]:[0,u[7]];
        const fr=[0xFE,0xDC,0xBA,0x00,cmd,body.length>>8,body.length&255,...body,0xEF];send('ae02',fr.slice(0,6));send('ae02',fr.slice(6))}return}
    if(k!=='fd02'||u[0]!==0x9E)return;const cmd=u[3];
    if(cmd===0xC6){const f=q(0xC7,[1,0x68,1,0x68,1,0x70,1,0x70,1,0xF4,0x10,0,0]);send('fd01',f.slice(0,8));send('fd01',f.slice(8))}
    else if(cmd===0x29&&authed)send('fd01',q(0x27,[0,95]));
    else if(cmd===0xDC)send('fd03',q(0xFF,[0x29,0]))}
  const server={getPrimaryServices:async()=>svcs.map(s=>({uuid:s.uuid,getCharacteristics:async()=>s.cs}))};
  const device={id:'SIM',name:'E87',gatt:{connected:false,connect:async()=>{device.gatt.connected=true;return server},disconnect(){device.gatt.connected=false}},addEventListener(){}};
  Object.defineProperty(w.navigator,'bluetooth',{value:{requestDevice:async()=>device}});
  w.SIM.device=device}});
const W=dom.window,D=W.document,sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(500);D.querySelector('#btnConn').click();await sleep(6000);
const P=W.eval('S.P');
console.log('auth:',JSON.stringify(P.auth),'boot:',W.eval('S.boot'),'battery:',JSON.stringify(P.battery),'mac:',P.mac,'ti:',JSON.stringify(P.targetInfo),'display:',P.display&&P.display.width);
console.log('qixFd00:',P.capabilities.qixFd00,'dumpBtn disabled:',D.querySelector('#btnDump').disabled,'hint:',JSON.stringify(D.querySelector('#dumpHint').textContent));
if(P.capabilities.qixFd00||!D.querySelector('#btnDump').disabled)throw new Error('unsupported BLE raw dump must remain disabled');
const B=await W.eval("readBatt()");console.log('readBatt (preflight):',B);
console.log('errors:',errs);console.log(W.eval("S.log.filter(e=>/skipped|!chk|✕|E-/.test(e.note)).map(e=>e.note).slice(0,8)"));
process.exit(0);
