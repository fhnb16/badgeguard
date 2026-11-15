/* ===== protocol/ota — RCSP OTA: read-only зонд + прошивка под интерлоком (Фаза 3) =====
 * Порт qix-ble rcsp_ota.py (MIT) ← JieLi rcsp_update_master.c.
 * Модель PULL: устройство само запрашивает блоки (0xE5 [off:4BE][len:2BE]), телефон отвечает байтами.
 * READ-ONLY: 0xE1 (offset), 0xE2 (can-update), 0xE6 (status). ЗАПИСЬ: 0xE3/0xE5/0xE7/0xE8 — только после armOta().
 * Двухэтапный сценарий (single-bank): E6=0x80 → 0x0B{00,01} на ЖИВОЙ ссылке → ждём, что девайс сам её оборвёт →
 * reconnect → attr9==1 (loader) → E3 → повторная отдача → E6 → E7. E1/E2 во втором проходе НЕ повторяются.
 */
const OTA={armed:false,running:false,phase:'idle',probe:null,e1:null,canUpdate:null,status:null,progress:0,highWater:0,
  pass:1,relinkFlag:null,result:null,history:[],error:null};
const otaLog=m=>{OTA.history.push({ts:new Date().toISOString(),msg:m});log('EV','',null,'OTA '+m);renderLab()};

// Информация о банках из target_info attr 8 — читать ДО любых попыток OTA (bitfields.md §4)
function otaBankInfo(){
  const dp=S.P&&S.P.decoded&&S.P.decoded.targetInfo&&S.P.decoded.targetInfo.fields.doublePartition;
  return dp||{known:false,mode:'неизвестно (нет attr 8)',passes:null}}

/* ---------- READ-ONLY зонд ---------- */
async function otaProbe(){
  if(OTA.running)throw new Error('OTA занята');
  if(!S.P||!S.P.auth.ok)throw new Error('нужен auth');
  OTA.e1=null;OTA.canUpdate=null;OTA.status=null;
  OTA.running=true;OTA.error=null;OTA.phase='probing';renderLab();
  const t0=Date.now(),out={at:new Date().toISOString(),banks:otaBankInfo(),steps:[]};
  try{
    // 0xE1 — где лежит блок информации о файле (read-only)
    const e1=await rcspCmd(0xE1,[],S.set.reqTo,{note:'OTA E1 file-info-offset'});
    out.steps.push({op:'0xE1',kind:e1.kind,status:e1.status,dataHex:e1.payload?hex(e1.payload,''):''});
    if(e1.kind==='fe-response'&&e1.status===0&&e1.payload&&e1.payload.length>=6){
      OTA.e1={offset:be32(e1.payload),len:be16(e1.payload,4)};out.e1=OTA.e1;
      otaLog(`E1: offset=${hx(OTA.e1.offset)} len=${OTA.e1.len}`)}
    else otaLog('E1: '+(e1.kind==='timeout'?'timeout — сток не экспортирует OTA':statusName(e1.status)));
    // mark: если устройство отключило блок информации (offset=len=0) — референсный мастер шлёт один 0x00
    const mark=OTA.e1&&!(OTA.e1.offset===0&&OTA.e1.len===0)&&S.buf?new Uint8Array(S.buf).subarray(OTA.e1.offset,OTA.e1.offset+OTA.e1.len):Uint8Array.of(0);
    const e2=await rcspCmd(0xE2,mark,S.set.reqTo,{note:'OTA E2 inquire-can-update (read-only)'});
    out.steps.push({op:'0xE2',kind:e2.kind,status:e2.status,dataHex:e2.payload?hex(e2.payload,''):''});
    if(e2.kind==='fe-response'&&e2.status===0&&e2.payload&&e2.payload.length){OTA.canUpdate=e2.payload[0];out.canUpdate=OTA.canUpdate;out.canUpdateText=e2txt(OTA.canUpdate);
      otaLog(`E2: can_update=${hx(OTA.canUpdate)} — ${e2txt(OTA.canUpdate)}`)}
    else otaLog('E2: '+(e2.kind==='timeout'?'timeout':statusName(e2.status)));
    const e6=await rcspCmd(0xE6,[],S.set.reqTo,{note:'OTA E6 refresh-status (read-only)'});
    out.steps.push({op:'0xE6',kind:e6.kind,status:e6.status,dataHex:e6.payload?hex(e6.payload,''):''});
    if(e6.kind==='fe-response'&&e6.status===0&&e6.payload&&e6.payload.length){OTA.status=e6.payload[0];out.status=OTA.status;out.statusText=e6txt(OTA.status);
      otaLog(`E6: status=${hx(OTA.status)} — ${e6txt(OTA.status)}`)}
    else otaLog('E6: '+(e6.kind==='timeout'?'timeout':statusName(e6.status)));
    out.verdict=OTA.canUpdate!=null?'RCSP E2 ответил; это не подтверждает возможность прошивки':
      out.steps.every(s=>s.kind==='timeout')?'OTA не экспортируется стоковой прошивкой (все таймауты)':'неоднозначно — см. шаги';
    if(S.P&&S.P.capabilities)S.P.capabilities.rcspOtaProbe=out.steps.some(s=>s.op==='0xE2'&&s.kind==='fe-response');
    out.dtMs=Date.now()-t0;OTA.probe=out;S.otaProbe=out;
    log('EV','',null,'OTA probe: '+out.verdict);toast(out.verdict,OTA.canUpdate!=null?'ok':'warn');
    return out}
  catch(e){OTA.error=e.message;throw e}
  finally{OTA.running=false;OTA.phase='idle';renderLab()}}

