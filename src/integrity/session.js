/* ===== integrity/session: post-flash верификация, readback, дампы, сертификаты, UI ===== */
const rctx=()=>({w,req,waitFor,set:S.set,log,passport:S.P});
const spanNow=()=>parseSpan(S.set.verifySpan)||[0,0xFC000];
async function computeSlices(){if(!S.R)return;const sp=spanNow(),{flashBin,appBin}=S.img||{};S.R.verifySpan=sp.map(hx).join(':');
  S.R.slices={onflash:flashBin?await sha256hex(spanSlice(flashBin,sp)):null,plain:appBin?await sha256hex(spanSlice(appBin,[0,sp[1]-sp[0]])):null}}
async function withWake(fn){let wl=null;try{if('wakeLock' in navigator)wl=await navigator.wakeLock.request('screen')}catch{}S.wake=wl;
  try{return await fn()}finally{if(wl)wl.release().catch(()=>{});S.wake=null}}

async function runVerify(mode){ // 'auto' | 'L1' | 'L2'
  const prof=S.profiles[S.P&&S.P.profileId];if(!prof)throw new Error('E-OTA-005 profile lost');
  const io={qreq},span=spanNow();
  const rep=await verifyFlash({l0:S.l0,span,cands:S.R.slices,form:prof.expectedForm||null,
    caps:mode==='L1'?async()=>0:()=>readCaps(io,S.set.reqTo),
    hash:async(a,l)=>{setPhase('verifying-hash');if(QIX.enterService)await QIX.enterService(rctx());return hashRange(io,a,l,prof.flash.size,S.set.hashTo)},
    readback:mode==='L2'||!READBACK.ready?null:async(a,l)=>{
      if(mode==='auto'&&!S.set.readbackOffer||!confirm(t('rbConfirm')))throw new Error('readback declined');
      setPhase('verifying-readback');S.flags.testMode=true;saveFlags(); // readback = TEST_MODE → R-TEST до power-cycle
      S.prog={done:0,total:l,t0:performance.now(),start:0,win:0};
      const rb=await READBACK.dumpRange(rctx(),a,l,d=>{S.prog.done=d;tick()});toast(t('needPC'),'warn');return rb},
    sha:sha256hex,onCalibrate:f=>{prof.expectedForm=f;SV('profiles.v3',S.profiles);log('EV','',null,'form calibrated → '+f)}});
  S.int={...rep,acceptedPartial:false};log('EV','',null,`integrity ${rep.level} ${rep.verdict} ${rep.errors.join(', ')}`);
  idb('sessions',{integrity:S.int});render();return S.int}
async function reverify(mode){
  if(!S.l0||!S.R||S.conn!=='on'||ACTIVE.includes(S.phase)||!S.P||!S.P.profileId)return;
  if(S.l0.imageSha256!==S.R.sha256)return toast(t('imgChanged'),'warn');
  await withWake(async()=>{try{const r=await runVerify(mode);if(r.verdict==='failed'){S.locked=true;toast(t('e_int'),'block')}setPhase(r.verdict==='failed'?'error':'done')}
    catch(e){setPhase('error');toast(e.message,'block')}})}

/* --- сертификаты: HMAC-SHA256, неэкспортируемый ключ этого браузера в IndexedDB --- */
const canon=c=>{const{sig,sigOk,...r}=c;return new TextEncoder().encode(JSON.stringify(r))};
const stripCert=({sigOk,...c})=>c;
async function certKey(){let k=await idbGet('keys','cert').catch(()=>null);
  if(!k){k=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);await idbPut('keys','cert',k).catch(()=>{})}return k}
async function signCert(c){c.sig=hex(new Uint8Array(await crypto.subtle.sign('HMAC',await certKey(),canon(c))),'').toLowerCase();return c}
async function verifyCert(c){try{return!!c.sig&&await crypto.subtle.verify('HMAC',await certKey(),fromHex(c.sig),canon(c))}catch{return false}}
async function certify(buf,passport,prof,method){
  const c=await validateDump(buf,passport,prof,method,{...JL,reRead:method==='ble-testmode'&&READBACK.ready?(a,l)=>READBACK.dumpRange(rctx(),a,l):null,spotN:S.set.spotN,sha:sha256hex});
  await signCert(c);S.dumpCert={...c,sigOk:true};
  log('EV','',null,`certificate ${method} verified=${c.verified} ${c.errors.join(', ')}`);toast(t(c.verified?'certOk':'certBad'),c.verified?'ok':'block');render();return c}
