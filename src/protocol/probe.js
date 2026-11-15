/* ===== protocol/probe — Raw Probe, сканер опкодов, карта возможностей (Фаза 1) =====
 * Скан ограничен коротким allowlist подтверждённых read-only команд; остальные пропускаются.
 * Каждый результат классифицируется: fe-response / fe-push / sideband-data / generic-ack / timeout.
 * generic-ack НИКОГДА не считается поддержкой функции (ТЗ §0.2).
 */
const PROBE={running:false,scan:[],last:null,progress:0};
const PROBE_FE_SAFE=new Set([0x02,0x03,0x07,0xE1,0xE2,0xE6]);
const PROBE_9E_SAFE=new Set([0xC6]);
function validateReadOnlyProbe(transport,u){
  if(transport==='ae01'){
    if(u.length<8||u[0]!==0xFE||u[1]!==0xDC||u[2]!==0xBA||u[u.length-1]!==0xEF||u[3]!==0xC0)
      throw new Error('Ожидается полный FE DC BA C0 ... EF request');
    const len=(u[5]<<8)|u[6],bodyLen={0x02:1,0x03:6,0x07:6,0xE1:1,0xE2:2,0xE6:1}[u[4]];
    if(u.length!==len+8||!PROBE_FE_SAFE.has(u[4])||len!==bodyLen)throw new Error('Команда не входит в allowlist точных read-only RCSP кадров')}
  else if(transport==='fd02'){
    const f=parse9E(u);
    if(!f||!f.complete||u.length!==f.len+6||!f.ok||!PROBE_9E_SAFE.has(f.cmd)||f.flags!==0x0B||f.len!==1||f.payload[0]!==1)
      throw new Error('Разрешён только подтверждённый C6 → C7 screen-info запрос')}
  else throw new Error('Неизвестный транспорт')}
// Доказательства из полевого лога 2026-11-14 (data/session-2026-11-14.log) — стартовая карта
const EVIDENCE_SEED=[
  {op:0x02,transport:'AE01',kind:'fe-response',len:0,status:2,verdict:'unsupported',note:'GET_TARGET_FEATURE_MAP returned JL_PRO_STATUS_UNKNOWN_CMD in the supplied capture',src:'user-capture'},
  {op:0x06,transport:'AE01',kind:'fe-response',len:2,status:0,verdict:'ok',dataHex:'',note:'Phase-1 reset_auth, устройство отвечает FE',src:'log'},
  {op:0x03,transport:'AE01',kind:'fe-response',len:125,status:0,verdict:'ok',dataHex:'02 00 20 05 01 00 00 00 00 09 02 46 88 00 02 09 DC',note:'target_info: полный TLV 125 Б; dataHex приведён префиксом',src:'log'},
  {op:0x07,transport:'AE01',kind:'fe-response',len:56,status:0,verdict:'ok',dataHex:'00 1A 02 04 00 00 00 00',note:'sys_info: TLV 56 Б; dataHex приведён префиксом',src:'log'},
  {op:0xC6,transport:'FD02',kind:'sideband-data',len:13,status:null,verdict:'ok',dataHex:'01 68 01 68 01 70 01 70 01 F4 10 00 00',note:'C6 → C7 screen_info 360/360/368/368',src:'log'},
  {op:0x27,transport:'FD01',kind:'sideband-data',len:2,status:null,verdict:'ok',dataHex:'',note:'battery push [mode=00, percent=5B–5D] = 91–93%',src:'log'},
  {op:0x21,transport:'FD01',kind:'sideband-data',len:2,status:null,verdict:'ok',note:'sync_state',src:'log'},
  {op:0x22,transport:'FD01',kind:'sideband-data',len:21,status:null,verdict:'stub',note:'steps: заглушка watch-SDK (датчиков нет)',src:'log'},
  {op:0x24,transport:'FD01',kind:'sideband-data',len:7,status:null,verdict:'stub',note:'hr: заглушка watch-SDK',src:'log'},
  {op:0xE5,transport:'AE01',kind:'fe-push',len:6,status:null,verdict:'observed-request',dataHex:'00 00 00 00 00 08',
    note:'OTA pull request captured; request alone does not validate the image or arm transfer',src:'user-capture'},
  {op:0xA0,transport:'FD02',kind:'generic-ack',len:2,status:0,verdict:'ack-only',dataHex:'A0 00',note:'Historical probe only; SDK names this SPORTS_DATA_INFO_GET, not a flash command',src:'log'},
  {op:0xAA,transport:'FD02',kind:'generic-ack',len:2,status:0,verdict:'ack-only',dataHex:'AA 00',note:'Historical ACK-only probe; semantics unverified and not a flash-read command',src:'log'},
  {op:0xA6,transport:'FD02',kind:'generic-ack',len:2,status:0,verdict:'ack-only',dataHex:'A6 00',note:'Historical probe only; SDK names this SPORTS_DATA_SYNC, not a flash command',src:'log'}];

