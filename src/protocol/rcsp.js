/* ===== protocol/rcsp — сессионный слой RCSP (AE00) + классификация ответов =====
 * Ключевое правило ТЗ §0.2: generic-ack (9E … FF 02 00 <echo> <status>) — это
 * «принял байты», а НЕ исполнение команды. Успех = fe-response или sideband-data.
 * Кадры и внутренняя рамка: data/rcsp-opcodes.json → framing.
 */
const FE_FLAG={cmd:0xC0,push:0x80,resp:0x00};
// Внутренняя рамка RCSP: команда [sn][xmOp if cmd==0x01][payload]; ответ [status][sn][xmOp if 0x01][payload]
function feInner(u){
  const flag=u[3],cmd=u[4],len=be16(u,5),body=u.subarray(7,7+len);
  const isCmd=(flag&0x80)!==0,hasResp=(flag&0x40)!==0;
  let sn=0,xmOp=null,status=null,off=0;
  if(isCmd){sn=body[0]??0;off=1;if(cmd===0x01&&body.length>=2){xmOp=body[1];off=2}}
  else{status=body[0]??0;sn=body[1]??0;off=2;if(cmd===0x01&&body.length>=3){xmOp=body[2];off=3}}
  return{flag,cmd,len,isCmd,hasResp,sn,xmOp,status,statusName:status==null?null:statusName(status),payload:body.subarray(off),body,raw:u}}

const RESP_KINDS=['fe-response','fe-push','sideband-data','generic-ack','timeout'];
// Классификация одного кадра (или его отсутствия)
function classifyFrame(ch,u){
  if(!u)return{kind:'timeout'};
  if(u[0]===0xFE&&u[1]===0xDC&&u[2]===0xBA){const i=feInner(u);return{kind:i.isCmd?'fe-push':'fe-response',...i,ch}}
  const f=parse9E(u);
  if(f){const ack=f.cmd===0xFF&&f.len===2;
    return{kind:ack?'generic-ack':'sideband-data',ch,cmd:f.cmd,len:f.len,payload:f.payload,chkOk:f.ok,
      echo:ack?f.payload[0]:null,status:ack?f.payload[1]:null,raw:u}}
  return{kind:'unknown',ch,raw:u}}
const isRealResponse=r=>r&&(r.kind==='fe-response'||r.kind==='sideband-data');
const kindRu={
  'fe-response':['FE-ответ (реальный)','FE response (real)'],'fe-push':['FE-команда устройства','device FE command'],
  'sideband-data':['9E-данные (реальные)','9E data (real)'],'generic-ack':['транспортный ACK (не исполнение)','transport ACK (not execution)'],
  timeout:['таймаут','timeout'],unknown:['не разобрано','unparsed']};
const kindTxt=k=>(kindRu[k]||[k,k])[S.set.lang==='en'?1:0];

/* Запись FE-кадра в AE01 с фрагментацией: парсер JieLi собирает поток,
   поэтому один кадр можно резать на несколько writeWithoutResponse (ebadge-python-cli). */
async function rcspWrite(frame,note){
  const cs=Math.max(20,Math.min(490,S.set.chunk|0||490));
  if(frame.length<=cs)return w('ae01',frame,note);
  for(let i=0;i<frame.length;i+=cs)await w('ae01',frame.subarray(i,Math.min(i+cs,frame.length)),note?`${note} [${i}]`:'');
}
// Команда телефона: sn проставляется автоматически, если payload не начинается с явного sn
async function rcspCmd(cmd,payload=[],ms=S.set.reqTo,{sn=null,note='',flag=FE_FLAG.cmd}={}){
  const s=sn==null?nextSN():sn,body=Uint8Array.of(s,...bytesOf(payload));
  const p=waitFor((k,u)=>k==='ae02'&&u[0]===0xFE&&u[4]===cmd&&(u[3]&0x80)===0,ms);p.catch(()=>{});
  await rcspWrite(fe(flag,cmd,body),note||`RCSP ${hx(cmd)} ${opName(cmd)}`);
  try{const r=await p;return{...classifyFrame('ae02',r.u),sn:s,ok:true}}
  catch(e){return{kind:'timeout',cmd,sn:s,ok:false,error:e.message}}}
