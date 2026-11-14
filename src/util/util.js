/* ===== utils ===== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'—').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const short=u=>u.slice(4,8).toLowerCase();
const ascii=u=>String.fromCharCode(...u).replace(/[^\x20-\x7e]+/g,'\n');
function withTimeout(p,ms,code='timeout'){let id;return Promise.race([p,new Promise((_,r)=>{id=setTimeout(()=>r(new Error(code)),ms)})]).finally(()=>clearTimeout(id))}
let qTail=Promise.resolve();
// Web Bluetooth запрещает параллельные GATT-операции → единая очередь
const gq=(fn,ms=S.set.reqTo)=>{const p=qTail.then(()=>withTimeout(fn(),ms,'E-GATT timeout'));qTail=p.catch(()=>{});return p};
function download(name,data){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([typeof data==='string'||data instanceof Uint8Array?data:JSON.stringify(data,null,2)]));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
const copy=s=>(navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).then(()=>toast('✓'),()=>toast('clipboard ✕','warn'));
function toast(msg,kind='info'){const d=document.createElement('div');d.className='toast toast--'+kind;d.textContent=msg;$('#toasts').append(d);setTimeout(()=>d.remove(),kind==='block'?10000:4500)}
function idbOpen(){return new Promise((res,rej)=>{const o=indexedDB.open('badgeguard',2);
  o.onupgradeneeded=()=>{for(const[n,opt]of[['passports',{autoIncrement:true}],['sessions',{autoIncrement:true}],['keys',{}]])if(!o.result.objectStoreNames.contains(n))o.result.createObjectStore(n,opt)};
  o.onsuccess=()=>res(o.result);o.onerror=()=>rej(o.error)})}
async function idbDo(store,mode,fn){const db=await idbOpen();try{return await new Promise((res,rej)=>{const tx=db.transaction(store,mode),r=fn(tx.objectStore(store));tx.oncomplete=()=>res(r.result);tx.onerror=()=>rej(tx.error)})}finally{db.close()}}
const idb=(s,v)=>idbDo(s,'readwrite',st=>st.add(JSON.parse(JSON.stringify(v)))).catch(()=>{});
const idbGet=(s,k)=>idbDo(s,'readonly',st=>st.get(k));
const idbPut=(s,k,v)=>idbDo(s,'readwrite',st=>st.put(v,k));
function chime(){if(!S.set.chime)return;try{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.frequency.value=880;g.gain.value=.04;o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.15);o.onended=()=>a.close()}catch{}}

/* ===== log ===== */
function log(dir,ch,u8,note=''){if(S.quiet&&dir!=='EV')return;const e={ts:new Date().toISOString(),dir,ch,hex:u8?hex(u8):'',note};S.log.push(e);
  if(S.log.length>50000)S.log.splice(0,10000); // shortcut: кольцевой буфер; полный лог сессии — в IndexedDB по завершении прошивки
  appendLog(e)}
function appendLog(e){if(!S.set.expert&&e.dir!=='EV'&&!e.note)return;const li=document.createElement('li');li.className=e.dir.toLowerCase();
  li.textContent=`${e.ts.slice(11,23)} ${e.dir}${e.ch?' '+e.ch:''} ${S.set.expert?e.hex:''} ${e.note}`.replace(/\s+/g,' ');
  const L=$('#log');L.append(li);while(L.childElementCount>400)L.firstChild.remove();L.scrollTop=L.scrollHeight}
const rebuildLog=()=>{$('#log').textContent='';S.log.slice(-1500).forEach(appendLog)};
const logText=()=>S.log.map(e=>`${e.ts} ${e.dir} ${e.ch} ${e.hex} ${e.note}`).join('\n');
function decode(k,u){if(u[0]===0xFE&&u[1]===0xDC&&u[2]===0xBA){const r=parseRcspResp(u);return`FE flag=${hx(u[3])} cmd=${hx(u[4])} len=${u[5]<<8|u[6]}${r&&u[3]===0?' status='+r.status:''}`}
  const f=parse9E(u);if(f){const c=f.cmd===0xC7?decodeC7(f.payload):null,a=ascii(f.payload).trim();
    return`9E cmd=${hx(f.cmd)} len=${f.len}${f.ok?'':' !chk'}${c?' '+JSON.stringify(c):f.cmd===0x27&&f.len===2?` battery ${f.payload[1]}% mode=${f.payload[0]}`:a.length>=4?' "'+a.replace(/\n/g,' ')+'"':''}`}
  if(k==='ae02'&&u.length<=17)return'auth';return''}