/* Raw Probe accepts only the bounded read-only request allowlist. */
async function rawProbe({transport='ae01',hexBytes='',ms=null,note='raw probe'}={}){
  const u=fromHex(hexBytes);
  if(!u.length)throw new Error('пустой кадр');
  validateReadOnlyProbe(transport,u);
  const wait=Math.max(500,Math.min(10000,Number(ms)||S.set.probeTo));
  const r=await probeFrame(transport,u,wait,{note});
  const rec={ts:new Date().toISOString(),transport,tx:hex(u),kind:r.kind,ms:r.ms,
    frames:(r.frames||[]).map(f=>({kind:f.kind,ch:f.ch,cmd:f.cmd==null?null:hx(f.cmd),status:f.status==null?null:hx(f.status),
      len:f.payload?f.payload.length:(f.len??null),hex:f.raw?hex(f.raw):''})),
    verdict:r.kind==='timeout'?'нет ответа':isRealResponse(r)?'реальный ответ':r.kind==='fe-push'?'неожиданный FE push':'только транспортный ACK'};
  PROBE.last=rec;S.rawLog.unshift(rec);if(S.rawLog.length>200)S.rawLog.pop();
  log('EV',transport,null,`raw probe → ${rec.verdict} (${rec.kind}, ${rec.frames.length} кадр(ов), ${rec.ms} мс)`);
  renderLab();return rec}
// Удобные построители кадров для панели
const buildFeCmd=(cmd,payload=[],sn=null)=>fe(FE_FLAG.cmd,cmd&255,Uint8Array.of(sn==null?nextSN():sn,...bytesOf(payload)));
const build9E=(flags,cmd,payload=[])=>qixEncode(flags,cmd&255,bytesOf(payload));

/* Систематический скан 0x00…0xFF (read-only) */
async function scanOpcodes({from=0,to=255,transport='ae01',ms=null}={}){
  if(PROBE.running)throw new Error('скан уже идёт');
  if(transport!=='ae01')throw new Error('автоматизированный скан доступен только для RCSP AE01');
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>255||from>to)throw new Error('диапазон опкодов должен быть от 0 до 255');
  if(!S.P||!S.P.auth.ok)throw new Error('нужен auth');
  PROBE.running=true;S.abort=false;PROBE.scan=[];
  const wait=Math.max(500,Math.min(10000,Number(ms)||S.set.scanTo)),total=to-from+1;let done=0;
  log('EV','',null,`скан опкодов ${hx(from)}…${hx(to)} по ${transport}, окно ${wait} мс, read-only`);
  try{
    for(let op=from;op<=to;op++){
      if(S.abort){log('EV','',null,'скан прерван');break}
      done++;PROBE.progress=done/total;
      if(!scanAllowed(op)){PROBE.scan.push({op,opHex:hx(op),skipped:true,reason:'нет в allowlist read-only команд',kind:'skipped'});renderLab();continue}
      const payload=op===0x03?[0xFF,0xFF,0xFF,0xFF,0x01]:op===0x07?[0x00,0xFF,0xFF,0xFF,0xFF]:op===0xE2?[0x00]:[];
      const frame=buildFeCmd(op,payload);
      const r=await probeFrame(transport,frame,wait,{note:`scan ${hx(op)}`});
      const f=r.frames||[];
      const real=f.filter(x=>isRealResponse(x)&&x.cmd===op);
      const best=real[0]||f.find(x=>x.kind==='generic-ack')||f.find(x=>x.kind==='fe-push')||null;
      const rec={op,opHex:hx(op),name:opName(op),cls:opClass(op),transport,
        kind:best?best.kind:'timeout',status:best&&best.status!=null?best.status:null,
        len:best?(best.payload?best.payload.length:best.len??0):0,
        dataHex:best&&best.payload?hex(best.payload.subarray(0,64)):'',
        frames:f.length,ms:r.ms,
        verdict:best?(isRealResponse(best)?(best.status===0||best.status==null?'ok':'status '+statusName(best.status)):best.kind==='fe-push'?'unsolicited-push':'ack-only'):'нет ответа',
        confidence:best&&isRealResponse(best)?'measured':'measured-negative'};
      PROBE.scan.push(rec);
      if(best&&isRealResponse(best))log('EV','',null,`scan ${hx(op)} ${opName(op)} → ${best.kind} len=${rec.len} status=${rec.status==null?'—':statusName(rec.status)}`);
      renderLab()}
    S.scan=PROBE.scan;S.capMatrix=buildCapabilityMatrix();
    log('EV','',null,`скан завершён: ${PROBE.scan.filter(x=>x.verdict==='ok').length} подтверждённых, ${PROBE.scan.filter(x=>x.kind==='generic-ack').length} ack-only, ${PROBE.scan.filter(x=>x.kind==='timeout').length} молчащих`);
    toast('скан завершён','ok');return PROBE.scan}
  finally{PROBE.running=false;renderLab()}}

