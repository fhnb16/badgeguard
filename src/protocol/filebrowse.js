/* ===== protocol/filebrowse — RCSP-браузер файлов + выгрузка ресурсов (Фаза 2) =====
 * Кадры byte-exact из qix-ble rcsp_session.browse() / ebadge-python-cli file_browse.py:
 *   0x0C: sn type readNum startIndex:2BE devHandler:4BE pathLen:2(LE|BE) path:N*4BE
 *   ответы: 0x0C status, затем пуши 0x01 (xmOp=0x0C) с записями, финал 0x0D → ОБЯЗАТЕЛЬНО ACK.
 * Малые файлы: 0x28 op=0 (список по типу), op=1 (чтение id/offset/len).
 */
const BROWSE={running:false,tree:[],files:[],manifest:null,lastError:null};
const browseParam=(o)=>{
  const path=bytesOf((o.clusters||[]).flatMap(c=>[(c>>>24)&255,(c>>>16)&255,(c>>>8)&255,c&255]));
  const pl=path.length,le=o.pathLenLE!==false; // capture: LE; SDK-комментарий: BE — переключаемо, авто-ретрай
  return Uint8Array.of(o.type&255,o.readNum&255,(o.startIndex>>8)&255,o.startIndex&255,
    (o.devHandler>>>24)&255,(o.devHandler>>>16)&255,(o.devHandler>>>8)&255,o.devHandler&255,
    le?pl&255:(pl>>8)&255,le?(pl>>8)&255:pl&255,...path)};

async function browseOnce(o){
  const opt={type:0,readNum:32,startIndex:0,devHandler:3,clusters:[],pathLenLE:true,...o};
  const chunks=[];let stopped=false,pushes=0;
  const un=rcspHook(i=>{
    if(i.cmd===0x01&&i.xmOp===0x0C){chunks.push(i.payload);pushes++;rcspAck(0x01,i.sn,0,[],0x0C).catch(()=>{});return true}
    if(i.cmd===0x0D){rcspAck(0x0D,i.sn,0).catch(()=>{});stopped=true;return true}
    return false});
  try{
    const r=await rcspCmd(0x0C,browseParam(opt),S.set.reqTo,{note:`browse ${DEV_HANDLERS[opt.devHandler]||opt.devHandler} type=${opt.type} clusters=[${opt.clusters}]`});
    if(r.kind==='timeout')return{...opt,ok:false,reason:'timeout',entries:[],pushes:0};
    if(r.status!==0)return{...opt,ok:false,reason:'status '+hx(r.status)+' '+statusName(r.status),entries:[],pushes:0,status:r.status};
    const end=Date.now()+S.set.browseTo;
    while(!stopped&&Date.now()<end&&!S.abort)await sleep(60);
    const buf=chunks.reduce((out,chunk)=>cat(out,chunk),new Uint8Array(0));
    const dec=decodeBrowseEntries(buf,opt.type);
    return{...opt,ok:true,status:0,entries:dec.entries,pushes,dataHex:hex(buf,''),bytes:buf.length,trailing:dec.trailing,stopped}}
  finally{un()}}

