/* ===== core/bitfields — декод битовых полей по вендорским определениям =====
 * Источник: data/bitfields.md (JL_rcsp_protocol.h + rcsp_bluetooth.c, fw-AC63_BT_SDK).
 * Правило: сырые байты сохраняются всегда; эвристики помечаются speculative:true.
 * Два РАЗНЫХ пространства атрибутов: 0x03 → ATTR_TYPE_*, 0x07 → COMMON_INFO_ATTR_*.
 */
const be16=(u,i=0)=>(u[i]<<8)|u[i+1], be32=(u,i=0)=>((u[i]<<24)|(u[i+1]<<16)|(u[i+2]<<8)|u[i+3])>>>0;
const le16=(u,i=0)=>u[i]|(u[i+1]<<8);
const u8a=(...a)=>Uint8Array.from(a.flat?a.flat():a);
const bytesOf=v=>v instanceof Uint8Array?v:Uint8Array.from(v);
const printable=u=>u.length>0&&u.every(b=>b>=32&&b<127);
const asciiOf=u=>String.fromCharCode(...u);
const maskOf=bits=>bits.reduce((m,b)=>m|(1<<b),0)>>>0;
const bitsOf=n=>{const o=[];for(let i=0;i<32;i++)if((n>>>i)&1)o.push(i);return o};

// FUNCTION_INFO (attr 4): в вендорском коде это НОМЕРА битов, не маски. Дефолт 0x4E.
const FUNC_BITS={1:'MUSIC',2:'RTC',3:'LINEIN',6:'FMTX'};
function decodeFunctionInfo(u){
  if(!u||u.length<4)return{raw:hex(u,''),bits:[],names:[],note:'ожидается 4 Б BE'};
  const v=be32(u),bits=bitsOf(v);
  return{raw:hex(u,''),value:v,hexValue:'0x'+v.toString(16).toUpperCase(),bits,
    names:bits.map(b=>FUNC_BITS[b]||('bit'+b)),
    note:'аудио-функции BT-плеера; бита filebrowse здесь НЕТ (data/bitfields.md §3)'}}

// DOUBLE_PARITION (attr 8) — что реально решает судьбу OTA (bitfields.md §4)
function decodeDoublePartition(u){
  if(!u||u.length<2)return{raw:hex(u,''),known:false};
  const dual=u[0]===1,loader=u[1]===1;
  return{raw:hex(u,''),known:true,dualBank:dual,loaderDownload:loader,
    mode:dual?'dual-bank (фоновый OTA)':loader?'single-bank + loader (двухэтапный OTA)':'single-bank',
    passes:dual?1:2}}

// Feature map 0x02 / file_transfer: биты установлены, семантика в открытом SDK отсутствует.
function decodeFeatureMap(mask){const bits=bitsOf(mask>>>0);
  return{mask:mask>>>0,hex:'0x'+(mask>>>0).toString(16).toUpperCase().padStart(8,'0'),bits,
    speculative:true,note:'семантика битов не подтверждена вендорским кодом — проверять эмпирически (Raw Probe)'}}

// ⚠ SPECULATIVE: attr 18 в вендорском SDK не определён (bitfields.md §7)
const PERIPH_BITS={0:'HR',1:'SpO2',2:'accelerometer',3:'pedometer',4:'temperature',5:'GPS',6:'barometer',7:'gyroscope'};
function decodePeripherals(u){const v=u&&u.length?u[0]:0;
  return{raw:hex(u,''),value:v,bits:bitsOf(v),names:bitsOf(v).map(b=>PERIPH_BITS[b]||('bit'+b)),speculative:true,
    note:v===0?'датчиков нет физически — health-значения это заглушки watch-SDK':'таблица битов спекулятивна'}}