// геометрия для дампа: из профиля, если он её знает (у e87-ac697x её нет), иначе общая 4 МиБ с размером из настроек
const dumpProf=size=>{const p=S.P&&S.profiles[S.P.profileId];return p&&p.flash?p:{...GENERIC4M,flash:{...GENERIC4M.flash,size:size||GENERIC4M.flash.size}}};
// дамп больше реального флеша обычно «заворачивается» на начало — ловим зеркало
function mirrorCheck(buf){for(let h=buf.length>>1;h>=0x40000;h>>=1){let m=true;for(let o=0;o<h&&m;o+=0x10000)m=eq(buf.subarray(o,o+4096),buf.subarray(h+o,h+o+4096));if(m)return h}return 0}
async function takeDump(){
  if(dumpBlockers().length||!confirm(t('dumpConfirm')))return;
  const size=Number(S.set.dumpSize)||0x400000,prof=dumpProf(size),passport=structuredClone(S.P);S.abort=false;
  await withWake(async()=>{try{setPhase('dumping');S.prog={done:0,total:size,t0:performance.now(),start:0,win:0};
      S.dumpBuf=await READBACK.dumpRange(rctx(),0,size,d=>{S.prog.done=d;tick()});
      const mir=mirrorCheck(S.dumpBuf);if(mir){log('EV','',null,`dump: mirror at ${hx(mir)} → flash likely ${hx(mir)} B`);toast(t('e_mirror')+' '+hx(mir),'warn')}
      const c=await certify(S.dumpBuf,passport,prof,'ble-testmode');download('dump.bin',S.dumpBuf);download('dump.cert.json',c);setPhase('done')}
    catch(e){setPhase('error');log('EV','',null,'dump ✕ '+e.message);toast('dump: '+e.message,'block')}})}
async function spotCheck(){
  if(!S.dumpBuf||!S.dumpCert||dumpBlockers().length)return;S.abort=false;
  await withWake(async()=>{try{setPhase('dumping');const c=await certify(S.dumpBuf,S.dumpCert.passport,dumpProf(S.dumpBuf.length),'ble-testmode');download('dump.cert.json',c);setPhase('done')}
    catch(e){setPhase('error');log('EV','',null,'spot-check ✕ '+e.message);toast('spot-check: '+e.message,'block')}})}
async function certifyWired(){
  if(!S.R||S.R.kind!=='full-dump'||!S.P||ACTIVE.includes(S.phase)||!confirm(t('wiredConfirm')))return;
  try{download('dump.cert.json',await certify(new Uint8Array(S.buf),S.P,dumpProf(S.buf.byteLength),'wired-uboot'))}catch(e){toast('cert: '+e.message,'block')}}

// причины, по которым дамп недоступен — показываются под кнопками вместо «серой» без объяснений
const dumpBlockers=()=>[S.conn!=='on'&&'h_conn',!(S.P&&S.P.auth.ok)&&'h_auth',!S.boot&&'h_boot',ACTIVE.includes(S.phase)&&'h_busy',!READBACK.ready&&'h_port'].filter(Boolean);
function renderInt(){
  const r=S.int,c=S.dumpCert,on=S.conn==='on',act=ACTIVE.includes(S.phase),ready=on&&!act&&S.P&&S.P.profileId;
  const sv=x=>x===true?'pass':x===false?'block':'warn';
  const row=(id,sev,msg,ev)=>`<li class="rule rule--${sev}"><span class="rule__i" aria-label="${sev}">${{pass:'✓',warn:'⚠',block:'✕'}[sev]}</span><span class="rule__id">${esc(id)}</span><span>${esc(msg)}</span><span class="rule__ev">${esc(ev)}</span></li>`;
  $('#intBadge').className='lvl'+(r?' lvl--'+r.verdict:'');$('#intBadge').textContent=r?`${r.level} ${r.verdict}${r.acceptedPartial?' ✓':''}`:'—';
  $('#intChecks').innerHTML=r?[
    row('chunk CRC',sv(r.chunkCrc.fail===0&&r.chunkCrc.ok>0),t('i_chunk'),`ok=${r.chunkCrc.ok} fail=${r.chunkCrc.fail}`),
    row('file CRC16',sv(r.wholeFileCrc16.ok),t('i_whole'),hx(r.wholeFileCrc16.value)),
    row('UFW CRC',sv(['hdr','list','data'].every(k=>r.ufwCrc[k]===true)),'hdr / list / data / qix',JSON.stringify(r.ufwCrc)),
    row('JL CRC',sv(r.internalJlCrcOk),t('i_jl'),String(r.internalJlCrcOk)),
    row('boot',sv(r.bootMarker.ok),t('i_boot'),`${r.bootMarker.value||'—'} name=${r.nameChanged} ${r.versionBefore||'—'} → ${r.versionAfter||'—'}`),
    row('R-READBACK',r.verdict==='verified'?'pass':r.verdict==='partial'?'warn':'block',t('i_rb'),`${r.readback.method} ${r.readback.formUsed||''} ${r.errors.join(', ')}`)].join(''):'';
  kv('#intDig',r&&{image:r.imageSha256,expected:r.readback.expected||r.codeSliceSha256,device:r.readback.digest},'—');
  $('#certPre').textContent=c?JSON.stringify({...stripCert(c),sigOk:c.sigOk,passport:c.passport&&{deviceId:c.passport.deviceId,name:c.passport.name,fwVersion:c.passport.fwVersion}},null,2):'—';
  $('#btnRb').disabled=!(ready&&S.l0&&S.R&&READBACK.ready);$('#btnRh').disabled=!(ready&&S.l0&&S.R);
  $('#btnAccept').hidden=!(r&&r.verdict==='partial'&&!r.acceptedPartial);$('#btnCopyDig').disabled=!r;
  const db=dumpBlockers();$('#btnDump').disabled=!!db.length;$('#btnSpot').disabled=!!db.length||!S.dumpBuf;
  $('#dumpHint').textContent=db.length?t('h_dump')+': '+db.map(t).join(', '):'';
  $('#btnCertWired').disabled=!(S.R&&S.R.kind==='full-dump'&&S.P&&!act);
  $('#btnExpCert').disabled=!c;$('#btnExpInt').disabled=!r}