// Обход всех устройств (USB/SD0/SD1/Flash) + рекурсия по папкам
async function browseAll({deep=true,maxDepth=3,readNum=32}={}){
  if(BROWSE.running)throw new Error('browse уже идёт');
  BROWSE.running=true;S.abort=false;BROWSE.tree=[];BROWSE.files=[];BROWSE.lastError=null;
  const t0=Date.now();
  try{
    for(const dev of DEV_LIST){
      if(S.abort)break;
      let root=await browseOnce({type:0,devHandler:dev,readNum});
      // pathLen endianness не решена на железе (bitfields/open_question): пробуем обе
      if(!root.ok&&root.reason==='timeout'){const alt=await browseOnce({type:0,devHandler:dev,readNum,pathLenLE:false});if(alt.ok)root=alt}
      const node={dev,devName:DEV_HANDLERS[dev],ok:root.ok,reason:root.reason||null,children:[],files:[]};
      BROWSE.tree.push(node);renderLab();
      if(!root.ok){log('EV','',null,`browse ${DEV_HANDLERS[dev]}: ${root.reason}`);continue}
      log('EV','',null,`browse ${DEV_HANDLERS[dev]}: ${root.entries.length} записей (${root.bytes} Б, push=${root.pushes})`);
      await walk(node,root.entries,[],1);
    }
    BROWSE.manifest=await buildResourcesManifest();
    log('EV','',null,`browse готов: ${BROWSE.files.length} файлов, ${Date.now()-t0} мс`);
    return BROWSE}
  finally{BROWSE.running=false;renderLab()}
  async function walk(node,entries,path,depth){
    for(const e of entries){
      if(S.abort)return;
      const full=[...path,e.name].join('/');
      if(e.isFile){const f={...e,path:full,dev,node};node.files.push(f);BROWSE.files.push(f);continue}
      node.children.push({...e,path:full,children:[],files:[]});
      if(!deep||depth>=maxDepth)continue;
      const sub=node.children[node.children.length-1];
      const r=await browseOnce({type:1,devHandler:e.devIndex!=null?dev:dev,readNum,clusters:[e.cluster]});
      if(r.ok&&r.entries.length){log('EV','',null,`  ${full}: ${r.entries.length} записей`);await walk(sub,r.entries,[...path,e.name],depth+1)}
      else if(!r.ok)log('EV','',null,`  ${full}: ${r.reason}`);
      renderLab()}}}

/* Малые файлы 0x28 — реально работающий путь чтения ресурсов на watch-SDK */
async function listSmallFiles(){
  const out=[];
  for(const t of SMALL_FILE_TYPES){
    if(S.abort)break;
    const r=await rcspCmd(0x28,[0x00,t.type],S.set.reqTo,{note:`small list ${t.name}`});
    if(r.kind==='timeout'){log('EV','',null,`0x28 list ${t.name}: timeout`);continue}
    if(r.status!==0){log('EV','',null,`0x28 list ${t.name}: ${statusName(r.status)}`);continue}
    const items=parseSmallFileList(t.type,t.name,r.payload||new Uint8Array(0));
    log('EV','',null,`0x28 list ${t.name}: ${items.length} шт`);out.push(...items)}
  return out}
async function readSmallFile(e,{offset=0,len=null}={}){
  const maxLen=Math.min(0xFFFF,len||Math.max(e.size||0,256));
  const body=Uint8Array.of(0x01,e.type&255,(e.id>>8)&255,e.id&255,(offset>>8)&255,offset&255,(maxLen>>8)&255,maxLen&255,0x01);
  const r=await rcspCmd(0x28,body,Math.max(S.set.reqTo,9000),{note:`small read ${e.typeName||e.type} id=${hx(e.id)} len=${maxLen}`});
  if(r.kind==='timeout')return{ok:false,error:'timeout',data:new Uint8Array(0)};
  if(r.status!==0)return{ok:false,error:'RCSP '+statusName(r.status),data:new Uint8Array(0)};
  return parseSmallFileRead(r.payload||new Uint8Array(0))}

