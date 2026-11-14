const crc16=(b,c=0)=>{for(let i=0;i<b.length;i++){c^=b[i]<<8;for(let j=0;j<8;j++)c=(c&0x8000?(c<<1)^0x1021:c<<1)&0xFFFF}return c};
const hex=(u,sep=' ')=>Array.from(u||[],x=>x.toString(16).padStart(2,'0')).join(sep).toUpperCase();
const fromHex=s=>Uint8Array.from(s.replace(/[^0-9a-f]/gi,'').match(/../g)||[],h=>parseInt(h,16));
const hx=n=>n==null?'—':'0x'+n.toString(16).toUpperCase();
const eq=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>x===b[i]);

const PROFILES={
  'e87-ac707n':{match:{sdkRegex:'jl_sdk_ac707',gattServices:['ae00','c2e6fd00'],names:['E87','EC-BADGE'],chars:['fd01','fd02','fd03']},family:'AC707N/BR35',ota:true,chipkey:0x9847,
    flash:{size:0x400000,codeSpan:[0,0x17E000],appSlot:0xFC000},ubootSha256Allowlist:[],knownGoodImages:[],expectedForm:null,verifySpan:[0,0xFC000]},
  'e87-ac697x':{match:{sdkRegex:'jl_sdk_ac697',gattServices:['ae00'],names:['E87','E92','L8','X9','LED Badge']},family:'AC697x/BR30',ota:false},
  'e87-ac701n':{match:{sdkRegex:'jl_sdk_ac701',gattServices:['ae00'],names:['E87','E92','L8','X9','LED Badge']},family:'AC701N/BR28',ota:false}};
const familyOf=s=>/ac707/.test(s||'')?'AC707N/BR35':/ac697/.test(s||'')?'AC697x/BR30':/ac701/.test(s||'')?'AC701N/BR28':'unknown';
function matchProfile(P,profiles){
  for(const[id,p]of Object.entries(profiles)){const m=p.match;
    if(P.sdkString&&new RegExp(m.sdkRegex).test(P.sdkString)&&m.gattServices.every(s=>P.gatt.services.some(u=>u.startsWith(s)||u.startsWith('0000'+s)))&&m.names.some(n=>(P.name||'').startsWith(n))
      &&(m.chars||[]).every(c=>(P.charIds||[]).includes(c))&&!(m.charsAbsent||[]).some(c=>(P.charIds||[]).includes(c)))return id}
  return null}
// 9E-кадр: [0]=9E [1],[2]=? (меняются; seq/чексумма не подтверждены) [3]=cmd [4..5]=len LE [6..]=payload — сходится на всех TX/RX лога
function parse9E(u){if(u[0]!==0x9E||u.length<6)return null;const len=u[4]|u[5]<<8;let s=0;for(let i=2;i<Math.min(u.length,6+len);i++)s+=u[i];
  return{chk:u[1],flags:u[2],cmd:u[3],len,payload:u.slice(6,6+len),complete:u.length>=6+len,ok:(s&255)===u[1]}}
// Qix 9E: [9E][chk = sum(bytes[2:]) & FF][flags][cmd][len LE16][payload] — qix-ble frame.py, сверено с кадрами лога
function qixEncode(flags,cmd,payload=[]){const p=Uint8Array.from(payload),b=new Uint8Array(6+p.length);b[0]=0x9E;b[2]=flags;b[3]=cmd;b[4]=p.length&255;b[5]=p.length>>8;b.set(p,6);
  let s=0;for(let i=2;i<b.length;i++)s+=b[i];b[1]=s&255;return b}
// поток → кадр: пропуск мусора до 9E, ожидание неполного, повтор со сдвигом при битой сумме
function qixTake(buf){let b=buf,skipped=0;
  for(;;){const i=b.indexOf(0x9E);if(i<0)return{frame:null,rest:new Uint8Array(0),skipped:skipped+b.length};
    if(i){skipped+=i;b=b.subarray(i)}if(b.length<6)return{frame:null,rest:b.slice(),skipped};
    const tot=6+(b[4]|b[5]<<8);if(tot>8192){b=b.subarray(1);skipped++;continue}if(b.length<tot)return{frame:null,rest:b.slice(),skipped};
    let s=0;for(let k=2;k<tot;k++)s+=b[k];if((s&255)===b[1])return{frame:b.slice(0,tot),rest:b.slice(tot),skipped};b=b.subarray(1);skipped++}}
