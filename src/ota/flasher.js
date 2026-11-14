/* ===== gate & flasher ===== */
const ctxNow=()=>({path:S.path,lang:S.set.lang,profiles:S.profiles,ubootAllow:S.allow.uboot,imageAllow:S.allow.image,maxImage:16<<20,qixReady:QIX.ready,rcspReady:RCSP_READY,
  connected:!!(S.dev&&S.dev.gatt.connected&&S.gattReady),phoneBtOff:$('#phoneBt').checked,flags:S.flags,dumpCert:S.dumpCert});
const gateOk=()=>!S.locked&&!!S.V&&(S.V.overall==='ALLOW'||S.V.overall==='WARN'&&$('#phrase').value.trim().toUpperCase()===t('phraseWord')&&$('#riskAck').checked);
const saveFlags=()=>SV('flags',S.flags);
function setPhase(p){S.phase=p;log('EV','',null,'phase → '+p);render()}
let rafId=0;const tick=()=>{if(!rafId)rafId=requestAnimationFrame(()=>{rafId=0;ring()})};

async function transfer(ctx){
  const img=ctx.image,cs=Math.min(490,S.set.chunk),ws=S.set.win,total=img.length;let off=0;
  outer:while(off<total){
    if(S.abort)throw new Error('E-ABORT');
    if(S.phase==='paused'){if(!await waitConn(true,70000))throw new Error('E-OTA-003 link lost');
      setPhase('resuming');await QIX.resume(ctx,off);setPhase('transferring');S.prog.start=off;S.prog.t0=performance.now()}
    const chunks=[];for(let o=off;chunks.length<ws&&o<total;o+=cs){const d=img.subarray(o,Math.min(o+cs,total));chunks.push({off:o,data:d,crc:crc16(d)})}
    let ack;
    for(let tries=0;;tries++){
      try{ack=await withTimeout(QIX.sendWindow(ctx,{offset:off,chunks}),S.set.winTo,'E-OTA-002 window timeout');break}
      catch(e){if(S.phase==='paused')continue outer;if(S.abort)throw new Error('E-ABORT');
        if(tries>=S.set.retries)throw new Error(e.message.startsWith('E-')?e.message:'E-OTA-002 '+e.message);
        log('EV','',null,`window @${hx(off)} retry ${tries+1}: ${e.message}`);await sleep(200*2**tries)}}
    if(!ack||ack.crcOk!==true){S.chunkCrc.fail+=chunks.length;throw new Error('E-OTA-002 chunk CRC @'+hx(off))}S.chunkCrc.ok+=chunks.length;
    const l=chunks[chunks.length-1];off=l.off+l.data.length;S.prog.done=off;S.prog.win++;tick()}}

async function flash(){
  if(!gateOk()||ACTIVE.includes(S.phase))return;
  const before=structuredClone(S.P),vBefore=structuredClone(S.V),t0=Date.now();let err=null;S.abort=false;
  S.prog={done:0,total:S.buf.byteLength,t0:performance.now(),start:0,win:0};S.chunkCrc={ok:0,fail:0};S.int=null;S.l0=null;
  const ctx={w,req,waitFor,set:S.set,log,image:new Uint8Array(S.buf),report:S.R,passport:S.P};
  try{
    setPhase('preflight');
    const lvl=await readBatt();if(lvl==null)throw new Error('E-PRE battery read');S.P.battery.level=lvl;render();
    if(!gateOk())throw new Error('E-PRE verdict');
    if(!('wakeLock' in navigator))throw new Error('E-PRE Wake Lock unsupported');S.wake=await navigator.wakeLock.request('screen');
    setPhase('armed');
    try{await QIX.begin(ctx)}catch(e){S.P.testModeSuspected=true;throw new Error('E-OTA-001 '+e.message)}
    setPhase('transferring');await transfer(ctx);
    setPhase('applying');let applied;
    try{applied=await QIX.apply(ctx);setPhase('rebooting');await waitConn(false,30000);if(!await waitConn(true,70000))throw new Error('no return')}
    catch(e){throw new Error('E-OTA-004 '+e.message)}
    setPhase('verifying-marker');await collectMeta();
    const nameChanged=S.P.name==='EC-BADGE'&&before.name!=='EC-BADGE',verChanged=!!S.P.fwVersion&&S.P.fwVersion!==before.fwVersion;
    S.l0={imageSha256:S.R.sha256,chunkCrc:{...S.chunkCrc},wholeFileCrc16:{value:S.R.fileCrc16,ok:!!applied&&applied.wholeFileCrcOk===true},ufwCrc:{...S.R.crc},
      internalJlCrcOk:S.R.internalJlCrcOk,bootMarker:{ok:S.P.profileId===before.profileId&&(nameChanged||verChanged||!!S.P.bootMarker),value:S.P.bootMarker?'BADGE-FWMARK':null},
      nameChanged,versionBefore:before.fwVersion,versionAfter:S.P.fwVersion};
    const rep=await runVerify('auto');
    if(rep.verdict==='failed')throw new Error((S.l0.bootMarker.ok?'E-INT-006 ':'E-OTA-005 ')+rep.errors.join(', '));
    setPhase('done');toast(`${t('ok_done')}: ${rep.level} ${rep.verdict}`,rep.verdict==='verified'?'ok':'warn');chime()}
  catch(e){err=e.message;S.phase='error';onFlashErr(e)}
  finally{if(S.wake)S.wake.release().catch(()=>{});S.wake=null;
    S.report={image:{name:S.R.fileName,sha256:S.R.sha256,size:S.R.size},path:S.path,passportBefore:before,passportAfter:S.P,verdict:vBefore,
      startedAt:new Date(t0).toISOString(),durationMs:Date.now()-t0,bytesSent:S.prog.done,result:err?'error':'done',error:err,integrity:S.int};
    idb('sessions',{report:S.report,log:S.log});render()}}
function onFlashErr(e){const m=e.message;log('EV','',null,'ERROR '+m);
  if(m.startsWith('E-OTA-001'))toast(t('e_ota1'),'block');
  else if(m.startsWith('E-OTA-004')){S.locked=true;toast(t('e_ota4'),'block')}
  else if(m.startsWith('E-OTA-003')&&S.prog.done===0)toast(t('e_bond'),'block');
  else if(m.startsWith('E-INT')||m.startsWith('E-OTA-005')){S.locked=true;toast(t('e_int'),'block')}
  else toast(m,'block')}
async function probe(){
  if(!QIX.ready||!S.P||!S.P.profileId||ACTIVE.includes(S.phase)||!confirm(t('probeConfirm')))return;
  S.flags.probe=true;saveFlags();
  try{await QIX.probe({w,req,waitFor,set:S.set,log,image:new Uint8Array(S.buf||new ArrayBuffer(0)),report:S.R,passport:S.P});log('EV','',null,'probe ok, power-cycle required')}
  catch(e){log('EV','',null,'probe: '+e.message);toast('probe: '+e.message,'warn')}render()}
function powerCycled(){if(ACTIVE.includes(S.phase)||!confirm(t('pcConfirm')))return;
  S.flags={testMode:false,dump:false,probe:false};saveFlags();if(S.P)S.P.testModeSuspected=false;disconnect();render()}