/* Карта возможностей: скан + полевые доказательства + паспорт */
function buildCapabilityMatrix(){
  const rows=[],seen=new Set();
  const push=r=>{rows.push(r);seen.add(r.transport+':'+r.op)};
  for(const s of PROBE.scan.filter(x=>!x.skipped))push({op:s.op,opHex:s.opHex,name:s.name,transport:s.transport==='fd02'?'FD02':'AE01',
    kind:s.kind,status:s.status,len:s.len,dataHex:s.dataHex,verdict:s.verdict,confidence:s.confidence,source:'scan',
    sdk:(opInfo(s.op)||{}).sdk_name||null,note:(opInfo(s.op)||{}).semantics||null});
  for(const e of EVIDENCE_SEED)if(!seen.has(e.transport+':'+e.op)){
    const sideband=e.transport.startsWith('FD'),info=opInfo(e.op);
    push({op:e.op,opHex:hx(e.op),name:sideband?(QIX_OPS[e.op]||{}).n||opName(e.op):opName(e.op),transport:e.transport,kind:e.kind,
    status:e.status,len:e.len,dataHex:e.dataHex||'',verdict:e.verdict,confidence:'field-log',source:'field-capture',note:e.note,
    sdk:sideband?null:info&&info.sdk_name||null})}
  const P=S.P;
  return{artifact:'capability-matrix.json',generatedAt:new Date().toISOString(),
    device:P?{deviceId:P.deviceId,name:P.name,mode:P.mode,chipFamily:P.chipFamily,sdkString:P.sdkString,fwVersion:P.fwVersion,
      productFirmware:P.productFirmware||null,profileId:P.profileId,
      uboot:P.decoded&&P.decoded.targetInfo?P.decoded.targetInfo.fields.ubootVersion:null}:null,
    rules:{success:'matching fe-response or relevant sideband-data; fe-push and generic-ack are not success',
      notSuccess:'generic-ack (9E … FF 02 00 echo status) — только приём байтов',
      scanPayload:'per-opcode read-only request bodies; unknown/write opcodes are skipped',
      skipped:'all commands outside the read-only allowlist'},
    unsupported:(P&&P.unsupported)||['qix-ota','ble-raw-dump'],
    count:rows.length,rows:rows.sort((a,b)=>a.op-b.op)}}
const exportMatrix=()=>download('capability-matrix.json',S.capMatrix||buildCapabilityMatrix());

/* Диагностика транспорта: MTU, каналы, подписки */
function transportReport(){
  return{chars:Object.keys(S.chars).sort(),notifySubscribed:NOTIFY.filter(k=>S.chars[k]),maxNotify:{...S.maxNotify},
    mtuGuess:mtuGuess(),qixFd00:!!S.chars.fd00,rcsp:!!(S.chars.ae01&&S.chars.ae02),
    sideband:!!(S.chars.fd01&&S.chars.fd02),fd05:!!S.chars.fd05}}
