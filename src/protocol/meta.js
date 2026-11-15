/* ===== meta: паспорт устройства ===== */
const timePayload=(d=new Date())=>{const y=d.getFullYear();return[y&255,y>>8,d.getMonth()+1,d.getDate(),0,d.getHours(),d.getMinutes()]}; // год LE (qix-ble)
const ackOk=p=>p.then(()=>true,()=>false);
// Bootstrap Phase 1–5, ack-tolerant — последовательность из qix-ble bootstrap.py.
async function bootstrapFull(ms){const r={},rc=c=>ackOk(waitFor((k,u)=>k==='ae02'&&isFE(u,c),ms));let a;
  a=rc(0x06);await w('ae01',fe(0xC0,0x06,[0x02,0x00,0x01]),'reset_auth 0x06');
  await w('fd02',[0x9E,0xBD,0x0B,0x60,0x0D,0x00,0x03],'phase1 trigger (verbatim)').catch(()=>{});r.p1=await a;
  await qix(0x08,0x02,timePayload(),'time');await sleep(20);await qix(0x08,0x16,[1],'display');await sleep(20);await qix(0x0B,0x29,[0x80],'init 0x29');await sleep(200);
  a=rc(0x03);await w('ae01',fe(0xC0,0x03,[nextSN(),0xFF,0xFF,0xFF,0xFF,0x01]),'target_info 0x03');
  await qix(0x0B,0xC6,[1],'C6');await sleep(20);await qix(0x08,0x20,[0xFF,0x07],'0x20');r.p3=await a;
  a=rc(0x07);await w('ae01',fe(0xC0,0x07,[nextSN(),0xFF,0xFF,0xFF,0xFF,0xFF]),'sys_info 0x07');
  await qix(0x08,0xFF,[0x22,0x00],'0xFF 22');await sleep(40);await qix(0x08,0xFF,[0x24,0x00],'0xFF 24');r.p4=await a;
  await qix(0x0B,0x29,[0x80],'init 0x29');await sleep(400);
  a=ackOk(waitFor((k,u)=>k==='fd01'&&u[3]===0xC7,ms));await qix(0x0B,0xC6,[1],'C6');r.p5_c7=await a;
  a=ackOk(waitFor((k,u)=>(k==='fd01'||k==='fd03')&&u[0]===0x9E,ms));await qix(0x0B,0xDC,[0x0C],'0xDC');r.p5_ready=await a;
  return r}
async function collectMeta(){
  const t0=Date.now(),left=()=>Math.max(300,Math.min(S.set.reqTo,12000-(Date.now()-t0)));
  S.boot=false;S.f5HistoryKey=null;
  S.P={deviceId:S.dev.id,name:S.dev.name||null,advertisedName:S.dev.name||null,chipFamily:'unknown',sdkString:null,fwVersion:null,productName:null,battery:{level:null,charging:null,mode:null},gatt:S.gatt,
    capabilities:{qixFd00:!!S.chars.fd00,rcspOta:false,rcspOtaProbe:false,rcspOtaObserved:false,
      rcspTransport:!!(S.chars.ae01&&S.chars.ae02),batteryService:!!S.chars['2a19']},auth:{ok:false,keyProfile:null},
    testModeSuspected:!!S.flags.testMode,profileId:null,capturedAt:null,bootMarker:false,display:null,mac:null,targetInfo:null,sysInfo:null,decoded:null,
    f5History:[],unsupported:[],transport:{rcsp:!!(S.chars.ae01&&S.chars.ae02),sideband:!!(S.chars.fd01&&S.chars.fd02&&S.chars.fd03),qixFd00:!!S.chars.fd00},
    variant:null,charIds:Object.keys(S.chars).sort()};
  render();
  const step=async(n,f,force)=>{if(!force&&Date.now()-t0>12000)return log('EV','',null,n+': skipped (budget)');try{await f()}catch(e){log('EV','',null,`${n}: ${e.message}`)}};
  await step('name',async()=>{if(S.chars['2a00'])S.P.name=new TextDecoder().decode(await gq(()=>S.chars['2a00'].readValue()))||S.P.name});
  await step('passive',()=>sleep(Math.min(600,left())));
  await step('auth',async()=>{S.P.auth=await authHandshake(left())});
  if(S.P.auth.ok){
    await step('bootstrap',async()=>{const r=await bootstrapFull(Math.min(1500,left()));S.boot=true;log('EV','',null,'bootstrap '+JSON.stringify(r))})}
  else{if(S.set.rcspPreAuth){
      await step('0x03',()=>req('ae01',fe(0xC0,0x03,[nextSN(),0xFF,0xFF,0xFF,0xFF,0x01]),(k,u)=>k==='ae02'&&isFE(u,0x03),'target_info (pre-auth)',left()));
      await step('0x07',()=>req('ae01',fe(0xC0,0x07,[nextSN(),0xFF,0xFF,0xFF,0xFF,0xFF]),(k,u)=>k==='ae02'&&isFE(u,0x07),'sys_info (pre-auth)',left()))}
    await step('bootstrap (pre-auth)',async()=>{if(!S.chars.fd02)throw new Error('no FD02');
      await qix(0x08,0x02,timePayload(),'time');await qix(0x0B,0x29,[0x80],'init 0x29');await qreq(0xC6,[1],left(),{flags:0x0B,expect:0xC7})})}
  if(S.P.battery.level==null)await step('battery',async()=>{
    await waitFor((k,u)=>k==='fd01'&&u[3]===0x27,1500).catch(()=>{});if(S.P.battery.level==null)S.P.battery.level=await readBatt()},true);
  S.P.chipFamily=familyOf(S.P.sdkString);S.P.profileId=matchProfile(S.P,S.profiles);
  S.P.variant=S.P.capabilities.qixFd00?'Qix characteristic + RCSP AE00':S.P.transport.sideband?'FD01–FD05 sideband + RCSP AE00':'RCSP AE00 only';
  const profile=S.P.profileId&&S.profiles[S.P.profileId];
  const receiverMode=!!(profile&&profile.mode==='receiver')||/^Q87/i.test(S.dev&&S.dev.name||S.P.name||'');
  S.P.mode=receiverMode?'receiver':profile&&profile.mode||'standard';
  S.P.capabilities.rcspOta=!!(S.P.capabilities.rcspOtaObserved&&!receiverMode);
  S.P.unsupported=profile&&profile.unsupported?profile.unsupported.slice():[];
  S.P.fileTransfer=S.P.decoded&&S.P.decoded.targetInfo&&S.P.decoded.targetInfo.fields.fileTransfer?
    S.P.decoded.targetInfo.fields.fileTransfer.hex:null;
  S.P.authProfile=S.P.auth.keyProfile;
  S.P.transport={...S.P.transport,...(profile&&profile.transport||{})};
  if(profile){S.P.chip=profile.chip||null;S.P.family=profile.family||S.P.chipFamily;S.P.sdk=profile.sdk||S.P.sdkString}
  S.P.maxNotify={...S.maxNotify};S.P.capturedAt=new Date().toISOString();bindF5History();
  log('EV','',null,`passport ${Date.now()-t0} ms, auth=${S.P.auth.ok} boot=${S.boot} profile=${S.P.profileId}`);idb('passports',S.P);toast(t('meta'),S.P.profileId?'ok':'warn');render()}
