/* ===== meta ===== */
function timeFrame(d=new Date()){const y=d.getFullYear();return[0x9E,0x45,0x08,0x02,0x07,0x00,y>>8,y&255,d.getMonth()+1,d.getDate(),0x00,d.getHours(),d.getMinutes()]}
async function collectMeta(){
  const t0=Date.now(),left=()=>Math.max(300,Math.min(S.set.reqTo,10000-(Date.now()-t0)));
  S.P={deviceId:S.dev.id,name:S.dev.name||null,chipFamily:'unknown',sdkString:null,fwVersion:null,productName:null,battery:{level:null,charging:null},gatt:S.gatt,
    capabilities:{qixFd00:!!S.chars.fd00,rcspOta:!!(S.chars.ae01&&S.chars.ae02),batteryService:!!S.chars['2a19']},auth:{ok:false,keyProfile:null},
    testModeSuspected:!!S.flags.testMode,profileId:null,capturedAt:null,bootMarker:false,display:null,variant:null,charIds:Object.keys(S.chars).sort()};
  render();
  const step=async(n,f)=>{if(Date.now()-t0>10000)return log('EV','',null,n+': skipped (10 s budget)');try{await f()}catch(e){log('EV','',null,`${n}: ${e.message}`)}};
  await step('battery',async()=>{S.P.battery.level=await readBatt()});
  await step('name',async()=>{if(S.chars['2a00'])S.P.name=new TextDecoder().decode(await gq(()=>S.chars['2a00'].readValue()))||S.P.name});
  await step('passive FD01',()=>sleep(Math.min(1200,left())));
  await step('auth',async()=>{S.P.auth=await authHandshake(left())});
  // тела 0x03/0x07: SN + mask FFFFFFFF + platform/func (RCSP-конвенция; сверить с auracast e87-protocol.ts)
  if(S.P.auth.ok||S.set.rcspPreAuth){const pre=S.P.auth.ok?'':' (pre-auth)';
    await step('0x03',()=>req('ae01',fe(0xC0,0x03,[nextSN(),0xFF,0xFF,0xFF,0xFF,0x01]),(k,u)=>k==='ae02'&&isFE(u,0x03),'target_info'+pre,left()));
    await step('0x07',()=>req('ae01',fe(0xC0,0x07,[nextSN(),0xFF,0xFF,0xFF,0xFF,0xFF]),(k,u)=>k==='ae02'&&isFE(u,0x07),'sys_info'+pre,left()))}
  await step('bootstrap FD02',async()=>{if(!S.chars.fd02)throw new Error('no FD02');
    await w('fd02',timeFrame(),'time');await w('fd02',[0x9E,0xB5,0x0B,0x29,0x01,0x00,0x80],'heartbeat');
    const r=await req('fd02',[0x9E,0xD3,0x0B,0xC6,0x01,0x00,0x01],(k,u)=>k==='fd01'&&u[0]===0x9E&&u[3]===0xC7,'C6 info',left());
    const f=parse9E(r.u);if(f)S.P.display=decodeC7(f.payload)});
  if(S.P.battery.level==null&&S.chars['2a19'])await step('battery retry',async()=>{S.P.battery.level=await readBatt();
    if(S.P.battery.level==null)await waitFor((k,u)=>k==='2a19'&&u.length>0,Math.min(2000,10000-(Date.now()-t0))).catch(()=>log('EV','2a19',null,'no notify'))});
  S.P.chipFamily=familyOf(S.P.sdkString);S.P.profileId=matchProfile(S.P,S.profiles);S.P.variant=S.chars.fd00?'qix-fd00':'rcsp-only (no FD00 char)';
  if(!S.chars.fd00)log('EV','',null,'FD00 characteristic absent → Qix-OTA unavailable on this unit');S.P.capturedAt=new Date().toISOString();
  log('EV','',null,`passport ${Date.now()-t0} ms, profile=${S.P.profileId}`);idb('passports',S.P);toast(t('meta'),S.P.profileId?'ok':'warn');render()}