// RCSP FE: [FE DC BA][flag][cmd][len BE16][body][EF] — qix-ble rcsp_frame.py
function feTake(b){if(b.length<7)return{frame:null,rest:b};if(!(b[0]===0xFE&&b[1]===0xDC&&b[2]===0xBA))return{frame:b,rest:new Uint8Array(0)};
  const tot=8+(b[5]<<8|b[6]);if(tot>8192)return{frame:b,rest:new Uint8Array(0)};if(b.length<tot)return{frame:null,rest:b};
  return b[tot-1]===0xEF?{frame:b.slice(0,tot),rest:b.slice(tot)}:{frame:b,rest:new Uint8Array(0)}}
const parseRcspResp=u=>{const len=u[5]<<8|u[6],body=u.subarray(7,7+len);return body.length<2?null:{flag:u[3],cmd:u[4],status:body[0],sn:body[1],data:body.subarray(2)}};
const parseTlv=p=>{const out=[];for(let i=0;i<p.length;){const n=p[i];if(n<1||i+1+n>p.length)break;out.push({type:p[i+1],data:p.slice(i+2,i+1+n)});i+=1+n}return out};
const TI_NAMES={0:'protocol_version',1:'power_up_sys_info',2:'edr_addr',3:'platform',4:'function_info',5:'firmware_info',6:'sdk_type',7:'uboot_version',8:'support_double_backup',
  9:'mandatory_upgrade_flag',10:'vid_pid',11:'auth_key',12:'project_code',13:'fw_version',14:'allow_connect',16:'name',17:'ble_addr',18:'peripherals_support',19:'dev_support_func',21:'file_transfer',31:'custom_ver'};
const mac6=d=>hex(d.subarray(0,6),':').toLowerCase(); // порядок байт как в кадре; сверить с адресом в ОС
// HIL E87: attr 2 = 8 Б (адрес + 2 Б), attr 17 = 7 Б (тип + адрес; qix-ble зовёт его connect_ble_only)
function decodeTargetInfo(attrs){const o={};for(const{type,data}of attrs){const n=TI_NAMES[type]||'attr_'+type,txt=data.length>=3&&data.every(b=>b>=32&&b<127)?String.fromCharCode(...data):null;
  o[n]=type===2&&data.length>=6?mac6(data)+(data.length>6?' +'+hex(data.subarray(6),''):''):type===17&&data.length===7?`type ${data[0]} ${mac6(data.subarray(1))}`:
    type===10&&data.length>=4?`vid=${hx(data[0]<<8|data[1])} pid=${hx(data[2]<<8|data[3])}`:type===11?`${data.length} B (скрыт)`: // ключ устройства в паспорт не пишем
    type===13&&data.length>=4?Array.from(data.subarray(0,4)).join('.'):data.length===1?String(data[0]):txt||hex(data,'')}return o} // fw_version: трактовка 4 Б неоднозначна (qix-ble)
const GENERIC4M={family:'unknown',flash:{size:0x400000,codeSpan:[0,0x17E000],appSlot:0xFC000}};
// C7 (ответ на C6), 13 B, u16 BE. 360×360 совпадает с панелью из ТЗ; назначение w2/h2 (368) и f5..f7 не подтверждено
function decodeC7(p){if(!p||p.length<13)return null;const b=o=>p[o]<<8|p[o+1];return{width:b(0),height:b(2),w2:b(4),h2:b(6),f5:b(8),f6:p[10],f7:b(11)}}
const profileForSdk=(sdk,profiles)=>sdk?Object.keys(profiles).find(id=>new RegExp(profiles[id].match.sdkRegex).test(sdk))||null:null;
// >0 upgrade, 0 same, <0 downgrade, null = unknown / different line
function vcmp(a,b){if(!a||!b)return null;const x=a.split('.').map(Number),y=b.split('.').map(Number);if(x[0]!==y[0]||x[1]!==y[1])return null;
  for(let i=2;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d)}return 0}