/* ---------- Интерлок записи ---------- */
function otaGates(){
  const P=S.P,dp=otaBankInfo(),img=S.R,w=S.wired||{},profile=P&&P.profileId&&S.profiles[P.profileId];
  return[
    {id:'G-CONN',ok:S.conn==='on'&&S.gattReady,msg:'GATT жив'},
    {id:'G-AUTH',ok:!!(P&&P.auth.ok),msg:'RCSP auth пройден'},
    {id:'G-PROFILE',ok:!!(profile&&profile.ota===true),msg:'OTA подтверждён для профиля устройства',ev:profile?P.profileId:'профиль не распознан'},
    {id:'G-PROBE',ok:OTA.canUpdate===0,msg:'0xE2 = 0x00 (устройство согласно)',ev:OTA.canUpdate==null?'зонд не выполнен':e2txt(OTA.canUpdate)},
    {id:'G-IMAGE',ok:!!(img&&S.buf),msg:'Загружен образ прошивки (.ufw/.bin)'},
    {id:'G-KEY',ok:!!(img&&img.chipkey!=null)&&!!w.chipkey&&img.chipkey===w.chipkey,msg:'chipkey образа = chipkey устройства (снят проводом)',
      ev:`img=${img&&img.chipkey!=null?hx(img.chipkey):'—'} dev=${w.chipkey?hx(w.chipkey):'—'}`},
    {id:'G-UBOOT',ok:!!(w.ubootVersion&&P&&P.decoded&&P.decoded.targetInfo&&P.decoded.targetInfo.fields.ubootVersion!=null),msg:'uboot прочитан и записан в паспорт'},
    {id:'G-BATT',ok:!!(P&&P.battery.level!=null&&(P.battery.level>=30||P.battery.charging)),msg:'Батарея ≥ 30%'},
    {id:'G-BANK',ok:dp.known!==false,msg:'Известна схема банков (attr 8)',ev:dp.mode},
    {id:'G-BACKUP',ok:!!(S.dumpCert&&S.dumpCert.verified),msg:'Есть verified дамп для восстановления'},
    {id:'G-TEST',ok:!S.flags.testMode&&!S.flags.dump&&!S.flags.probe,msg:'TEST_MODE/probe не активны'},
    {id:'G-PHRASE',ok:($('#otaPhrase')&&$('#otaPhrase').value.trim().toUpperCase()===t('phraseWord'))&&($('#otaAck')&&$('#otaAck').checked),msg:'Фраза + подтверждение риска'}]}
const otaCanArm=()=>otaGates().every(g=>g.ok);
function armOta(){
  if(!otaCanArm())return toast('интерлок: не все условия выполнены','block');
  OTA.armed=true;otaLog('ЗАПИСЬ РАЗБЛОКИРОВАНА (arm) — 0xE3/0xE5/0xE7 разрешены');renderLab()}
function disarmOta(){OTA.armed=false;otaLog('запись заблокирована (disarm)');renderLab()}

