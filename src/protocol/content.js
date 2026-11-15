/* ===== protocol/content — контент-путь E87: картинка / видео / GIF / текст / слайдшоу =====
 * Порт ebadge-python-cli rcsp_transfer.py (MIT) ← web-bluetooth-e87. Фазы 6–10:
 *   0x21 session-open → 0x27 xfer-params → 0x1B metadata(size BE32, crc16 BE16, rnd2, "xxxxxx.tmp\0")
 *   → окно: устройство шлёт push 0x1D [status][win:2BE][nextOffset:4BE], мы отдаём кадры 0x01/xmOp=0x1D
 *     [slot][crcHi][crcLo][data] → 0x20 FILE_COMPLETE (отвечаем UTF-16LE путём) → 0x1C finalize.
 * Это РАБОЧИЙ путь на стоке (в отличие от raw-дампа) — ТЗ Фаза 5.
 */
const CONTENT={running:false,mode:'image',payload:null,info:null,progress:0,result:null,error:null,chunkSize:490,windows:0};
const crc16be=n=>[(n>>8)&255,n&255];
const tmpName=()=>Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0')+'.tmp';
// Ответ на 0x20: путь в UTF-16LE с префиксом U+555C, как в официальном приложении
function filePathResponse(sn,mode){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const ext=(mode==='image'||mode==='qr')?'.jpg':'.avi',path='\u555C'+stamp+ext;
  const u=new Uint8Array(path.length*2+2);
  for(let i=0;i<path.length;i++){u[i*2]=path.charCodeAt(i)&255;u[i*2+1]=(path.charCodeAt(i)>>8)&255}
  return u}

function contentQueue(){
  const q=[];let wake=null;
  const un=rcspHook(i=>{
    if(i.cmd===0x1D||i.cmd===0x20||i.cmd===0x1C){q.push(i);if(wake){const f=wake;wake=null;f()}return true}
    return false});
  return{un,async next(ms){const end=Date.now()+ms;
    while(!q.length&&Date.now()<end&&!S.abort)await new Promise(r=>{wake=r;setTimeout(r,Math.min(60,Math.max(1,end-Date.now())))});
    return q.shift()||null}}}

async function contentUpload(payload,mode='image',{onProgress=null}={}){
  if(CONTENT.running)throw new Error('передача уже идёт');
  if(!S.P||!S.P.auth.ok)throw new Error('нужен auth');
  if(!S.chars.ae01)throw new Error('E-GATT-001 AE01');
  if(payload.length>MAX_UPLOAD_BYTES)log('EV','',null,`внимание: ${payload.length} Б > бюджета ${MAX_UPLOAD_BYTES} Б — устройство может отказаться`);
  CONTENT.running=true;CONTENT.mode=mode;CONTENT.error=null;CONTENT.result=null;CONTENT.windows=0;S.abort=false;
  S.prog={done:0,total:payload.length,t0:performance.now(),start:0,win:0};
  const wl=await wakeHold();const Q=contentQueue();
  const total=payload.length,fileCrc=crc16(payload);
  try{
    setPhase('preflight');
    // Фаза 6: session open
    const s21=await rcspCmd(0x21,[0x00],8000,{note:'content 0x21 session-open'});
    if(s21.kind!=='fe-response')throw new Error('E-CNT-001 0x21: '+kindTxt(s21.kind));
    if(s21.status!==0)throw new Error('E-CNT-001 0x21 status '+statusName(s21.status));
    // Фаза 7: параметры передачи
    const s27=await rcspCmd(0x27,[0,0,0,0,0x02,0x01],8000,{note:'content 0x27 xfer-params'});
    if(s27.kind!=='fe-response')throw new Error('E-CNT-001 0x27: '+kindTxt(s27.kind));
    // Фаза 8: метаданные файла
    const nm=new TextEncoder().encode(tmpName());
    const meta=Uint8Array.of((total>>>24)&255,(total>>>16)&255,(total>>>8)&255,total&255,...crc16be(fileCrc),
      Math.floor(Math.random()*256),Math.floor(Math.random()*256),...nm,0);
    const s1b=await rcspCmd(0x1B,meta,8000,{note:`content 0x1B metadata ${total} B crc=${hx(fileCrc)}`});
    if(s1b.kind!=='fe-response')throw new Error('E-CNT-001 0x1B: '+kindTxt(s1b.kind));
    if(s1b.status!==0)throw new Error('E-CNT-001 0x1B status '+statusName(s1b.status));
    let cs=490;
    if(s1b.payload&&s1b.payload.length>=2){const v=be16(s1b.payload);if(v>0&&v<=4096)cs=v}
    CONTENT.chunkSize=cs;log('EV','',null,`content: chunk=${cs} Б, кадров=${Math.ceil(total/cs)}`);
    setPhase('transferring');
    // Фаза 9: оконная передача, устройство задаёт offset и размер окна
    let ev=await Q.next(10000);
    if(!ev)throw new Error('E-CNT-002 нет первого окна 0x1D за 10 с');
    let seq=nextSN(),sent=0;
    for(;;){
      if(S.abort)throw new Error('E-ABORT');
      if(ev.cmd===0x1D){
        const p=ev.payload||new Uint8Array(0);
        if(p.length<7){ev=await Q.next(15000);if(!ev)throw new Error('E-CNT-002 окно не пришло');continue}
        const st=p[0],win=be16(p,1),next=be32(p,3);
        CONTENT.windows++;
        if(st!==0)log('EV','',null,`окно: status=${hx(st)} (${statusName(st)})`);
        if(win===0&&next>=total){log('EV','',null,'окно: передача завершена устройством');break}
        let off=next,slot=0,inWin=0;
        while(inWin<win&&off<total){
          const len=Math.min(cs,total-off,win-inWin),data=payload.subarray(off,off+len),c=crc16(data);
          await rcspWrite(fe(FE_FLAG.push,0x01,Uint8Array.of(seq&255,0x1D,slot&255,...crc16be(c),...data)),`content data @${hx(off)} +${len}`);
          seq=(seq+1)&255;slot=(slot+1)&7;off+=len;inWin+=len;sent=off;
          S.prog.done=off;CONTENT.progress=off/total;tick();
          if(onProgress)onProgress(off,total);
          if(S.set.chunkDelay)await sleep(S.set.chunkDelay)}
        S.prog.win=CONTENT.windows;renderLab();
        ev=await Q.next(15000);
        if(!ev){if(off>=total){ev=await Q.next(10000);if(!ev)throw new Error('E-CNT-002 нет завершения после передачи')}
          else throw new Error(`E-CNT-002 таймаут окна на ${off}/${total}`)}
        continue}
      if(ev.cmd===0x20){ // FILE_COMPLETE — устройству нужен путь, таймаут у него жёсткий (~100 мс)
        await rcspAck(0x20,ev.sn,0,filePathResponse(ev.sn,mode),null,'content 0x20 file-path');
        const fin=await Q.next(10000);
        if(fin&&fin.cmd===0x1C){const st=(fin.payload&&fin.payload.length)?fin.payload[0]:0xFF;
          await rcspAck(0x1C,fin.sn,0,[],null,'content 0x1C ack');
          CONTENT.result=st;break}
        CONTENT.result=0;break}
      if(ev.cmd===0x1C){const st=(ev.payload&&ev.payload.length)?ev.payload[0]:0xFF;
        await rcspAck(0x1C,ev.sn,0,[],null,'content 0x1C ack');CONTENT.result=st;break}
      ev=await Q.next(10000);if(!ev)throw new Error('E-CNT-002 таймаут ожидания завершения')}
    setPhase('done');
    const ok=CONTENT.result===0;
    log('EV','',null,`content ${mode}: ${sent}/${total} Б, окон ${CONTENT.windows}, статус ${hx(CONTENT.result)}`);
    toast(ok?'Контент отправлен ✓':'Устройство вернуло статус '+hx(CONTENT.result),ok?'ok':'block');
    if(ok)chime();
    return{ok,bytes:sent,total,windows:CONTENT.windows,status:CONTENT.result,chunkSize:cs,crc16:fileCrc}}
  catch(e){CONTENT.error=e.message;setPhase('error');log('EV','',null,'content ✕ '+e.message);toast(e.message,'block');throw e}
  finally{CONTENT.running=false;Q.un();if(wl)wl.release().catch(()=>{});renderLab()}}