const macStr=u=>hex(u.subarray(0,6),':').toLowerCase();
// Ответ 0x03: TLV в пространстве ATTR_TYPE_*
function decodeTargetInfo2(attrs){
  const out={attrs:[],fields:{}};
  for(const{type,data}of attrs){
    const name=ATTR_TI[type]||('ATTR_'+type),a={type,typeHex:hx(type),name,dataHex:hex(data,''),len:data.length};
    switch(type){
      case 0:a.decoded=data[0];out.fields.protocolVersion=data[0];break;
      case 2:a.decoded=macStr(data)+(data.length>6?' +'+hex(data.subarray(6),''):'');out.fields.edrAddr=macStr(data);break;
      case 3:a.decoded=data[0];out.fields.platform=data[0];break;
      case 4:{const f=decodeFunctionInfo(data);a.decoded=f.hexValue+' ['+f.names.join(', ')+']';a.detail=f;out.fields.functionInfo=f;break}
      case 5:a.decoded=printable(data)?asciiOf(data):hex(data,'');out.fields.devVersion=a.decoded;break;
      case 6:a.decoded=data[0]+(data[0]===0?' (AI SDK)':data[0]===1?' (BT_MATE)':'');out.fields.sdkType=data[0];break;
      case 7:a.decoded=printable(data)?asciiOf(data):hex(data,'');out.fields.ubootVersion=a.decoded;break;
      case 8:{const d=decodeDoublePartition(data);a.decoded=`${d.mode}`;a.detail=d;out.fields.doublePartition=d;break}
      case 9:a.decoded=data[0];a.detail={mandatoryUpgrade:data[0]===1,loader:data[0]===1};out.fields.mandatoryUpgrade=data[0]===1;break;
      case 10:if(data.length>=4){a.decoded=`vid=${hx(be16(data))} pid=${hx(be16(data,2))}`;out.fields.vid=be16(data);out.fields.pid=be16(data,2)}else a.decoded=hex(data,'');break;
      case 11:a.decoded=`${data.length} B (скрыт)`;a.redacted=true;break; // ключ устройства не пишем в паспорт
      case 12:a.decoded=printable(data)?asciiOf(data):hex(data,'');out.fields.projectCode=a.decoded;break;
      case 13:a.decoded=data.length>=4?Array.from(data.subarray(0,4)).join('.'):hex(data,'');out.fields.maxMtu=data.length>=2?be16(data):null;break;
      case 17:a.decoded=data.length===7?`type ${data[0]} ${macStr(data.subarray(1))}`:hex(data,'');out.fields.bleAddr=data.length===7?macStr(data.subarray(1)):null;break;
      case 18:{const p=decodePeripherals(data);a.decoded=p.value+' ['+p.names.join(', ')+']';a.detail=p;out.fields.peripherals=p;break}
      case 19:a.decoded=hex(data,'');a.detail={speculative:true,note:'dev_support_func отсутствует в fw-AC63_BT_SDK (часовой SDK)'};break;
      case 21:{const m=data.length>=4?be32(data):data[0];const f=decodeFeatureMap(m);a.decoded=f.hex+' bits['+f.bits.join(',')+']';a.detail=f;out.fields.fileTransfer=f;break}
      default:a.decoded=data.length===1?String(data[0]):printable(data)?asciiOf(data):hex(data,'');a.heuristic=true}
    out.attrs.push(a)}
  return out}

// Ответ 0x07: TLV в пространстве COMMON_INFO_ATTR_* (function:1 перед TLV)
function decodeSysInfo2(attrs){
  const out={attrs:[],fields:{}};
  for(const{type,data}of attrs){
    const name=ATTR_CI[type]||('COMMON_ATTR_'+type),a={type,typeHex:hx(type),name,dataHex:hex(data,''),len:data.length};
    switch(type){
      case 0:a.decoded=data[0]+'%';out.fields.battery=data[0];break;
      case 1:a.decoded=data[0];out.fields.volume=data[0];break;
      case 2:{a.decoded=hex(data,'');const st=[]; // DevStorageState: idx:1 handle:4 BE online:1 — эвристика (ebadge-python-cli)
        if(data.length>=6&&data.length%6===0)for(let i=0;i<data.length;i+=6)st.push({index:data[i],handle:hex(data.subarray(i+1,i+5),''),handleValue:be32(data,i+1),online:data[i+5]!==0});
        a.detail={speculative:true,storage:st,note:'COMMON_INFO_ATTR_DEV: раскладка записей не подтверждена вендорским кодом'};out.fields.storage=st;break}
      case 5:a.decoded=printable(data)?'"'+asciiOf(data)+'"':hex(data,'');out.fields.fileBrowseType=a.decoded;
        a.detail={note:'COMMON_INFO_ATTR_FILE_BROWSE_TYPE — какие типы файлов девайс готов браузить'};break;
      case 6:a.decoded=data[0];out.fields.funType=data[0];break;
      case 7:a.decoded=data[0];out.fields.brightness=data[0];break;
      default:a.decoded=data.length===1?String(data[0]):printable(data)?asciiOf(data):hex(data,'');a.heuristic=true}
    out.attrs.push(a)}
  return out}