const RULE_TXT={
  'R-CHIP':['Семейство чипа устройства = цель образа','Device chip family = image target'],
  'R-KEY':['chipkey образа = chipkey профиля','Image chipkey = profile chipkey'],
  'R-UBOOT':['uboot образа — OEM из allowlist (байт-в-байт)','Image uboot is allowlisted OEM (byte-exact)'],
  'R-WRAP':['Обёртка соответствует пути (Qix → bcaf, RCSP → vanilla)','Wrapper matches path (Qix → bcaf, RCSP → vanilla)'],
  'R-CRC':['Все CRC контейнера и Qix валидны','All container and Qix CRCs valid'],
  'R-SIZE':['app.bin ≤ appSlot, образ ≤ лимита','app.bin ≤ appSlot, image within limit'],
  'R-GEOM':['Геометрия флеша образа = профиль','Image flash geometry = profile'],
  'R-PATH':['OTA-путь доступен на устройстве и в приложении','OTA path available on device and in app'],
  'R-BATT':['Батарея ≥ 30% или зарядка','Battery ≥ 30% or charging'],
  'R-TEST':['TEST_MODE не активен, dump в сессии не было','TEST_MODE inactive, no dump this session'],
  'R-CONN':['Одно соединение, GATT жив, BT телефона выключен','Single link, GATT alive, phone BT off'],
  'R-DUMP':['Дамп — только свой (паспорт сертификата = устройство) и только через RCSP. Чужой дамп клонирует MAC и имя.','Own dump only (certificate passport = device), RCSP path only. A foreign dump clones MAC and name.'],
  'R-VER':['Без даунгрейда в одной линейке версий','No downgrade within a version line'],
  'R-HASH':['SHA-256 в known-good allowlist','SHA-256 in known-good allowlist'],
  'R-PROBE':['Не было probe без power-cycle','No probe without power-cycle'],
  'R-FORM':['Digest сравнивается в одной форме (срез flash.bin / калибровка профиля)','Digests compared in one form (flash.bin slice / profile calibration)'],
  'R-DUMP-INTEG':['Restore только из дампа с verified-сертификатом, подписью и совпадающим SHA-256','Restore only from a dump with a verified, signed certificate and matching SHA-256']};