/* ---------- Прочие рабочие фичи (Фаза 5) ---------- */
// Время: 9E 0x02, год LE (проверено на железе)
async function syncTime(d=new Date()){
  await qix(0x08,0x02,timePayload(d),'time sync');
  log('EV','',null,'время отправлено: '+d.toLocaleString());toast('время синхронизировано','ok')}
// Экран: C6 → C7
async function readScreen(){
  const r=await qreq(0xC6,[1],S.set.reqTo,{flags:0x0B,expect:0xC7}).catch(()=>null);
  if(!r)return null;const d=decodeC7(r.payload);if(d&&S.P){S.P.display=d;render()}return d}
// Яркость: чтение через 0x07 attr7 (COMMON_INFO_ATTR_LIGHT), запись — 9E 0x20 [0x16,0x01,0x00,level]
async function readBrightness(){
  const r=await rcspCmd(0x07,[0x00,0,0,0,0x80],S.set.reqTo,{note:'sys_info light (attr 7)'});
  if(r.kind!=='fe-response'||r.status!==0)return null;
  const a=parseTlv((r.payload||new Uint8Array(0)).subarray(1)).find(x=>x.type===7);
  return a&&a.data.length?a.data[0]:null}
async function setBrightness(level){
  const v=Math.max(0,Math.min(100,Math.round(level)));
  await qix(0x08,0x20,[0x16,0x01,0x00,v],'brightness '+v);
  log('EV','',null,'яркость → '+v+' (семантика 9E 0x20 не подтверждена вендором)');return v}
// Health: заглушки watch-SDK (peripherals_support=0). Показываем честно.
async function readHealth(){
  const out={stub:true,note:'периферия отсутствует (peripherals_support=0): значения — эмуляция watch-SDK, не измерения',items:[]};
  for(const cmd of[0x22,0x24,0x21]){
    const p=waitFor((k,u)=>k==='fd01'&&u[0]===0x9E&&u[3]===cmd,2500);p.catch(()=>{});
    await qix(0x08,0xFF,[cmd,0x00],'health '+hx(cmd));
    const r=await p.catch(()=>null);
    out.items.push({cmd:hx(cmd),name:(QIX_OPS[cmd]||{}).n||'?',dataHex:r?hex(r.u.slice(6),''):null,kind:r?classifyFrame(r.k,r.u).kind:'timeout'})}
  S.health=out;renderLab();return out}