// Ответ телефона на команду/пуш устройства (обязателен для 0x01/0x0D/0xE5/0xE8/0x20/0x1C)
async function rcspAck(cmd,sn,status=0,payload=[],xmOp=null,note=''){
  const body=[status&255,sn&255];if(cmd===0x01&&xmOp!=null)body.push(xmOp&255);
  return rcspWrite(fe(FE_FLAG.resp,cmd,Uint8Array.of(...body,...bytesOf(payload))),note||`ACK ${hx(cmd)} sn=${hx(sn)}`)}

/* Маршрутизация входящих FE-команд устройства.
   Активная сессия (browse / OTA / content) регистрирует хук и сама решает, что ACKать.
   Всё, что не перехвачено, ACKается автоматически — иначе сессия девайса залипает. */
const rcspHooks=new Set();
const rcspHook=fn=>{rcspHooks.add(fn);return()=>rcspHooks.delete(fn)};
const NO_AUTO_ACK=new Set([0x01,0x0D,0x1C,0x1D,0x20,0xE5,0xE8]);
function rcspRoute(k,u){
  if(k!=='ae02'||u[0]!==0xFE)return false;
  const i=feInner(u);if(!i.isCmd)return false;
  for(const h of rcspHooks){try{if(h(i,u)===true)return true}catch(e){log('EV',k,null,'hook: '+e.message)}}
  if(NO_AUTO_ACK.has(i.cmd))return false; // ждём владельца сессии; без него не ACKаем вслепую
  rcspAck(i.cmd,i.sn,0,[],i.cmd===0x01?i.xmOp:null,'auto-ACK '+hx(i.cmd)).catch(()=>{});
  return true}

/* Запрос с полной классификацией: слушаем AE02 + FD01/FD03/FD05 и возвращаем ВСЁ,
   что пришло, чтобы generic-ack никогда не выдавался за успех. */
async function probeFrame(transport,bytes,ms,{expect=null,note=''}={}){
  validateReadOnlyProbe(transport,bytes);
  if(!S.P||!S.P.auth.ok)throw new Error('нужен auth');
  if(S.conn!=='on'||!S.gattReady)throw new Error('устройство не подключено');
  if(!Number.isFinite(ms)||ms<500||ms>10000)throw new Error('окно ответа должно быть от 500 до 10000 мс');
  const got=[],t0=performance.now();
  const stop=collectFrames(r=>got.push(r),ms);
  try{await (transport==='fd02'?w('fd02',bytes,note):rcspWrite(bytes,note))}catch(e){stop();return{kind:'timeout',error:e.message,frames:got,ms:performance.now()-t0}}
  await stop.done;
  const real=got.filter(r=>isRealResponse(r)&&(expect==null||r.cmd===expect));
  const best=real.find(r=>r.kind==='fe-response')||real[0]||got.find(r=>r.kind==='generic-ack')||got.find(r=>r.kind==='fe-push')||null;
  return{...(best||{kind:'timeout'}),frames:got,ms:Math.round(performance.now()-t0),
    ackOnly:!real.length&&got.some(r=>r.kind==='generic-ack')}}
// Сбор всех кадров за окно ms (без исключений по таймауту)
function collectFrames(onFrame,ms){
  let done,res;const pr=new Promise(r=>res=r);
  const wt={pred:(k,u)=>{onFrame(classifyFrame(k,u));return false},res:()=>{},rej:()=>{}};
  S.waiters.push(wt);
  const id=setTimeout(()=>{S.waiters=S.waiters.filter(x=>x!==wt);res();done=true},ms);
  return{done:pr,stop:()=>{if(done)return;clearTimeout(id);S.waiters=S.waiters.filter(x=>x!==wt);res();done=true}}}

// Оценка ATT MTU по максимальным уведомлениям (Web Bluetooth MTU не отдаёт)
const mtuGuess=()=>Math.max(23,(S.maxNotify.ae02||0)+3);