function evaluate(P,R,c){
  const rules=[],L=c.lang==='en'?1:0,add=(id,severity,evidence)=>rules.push({id,severity,message:RULE_TXT[id][L],evidence});
  const pr=c.profiles[P.profileId],geo=pr&&pr.flash,qix=c.path==='qix',g=R.geometry,b=P.battery;
  add('R-CHIP',pr&&P.chipFamily!=='unknown'&&pr.family===P.chipFamily&&R.targetProfileId===P.profileId?'pass':'block',`dev=${P.profileId||'?'} ${P.chipFamily} / img=${R.targetProfileId||'?'}`);
  add('R-KEY',pr&&pr.chipkey!=null&&R.chipkey===pr.chipkey?'pass':'block',`img=${hx(R.chipkey)} exp=${hx(pr&&pr.chipkey)}`);
  const ub=[...((pr&&pr.ubootSha256Allowlist)||[]),...c.ubootAllow];
  add('R-UBOOT',R.ubootHash&&ub.includes(R.ubootHash)?'pass':'block',`uboot=${R.ubootHash?R.ubootHash.slice(0,16)+'…':'—'} allowlist=${ub.length}`);
  add('R-WRAP',(qix?R.qixWrapped===true:R.qixWrapped===false)?'pass':'block',`path=${c.path} bcaf=${R.qixWrapped}`);
  add('R-CRC',['hdr','list','data'].every(k=>R.crc[k]===true)&&(!R.qixWrapped||R.crc.qix===true)&&R.internalJlCrcOk===true?'pass':'block',JSON.stringify(R.crc)+' jl='+R.internalJlCrcOk);
  add('R-SIZE',geo&&R.appBinSize!=null&&R.appBinSize<=geo.appSlot&&R.size<=c.maxImage?'pass':'block',`app=${hx(R.appBinSize)} slot=${hx(geo&&geo.appSlot)} file=${R.size}`);
  add('R-GEOM',geo&&g&&g.flashSize===geo.size&&g.appSlot===geo.appSlot&&g.codeSpan[0]===geo.codeSpan[0]&&g.codeSpan[1]===geo.codeSpan[1]?'pass':'block',g?`flash=${hx(g.flashSize)} code=[${g.codeSpan.map(hx)}] slot=${hx(g.appSlot)}`:'—');
  const fm=pr&&pr.expectedForm,sl=R.slices||{};
  add('R-FORM',(fm==='on-flash'?sl.onflash:fm==='plaintext'?sl.plain:sl.onflash&&sl.plain)?'pass':'block',`form=${fm||'uncalibrated'} onflash=${!!sl.onflash} plain=${!!sl.plain}`);
  const tr=qix?c.qixReady:c.rcspReady;
  add('R-PATH',pr&&pr.ota&&tr&&(qix?P.capabilities.qixFd00:P.capabilities.rcspOta)?'pass':'block',`profileOta=${!!(pr&&pr.ota)} fd00=${P.capabilities.qixFd00} transport=${tr}`);
  add('R-BATT',b.level!=null&&(b.level>=30||b.charging===true)?'pass':'block',`${b.level==null?'—':b.level}% charging=${b.charging}`);
  add('R-TEST',!c.flags.testMode&&!c.flags.dump&&!P.testModeSuspected?'pass':'block',`test=${c.flags.testMode||P.testModeSuspected} dump=${c.flags.dump}`);
  add('R-CONN',c.connected&&c.phoneBtOff?'pass':'block',`gatt=${c.connected} phoneBtOff=${c.phoneBtOff}`);
  const dump=R.kind==='full-dump'||R.containsKeyMac,dc=c.dumpCert,dp=dc&&dc.passport,own=dump&&dp&&dp.deviceId===P.deviceId;
  add('R-DUMP',!dump?'pass':own&&!qix?'warn':'block',dump?`cert.passport=${dp?dp.deviceId:'—'} device=${P.deviceId} path=${c.path}`:'no dump');
  add('R-DUMP-INTEG',!dump||dc&&dc.verified===true&&dc.sigOk===true&&dc.dumpSha256===R.sha256?'pass':'block',dump?(dc?`verified=${dc.verified} sig=${dc.sigOk} sha=${dc.dumpSha256===R.sha256}`:'no certificate'):'no dump');
  const v=vcmp(R.version,P.fwVersion);
  add('R-VER',v==null||v<0?'warn':'pass',`${P.fwVersion||'—'} → ${R.version||'—'}`);
  const kg=[...((pr&&pr.knownGoodImages)||[]).map(x=>x.sha256),...c.imageAllow];
  add('R-HASH',kg.includes(R.sha256)?'pass':'warn',(R.sha256||'').slice(0,16)+'…');
  add('R-PROBE',c.flags.probe?'block':'pass',`probe=${c.flags.probe}`);
  return{overall:rules.some(r=>r.severity==='block')?'BLOCK':rules.some(r=>r.severity==='warn')?'WARN':'ALLOW',rules}}

function fixture(){
  const P={deviceId:'dev',name:'EC-BADGE',chipFamily:'AC707N/BR35',sdkString:'jl_sdk_ac707_publish',fwVersion:'2.711.1.0.3',battery:{level:80,charging:false},capabilities:{qixFd00:true,rcspOta:true},profileId:'e87-ac707n',testModeSuspected:false,gatt:{services:[]}};
  const R={size:0x90000,sha256:'h',kind:'fw-custom',qixWrapped:true,chipkey:0x9847,targetProfileId:'e87-ac707n',ubootHash:'u',appBinSize:0x80000,crc:{hdr:true,list:true,data:true,qix:true},version:'2.711.1.0.4',geometry:{flashSize:0x400000,codeSpan:[0,0x17E000],appSlot:0xFC000},containsKeyMac:false,internalJlCrcOk:true,slices:{onflash:'a',plain:'b'}};
  const c={path:'qix',lang:'ru',profiles:PROFILES,ubootAllow:['u'],imageAllow:['h'],maxImage:16<<20,qixReady:true,rcspReady:true,connected:true,phoneBtOff:true,flags:{testMode:false,dump:false,probe:false},dumpCert:null};
  return{P,R,c}}