// Запись файлового браузера: header:1 | cluster:4 BE | file_num:2 BE | name_len:1 | name:N
function decodeBrowseEntries(data,queryType=0){
  const out=[];let i=0;
  while(i+8<=data.length){
    const h=data[i],isFile=(h&1)!==0,unicode=(h&2)===0,devIndex=(h>>2)&0x1F;
    const cluster=be32(data,i+1),fileNum=be16(data,i+5),n=data[i+7];i+=8;
    if(i+n>data.length)break;
    const nb=data.subarray(i,i+n);i+=n;
    const utf16le=n>=2&&n%2===0?Array.from({length:n/2},(_,k)=>String.fromCharCode(nb[k*2]|(nb[k*2+1]<<8))).join('').replace(/\0+$/,''):null;
    const byteString=asciiOf(nb).replace(/\0+$/,'');
    const name=unicode&&utf16le!=null?utf16le:byteString;
    const alternate=unicode?byteString:utf16le,nameAlternate=alternate!==name?alternate:null;
    out.push({name,nameEncoding:unicode&&utf16le!=null?'UTF-16LE':'byte-string',nameHex:hex(nb,''),nameAlternate,
      nameAlternateEncoding:nameAlternate?(unicode?'byte-string':'UTF-16LE'):null,
      isFile,type:queryType,typeName:isFile?'file':'folder',id:fileNum,cluster,devIndex,dev:DEV_HANDLERS[devIndex]||('dev'+devIndex),size:0})}
  return{entries:out,consumed:i,trailing:data.length-i}}

// SIMPLE_FILE_TRANS 0x28 op=0: [version?] + N*(id:2 BE, size:2 BE); встречаются 3 варианта начала
function parseSmallFileList(type,typeName,body){
  for(const start of[1,2,0]){const rest=body.length-start;if(rest<=0||rest%4)continue;
    const out=[];for(let i=start;i+3<body.length;i+=4){const id=be16(body,i),size=be16(body,i+2);if(!id&&!size)continue;out.push({type,typeName,id,size})}
    if(out.length||rest===0)return out}
  return[]}
// SIMPLE_FILE_TRANS 0x28 op=1: две формы ответа — A [ret][crcH][crcL][data], B [op][ret][crcH][crcL][data]
function parseSmallFileRead(body){
  if(body.length<3)return{ok:false,error:'короткий ответ ('+body.length+' Б)',data:new Uint8Array(0)};
  let ret,crc,start,variant;
  if(body[0]===0){ret=body[0];crc=be16(body,1);start=3;variant='A'}
  else if(body.length>=4&&body[1]===0){ret=body[1];crc=be16(body,2);start=4;variant='B'}
  else{ret=body[0];crc=0;start=3;variant='A(err)'}
  const data=body.subarray(Math.min(start,body.length));
  return{ok:ret===0,ret,crc16:crc,variant,data,statusName:statusName(ret)}}

// Flash ID из UBOOT: последний байт density = log2(размер)
function decodeFlashId(u){
  if(!u||u.length<3)return null;
  const density=u[u.length-1],size=density>=8&&density<=32?2**density:null;
  return{id:hex(u,''),manufacturer:hx(u[0]),density,densityHex:hx(density),size,
    sizeText:size?(size>=1<<20?(size/(1<<20))+' MiB':(size>>10)+' KiB'):'неизвестно',
    note:'size = 2^density (последний байт ID); сверить с дампом'}}

// Рекламный маркер JLOTA после OTA: D6 05 "JLOTA" + MAC反转 в байтах +8..+14
const JLOTA_MARKER=[0xD6,0x05,0x41,0x54,0x4F,0x4C,0x4A];
function parseJlOtaAdv(u){
  if(!u||u.length<14)return null;
  let at=-1;for(let i=0;i+7<=u.length;i++)if(JLOTA_MARKER.every((b,k)=>u[i+k]===b)){at=i;break}
  if(at<0)return null;
  const m=u.subarray(at+8,at+14);
  return{marker:'JLOTA',offset:at,mac:hex(Array.from(m).reverse(),':').toLowerCase(),raw:hex(u,'')}}

// Батарея 9E 0x27: [mode, percent]; mode≠0 ≈ зарядка (не подтверждено → в R-BATT не используется)
const decodeBatteryPush=p=>p&&p.length>=2?{mode:p[0],level:p[1],charging:p[0]===1?null:null}:null;