/* ---------- Очередь кадров устройства для pull-цикла ---------- */
function otaQueue(){
  const q=[];let wake=null;
  const un=rcspHook(i=>{
    if(i.cmd===0xE5||i.cmd===0xE8||(i.cmd===0xE3&&(i.status!=null))||i.cmd===0xE6){q.push(i);if(wake){const f=wake;wake=null;f()}return true}
    return false});
  return{un,async next(ms){const end=Date.now()+ms;
    while(!q.length&&Date.now()<end&&!S.abort)await new Promise(r=>{wake=r;setTimeout(r,Math.min(60,Math.max(1,end-Date.now())))});
    return q.shift()||null}}}

/* ---------- Прошивка (PULL) ---------- */
async function otaFlash(){
  if(!OTA.armed)throw new Error('E-OTA-LOCK: запись заблокирована интерлоком');
  if(OTA.running)throw new Error('OTA занята');
  if(!S.buf)throw new Error('нет образа');
  const ufw=new Uint8Array(S.buf);OTA.running=true;S.abort=false;OTA.error=null;OTA.pass=1;OTA.highWater=0;OTA.result=null;
  S.prog={done:0,total:ufw.length,t0:performance.now(),start:0,win:0};
  const wl=await wakeHold();let pendingQueue=null;
  try{
    setPhase('preflight');
    if(OTA.canUpdate!==0){const p=await otaProbe();if(OTA.canUpdate!==0)throw new Error('E-OTA-001 устройство не согласно: '+e2txt(OTA.canUpdate))}
    let result;
    if(OTA.pass===1){
      const e1=OTA.e1||{offset:0,len:0};
      const mark=!(e1.offset===0&&e1.len===0)?ufw.subarray(e1.offset,e1.offset+e1.len):Uint8Array.of(0);
      if(!(e1.offset===0&&e1.len===0)&&e1.offset+e1.len>ufw.length)throw new Error('E-OTA-002 E1 требует байты за пределами файла — не тот образ');
      const e2=await rcspCmd(0xE2,mark,S.set.reqTo,{note:'OTA E2'});
      if(e2.kind!=='fe-response'||!e2.payload||e2.payload[0]!==0)throw new Error('E-OTA-001 E2='+hx(e2.payload&&e2.payload[0]));
      setPhase('armed');pendingQueue=otaQueue();
      await rcspCmd(0xE3,[],S.set.reqTo,{note:'OTA E3 enter-update'}); // устройству может прийти E5 до ответа на E3
      setPhase('transferring');result=await otaServe(ufw,pendingQueue);pendingQueue=null}
    if(result===0x80){ // loader загружен → relink, НЕ разрываем ссылку сами
      otaLog('E6=0x80: loader загружен, шлём 0x0B и ждём, что устройство само оборвёт связь');
      const sw=await rcspCmd(0x0B,[0x00,0x01],6000,{note:'OTA 0x0B switch-communication-way'});
      OTA.relinkFlag=sw.payload&&sw.payload.length?sw.payload[0]:null;
      setPhase('rebooting');
      const dropped=await waitConn(false,25000);
      if(!dropped)otaLog('устройство не оборвало связь за 25 с — пробуем reconnect сами');
      setPhase('resuming');
      const back=await otaRelink();
      if(!back)throw new Error('E-OTA-003 не удалось вернуться к loader. НЕ прошивайте вслепую — восстановление проводом.');
      await authHandshake(S.set.reqTo);
      const loader=await otaIsLoader();
      otaLog('pass 2: attr9 loader='+loader);
      OTA.pass=2;setPhase('transferring');
      pendingQueue=otaQueue();
      await rcspCmd(0xE3,[],S.set.reqTo,{note:'OTA E3 pass2'}); // E1/E2 в pass 2 НЕ повторяем
      result=await otaServe(ufw,pendingQueue);pendingQueue=null}
    OTA.result=result;
    if(result!==0)throw new Error('E-OTA-004 E6='+hx(result)+' '+e6txt(result));
    setPhase('rebooting');await rcspCmd(0xE7,[0x00],4000,{note:'OTA E7 reboot'}).catch(()=>{});
    otaLog('E7 отправлен, ждём возврата устройства');
    await waitConn(false,20000);await waitConn(true,60000);
    setPhase('verifying-marker');await collectMeta();
    setPhase('done');toast('OTA завершена: E6=0x00','ok');chime();
    return result}
  catch(e){OTA.error=e.message;setPhase('error');otaLog('✕ '+e.message);
    if(/E-OTA-004|E-OTA-003/.test(e.message)){S.locked=true;disarmOta()}
    throw e}
  finally{if(pendingQueue)pendingQueue.un();OTA.running=false;if(wl)wl.release().catch(()=>{});renderLab()}}