const NEG={'R-CHIP':f=>f.R.targetProfileId='e87-ac701n','R-KEY':f=>f.R.chipkey=0x1234,'R-UBOOT':f=>f.R.ubootHash='native','R-WRAP':f=>f.R.qixWrapped=false,
  'R-CRC':f=>f.R.crc.data=false,'R-SIZE':f=>f.R.appBinSize=0x200000,'R-GEOM':f=>f.R.geometry.appSlot=1,'R-PATH':f=>f.P.capabilities.qixFd00=false,
  'R-BATT':f=>f.P.battery.level=10,'R-TEST':f=>f.c.flags.testMode=true,'R-CONN':f=>f.c.phoneBtOff=false,'R-DUMP':f=>f.R.containsKeyMac=true,
  'R-VER':f=>f.R.version='2.711.1.0.1','R-HASH':f=>f.R.sha256='x','R-PROBE':f=>f.c.flags.probe=true,'R-FORM':f=>f.R.slices.plain=null,'R-DUMP-INTEG':f=>f.R.kind='full-dump'};
function selfTest(){
  const out=[],ok=(n,v)=>out.push({n,ok:!!v});
  ok('CRC-16/XMODEM "123456789" = 0x31C3',crc16(new TextEncoder().encode('123456789'))===0x31C3);
  let f=fixture();ok('rules: reference → ALLOW',evaluate(f.P,f.R,f.c).overall==='ALLOW');
  const c7=parse9E(fromHex('9E 8D 00 C7 0D 00 01 68 01 68 01 70 01 70 01 F4 10 00 00')),d7=c7&&decodeC7(c7.payload);
  ok('9E/C7 from E87 log: checksum ok, 360×360, 368×368',!!d7&&c7.ok&&c7.cmd===0xC7&&d7.width===360&&d7.h2===368&&d7.f5===500&&d7.f6===16);
  const bp=parse9E(fromHex('9E 91 09 27 02 00 00 5F'));ok('9E/0x27 battery push from E87 log: 95%',bp.ok&&bp.cmd===0x27&&bp.payload[1]===95);
  ok('qixEncode: heartbeat = 9E B5 0B 29 01 00 80',hex(qixEncode(0x0B,0x29,[0x80]))==='9E B5 0B 29 01 00 80');
  ok('qixEncode: C6 = 9E D3 0B C6 01 00 01',hex(qixEncode(0x0B,0xC6,[1]))==='9E D3 0B C6 01 00 01');
  const full=fromHex('9E 8D 00 C7 0D 00 01 68 01 68 01 70 01 70 01 F4 10 00 00');let q=qixTake(Uint8Array.of(0x11,0x22,...full.subarray(0,10)));
  const q2=qixTake(Uint8Array.of(...q.rest,...full.subarray(10)));ok('qixTake: garbage + fragmented frame → 1 frame',!q.frame&&q.skipped===2&&!!q2.frame&&eq(q2.frame,full));
  const ti=fromHex('fe dc ba c0 03 00 06 74 ff ff ff ff 00 ef');let f1=feTake(ti.subarray(0,9)),f2=feTake(Uint8Array.of(...f1.rest,...ti.subarray(9)));
  ok('feTake: fragmented RCSP frame (btsnoop GetTargetInfo)',!f1.frame&&!!f2.frame&&eq(f2.frame,ti));
  const tlv=decodeTargetInfo(parseTlv(Uint8Array.of(5,16,116,101,115,116,7,2,0x12,0x34,0x56,0x78,0x9a,0xbc,5,10,0x05,0xb9,0xab,0xcd,5,13,1,16,2,28)));
  ok('target_info TLV: name / MAC / vid_pid / fw',tlv.name==='test'&&tlv.edr_addr==='12:34:56:78:9a:bc'&&tlv.vid_pid==='vid=0x5B9 pid=0xABCD'&&tlv.fw_version==='1.16.2.28');
  const real=parseRcspResp(fromHex('FE DC BA 00 03 00 7D 00 01 02 00 20 05 01 00 00 00 00 09 02 46 88 00 02 09 DC 0E 00 07 04 00 00 00 04 00 00 03 05 00 01 02 06 0D 03 07 31 30 05 08 00 01 01 00 04 09 00 00 00 05 0A 00 02 00 8B 11 0B 68 45 39 79 66 73 65 58 36 55 64 4B 37 72 46 68 15 0C 6A 6C 5F 73 64 6B 5F 61 63 36 39 37 5F 70 75 62 6C 69 73 68 05 0D 01 10 02 1C 08 11 00 46 88 00 02 09 DC 02 12 00 03 13 04 04 05 15 00 00 00 07 EF')),rt=real&&decodeTargetInfo(parseTlv(real.data));
  ok('target_info from real E87: ac697 / 1.16.2.28 / MAC / auth_key hidden',!!rt&&real.status===0&&rt.project_code==='jl_sdk_ac697_publish'&&rt.fw_version==='1.16.2.28'&&rt.edr_addr.startsWith('46:88:00:02:09:dc')&&rt.ble_addr==='type 0 46:88:00:02:09:dc'&&!/hE9y/.test(JSON.stringify(rt))&&rt.protocol_version==='32');
  if(typeof functionE1test==='function'){const K=fromHex('06775F87918DD423005DF1D8CF0C142B'),M=fromHex('112233332211'),E=i=>hex(functionE1test([...M],[...fromHex(i)],[...K]),'');
    ok('jl-auth: ТЗ-вектор + 3 KAT (2 с железа E87)',[['70B75992E05EA78FEC533BA12979B590','FFE9E6C80CE1F40F5CCEAE20831C5879'],['b6e080ecaff322916d88fad5aa34c2ac','1d8897ac4604d332e8175e81bb292524'],
      ['a53057d376fc0476e5dc68273b5e791e','b3242d82e1df6c545895ecae13b44fea'],['384ac9d8e481e5caaeb8cead20ee8f9e','fe1b5b643a790fdcf585e354dd377b0f']].every(([i,o])=>E(i)===o.toUpperCase()))}
  const mp=ids=>matchProfile({sdkString:'jl_sdk_ac707_publish',name:'E87',gatt:{services:['0000ae00-0000-1000-8000-00805f9b34fb','c2e6fd00-e966-1000-8000-bef9c223df6a']},charIds:ids},PROFILES);
  ok('profile: AC707N + FD01/FD02/FD03 → e87-ac707n',mp(['ae01','ae02','fd01','fd02','fd03','fd04','fd05'])==='e87-ac707n');
  ok('profile: without FD02 → none',mp(['ae01','ae02','fd01','fd03'])===null);
  const sevOf=(f,id)=>evaluate(f.P,f.R,f.c).rules.find(r=>r.id===id).severity;
  f=fixture();f.R.internalJlCrcOk=null;ok('R-CRC: internal JL CRC unknown → BLOCK',sevOf(f,'R-CRC')==='block');
  f=fixture();f.c.profiles={...PROFILES,'e87-ac707n':{...PROFILES['e87-ac707n'],expectedForm:'on-flash'}};f.R.slices.plain=null;
  ok('R-FORM: calibrated on-flash + flash.bin slice → pass',sevOf(f,'R-FORM')==='pass');
  f.R.slices={onflash:null,plain:'b'};ok('R-FORM: on-flash profile + app.bin only → BLOCK',sevOf(f,'R-FORM')==='block');
  f=fixture();f.P.battery={level:10,charging:true};ok('R-BATT: <30% + charging → pass',evaluate(f.P,f.R,f.c).overall==='ALLOW');
  for(const[id,mut]of Object.entries(NEG)){f=fixture();mut(f);const v=evaluate(f.P,f.R,f.c);ok(`${id} → ${v.overall}`,v.rules.find(r=>r.id===id).severity!=='pass'&&v.overall!=='ALLOW')}
  f=fixture();Object.assign(f.R,{kind:'full-dump',containsKeyMac:true,qixWrapped:false});f.c.path='rcsp';const cert={passport:{deviceId:'dev'},verified:true,sigOk:true,dumpSha256:'h'};
  f.c.dumpCert=cert;ok('R-DUMP: own verified dump + RCSP → WARN',sevOf(f,'R-DUMP')==='warn'&&sevOf(f,'R-DUMP-INTEG')==='pass');
  f.c.dumpCert={...cert,verified:false};ok('R-DUMP-INTEG: unverified certificate → BLOCK',sevOf(f,'R-DUMP-INTEG')==='block');
  f.c.dumpCert={...cert,sigOk:false};ok('R-DUMP-INTEG: bad signature → BLOCK',sevOf(f,'R-DUMP-INTEG')==='block');
  f.c.dumpCert={...cert,dumpSha256:'other'};ok('R-DUMP-INTEG: certificate of another file → BLOCK',sevOf(f,'R-DUMP-INTEG')==='block');
  f.c.dumpCert={...cert,passport:{deviceId:'other'}};ok('R-DUMP: foreign dump → BLOCK',evaluate(f.P,f.R,f.c).overall==='BLOCK');
  return out}