/* Выгрузка: для каждого файла — small read по id; пишем sha256 и собираем манифест. */
async function fetchResources({limit=0}={}){
  if(!BROWSE.files.length&&!S.smallFiles.length)throw new Error('сначала выполните обход (browse / small files)');
  const targets=[...BROWSE.files.map(f=>({id:f.id,type:1,typeName:'file',name:f.path,size:f.size,src:'browse'})),
    ...S.smallFiles.map(f=>({id:f.id,type:f.type,typeName:f.typeName,name:`${f.typeName}/${f.id}.bin`,size:f.size,src:'0x28'}))];
  const list=limit?targets.slice(0,limit):targets;
  S.res=[];S.abort=false;S.prog={done:0,total:list.length,t0:performance.now(),start:0,win:0};
  for(const t of list){
    if(S.abort)break;
    try{const r=await readSmallFile(t);
      if(r.ok&&r.data.length){const sha=await sha256hex(r.data);
        S.res.push({...t,bytes:r.data.length,sha256:sha,crc16:r.crc16,crcOk:r.crc16!=null?crc16(r.data)===r.crc16:null,data:r.data,variant:r.variant});
        log('EV','',null,`fs get ${t.name}: ${r.data.length} Б sha256=${sha.slice(0,12)}… crc=${hx(r.crc16)}`)}
      else log('EV','',null,`fs get ${t.name}: ${r.error||'пусто'}`)}
    catch(e){log('EV','',null,`fs get ${t.name}: ${e.message}`)}
    S.prog.done++;renderLab()}
  S.resManifest=await buildResourcesManifest();
  toast(`ресурсов: ${S.res.length}/${list.length}`,S.res.length?'ok':'warn');renderLab();return S.res}

async function buildResourcesManifest(){
  const items=[];
  for(const r of S.res||[])items.push({name:r.name,path:r.name,source:r.src,type:r.type,id:r.id,bytes:r.bytes,sha256:r.sha256,crc16:r.crc16==null?null:hx(r.crc16),crcVerified:r.crcOk});
  return{artifact:'resources-manifest.json',generatedAt:new Date().toISOString(),
    device:S.P?{deviceId:S.P.deviceId,name:S.P.name,fwVersion:S.P.fwVersion,profileId:S.P.profileId,chipFamily:S.P.chipFamily}:null,
    transport:'RCSP AE00 (0x0C browse + 0x28 small-file read)',
    note:'ресурсы прошивки (циферблаты/картинки/шрифты/конфиги). Код прошивки, uboot и chipkey этим путём НЕ доступны.',
    browseTree:BROWSE.tree.map(n=>({dev:n.devName,ok:n.ok,reason:n.reason,files:n.files.map(f=>({path:f.path,id:f.id,cluster:f.cluster})),
      children:n.children.map(c=>({path:c.path,cluster:c.cluster,files:c.files.map(f=>({path:f.path,id:f.id}))}))})),
    count:items.length,items}}

/* ZIP без зависимостей (store, без сжатия) — чтобы выгрузить ресурсы одним файлом */
const CRC32T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC32T[(c^u[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
function zipStore(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  const d16=n=>[n&255,(n>>8)&255],d32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255];
  for(const f of files){
    const nm=enc.encode(f.name),data=bytesOf(f.data),c=crc32(data);
    const local=Uint8Array.of(...d32(0x04034b50),...d16(20),...d16(0x0800),...d16(0),...d16(0),...d16(0),...d32(c),...d32(data.length),...d32(data.length),...d16(nm.length),...d16(0),...nm);
    parts.push(local,data);
    central.push(Uint8Array.of(...d32(0x02014b50),...d16(20),...d16(20),...d16(0x0800),...d16(0),...d16(0),...d16(0),...d32(c),...d32(data.length),...d32(data.length),
      ...d16(nm.length),...d16(0),...d16(0),...d16(0),...d16(0),...d32(0),...d32(offset),...nm));
    offset+=local.length+data.length}
  const cd=catN(...central),end=Uint8Array.of(...d32(0x06054b50),...d16(0),...d16(0),...d16(files.length),...d16(files.length),...d32(cd.length),...d32(offset),...d16(0));
  return catN(...parts,cd,end)}
function exportResourcesZip(){
  if(!S.res||!S.res.length)return toast('нет выгруженных ресурсов','warn');
  const files=S.res.map(r=>({name:r.name.replace(/^\/+/,''),data:r.data}));
  files.push({name:'resources-manifest.json',data:new TextEncoder().encode(JSON.stringify(S.resManifest,null,2))});
  download('resources.zip',zipStore(files));toast('resources.zip ✓','ok')}