async function otaServe(ufw,Q=otaQueue()){
  const total=ufw.length;let idle=0;
  try{
    for(;;){
      if(S.abort)throw new Error('E-ABORT');
      const i=await Q.next(S.set.otaLoopTo);
      if(!i){idle++;otaLog('кадров нет '+S.set.otaLoopTo/1000+' с — опрашиваю E6');
        const r=await rcspCmd(0xE6,[],S.set.reqTo,{note:'OTA E6 poll'});
        if(r.kind==='fe-response'&&r.payload&&r.payload.length)return r.payload[0];
        if(idle>=3)throw new Error('E-OTA-002 устройство перестало запрашивать блоки');continue}
      idle=0;
      if(i.cmd===0xE5){
        const off=i.payload.length>=4?be32(i.payload):0,len=i.payload.length>=6?be16(i.payload,4):0;
        if(off===0&&len===0){await rcspAck(0xE5,i.sn,0,[],null,'OTA E5 done-signal');
          const r=await rcspCmd(0xE6,[],S.set.reqTo,{note:'OTA E6 after done'});
          return r.kind==='fe-response'&&r.payload&&r.payload.length?r.payload[0]:0xFF}
        if(off+len>total){await rcspAck(0xE5,i.sn,0x01,[],null,'OTA E5 out-of-range');throw new Error(`E-OTA-002 запрос за пределами образа: ${hx(off)}+${len}`)}
        const chunk=ufw.subarray(off,off+len);
        await rcspAck(0xE5,i.sn,0,chunk,null,`OTA E5 [${hx(off)}+${len}]`);
        if(off+len>OTA.highWater){OTA.highWater=off+len;S.prog.done=OTA.highWater;OTA.progress=OTA.highWater/total;tick();renderLab()}}
      else if(i.cmd===0xE8){const size=i.payload.length>=4?be32(i.payload):0;otaLog('E8 content-size='+size);await rcspAck(0xE8,i.sn,0,[],null,'OTA E8 ack')}
      else if(i.cmd===0xE6&&i.status!=null){return i.payload.length?i.payload[0]:0xFF}
      else if(i.cmd===0xE3){otaLog('E3 ack status='+hx(i.status))}}}
  finally{Q.un()}}

async function otaRelink(){
  try{await gattUp();if(S.gattReady)return true}catch(e){otaLog('reconnect: '+e.message)}
  // Устройство могло вернуться под ДРУГИМ адресом (маркер JLOTA) — Web Bluetooth требует нового выбора
  toast(t('otaRelink'),'block');S.otaRelinkNeeded=true;renderLab();
  const end=Date.now()+90000;
  while(Date.now()<end&&!S.abort){await sleep(1000);if(S.gattReady&&S.dev&&S.dev.gatt.connected)return true}
  return false}
// attr9 mandatory_upgrade_flag = 1 → мы говорим с loader'ом, а не с приложением
async function otaIsLoader(){
  const r=await rcspCmd(0x03,[0xFF,0xFF,0xFF,0xFF,0x00],S.set.reqTo,{note:'OTA 0x03 (loader check)'});
  if(r.kind!=='fe-response')return null;
  const tlv=parseTlv(r.payload||new Uint8Array(0));
  if(!tlv.ok)log('EV','ae02',null,`ERROR loader target_info TLV: ${tlv.error}; consumed=${tlv.consumed}/${tlv.total}`);
  const a=tlv.attrs.find(x=>x.type===9);
  return a&&a.data.length?a.data[0]===1:null}
// Наблюдение за рекламой JLOTA (Chrome: watchAdvertisements, может быть недоступен)
async function watchJlOta(){
  const d=S.dev;if(!d||!d.watchAdvertisements)return toast('watchAdvertisements недоступен в этом браузере','warn');
  const ac=new AbortController();S.advAc=ac;
  d.addEventListener('advertisementreceived',e=>{
    for(const[,v]of e.manufacturerData||[]){const u=new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength));
      const p=parseJlOtaAdv(u);if(p){S.jlOta=p;log('EV','',null,`JLOTA adv: MAC ${p.mac}`);toast('JLOTA: '+p.mac,'ok');renderLab()}}},{signal:ac.signal});
  try{await d.watchAdvertisements({signal:ac.signal});toast('слежу за рекламой JLOTA…')}catch(e){toast('adv: '+e.message,'warn')}}
const wakeHold=async()=>{try{return'wakeLock'in navigator?await navigator.wakeLock.request('screen'):null}catch{return null}};
