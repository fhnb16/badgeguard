/* ===== ble/virtual — виртуальный E87 (демо-режим и интеграционные тесты) =====
 * Повторяет ПОВЕДЕНИЕ реального бейджа по полевому логу 2026-11-14:
 *  — auth E1 (профиль B), bootstrap, target_info/sys_info байт-в-байт из лога;
 *  — C7 фрагментами по 27 Б, battery push 0x27, health-заглушки 0x22/0x24;
 *  — исторические 0xA0/0xAA/0xA6 пробы не являются командами чтения флеша;
 *  — файловый браузер 0x0C/0x01/0x0D, малые файлы 0x28, OTA E1/E2/E3/E5/E6/E7,
 *  — контент-путь 0x21/0x27/0x1B/0x1D/0x20/0x1C с оконным управлением.
 * Никакого DOM: работает и в браузере (кнопка «Демо»), и в jsdom-тестах.
 */
function makeVirtualE87(opt={}){
  const O={name:'E87',mtu:{ae02:133,fd01:27,fd03:8},latency:2,dualBank:true,...opt};
  const U=s=>`0000${s}-0000-1000-8000-00805f9b34fb`,Q=n=>`c2e6${n}-e966-1000-8000-bef9c223df6a`;
  const chars={},L={},buf={};
  const listeners=[];
  const mk=(uuid,props)=>{const k=uuid.slice(4,8);L[k]=[];
    const c={uuid,properties:props,
      startNotifications:async()=>{c._n=true},stopNotifications:async()=>{c._n=false},
      addEventListener:(t,f)=>{if(t==='characteristicvaluechanged')L[k].push(f)},
      removeEventListener:(t,f)=>{const i=L[k].indexOf(f);if(i>=0)L[k].splice(i,1)},
      readValue:async()=>k==='2a00'?new DataView(new TextEncoder().encode(O.name).buffer):new DataView(new ArrayBuffer(0)),
      writeValueWithoutResponse:async u=>rx(k,new Uint8Array(u)),writeValueWithResponse:async u=>rx(k,new Uint8Array(u))};
    chars[k]=c;return c};
  const svcs=[
    {uuid:Q('fd00'),cs:[mk(Q('fd01'),{notify:true}),mk(Q('fd02'),{write:true,writeWithoutResponse:true}),mk(Q('fd03'),{read:true,write:true,notify:true}),
      mk(Q('fd04'),{writeWithoutResponse:true}),mk(Q('fd05'),{notify:true})]},
    {uuid:U('180f'),cs:[mk(U('2a19'),{read:true,notify:true})]},
    {uuid:U('ae00'),cs:[mk(U('ae01'),{writeWithoutResponse:true}),mk(U('ae02'),{notify:true})]},
    {uuid:U('1800'),cs:[mk(U('2a00'),{read:true,write:true})]}];
  const server={getPrimaryServices:async()=>svcs.map(s=>({uuid:s.uuid,getCharacteristics:async()=>s.cs}))};
  const device={id:'VIRTUAL-E87',name:O.name,gatt:{connected:false,
      connect:async()=>{device.gatt.connected=true;return server},
      disconnect:()=>{device.gatt.connected=false;listeners.forEach(f=>f({type:'gattserverdisconnected'}))}},
    addEventListener:(t,f)=>{if(t==='gattserverdisconnected')listeners.push(f)},removeEventListener:()=>{}};
  const send=(k,arr)=>{const u=bytesOf(arr),n=O.mtu[k]||512;
    for(let i=0;i<u.length;i+=n){const part=u.subarray(i,Math.min(i+n,u.length));
      setTimeout(()=>{if(!device.gatt.connected)return;for(const f of L[k])f({target:{uuid:chars[k].uuid,value:new DataView(part.buffer.slice(part.byteOffset,part.byteLength))}})},O.latency)}};
  const q9=(cmd,p)=>{const b=[0x9E,0,0x00,cmd,p.length&255,p.length>>8,...p];b[1]=b.slice(2).reduce((a,x)=>a+x,0)&255;return b};
  const feR=(cmd,body)=>[0xFE,0xDC,0xBA,0x00,cmd,body.length>>8,body.length&255,...body,0xEF];
  const feC=(cmd,body,flag=0xC0)=>[0xFE,0xDC,0xBA,flag,cmd,body.length>>8,body.length&255,...body,0xEF];
  const KEY=[0x06,0x77,0x5f,0x87,0x91,0x8d,0xd4,0x23,0,0x5d,0xf1,0xd8,0xcf,0x0c,0x14,0x2b],MAG=[0x11,0x22,0x33,0x33,0x22,0x11];
  const E=x=>functionE1test(MAG,[...x],KEY);
  let challenge=null,authed=false,sn=0;
  // TLV-ответы байт-в-байт из полевого лога (data/session-2026-11-14.log)
  const TI='02 00 20 05 01 00 00 00 00 09 02 46 88 00 02 09 DC 0E 00 07 04 00 00 00 04 00 00 03 05 00 01 02 06 0D 03 07 31 30 05 08 00 01 01 00 04 09 00 00 00 05 0A 00 02 00 8B 11 0B 68 45 39 79 66 73 65 58 36 55 64 4B 37 72 46 68 15 0C 6A 6C 5F 73 64 6B 5F 61 63 36 39 37 5F 70 75 62 6C 69 73 68 05 0D 01 10 02 1C 08 11 00 46 88 00 02 09 DC 02 12 00 03 13 04 04 05 15 00 00 00 07';
  const SI='FF 02 00 00 1A 02 04 00 00 00 00 00 00 00 00 00 00 00 02 00 00 00 00 00 00 00 00 00 00 00 00 04 05 41 4C 4C 02 06 00 02 09 00 08 0A 00 00 00 00 00 00 00 02 0F 00';
  const fromHexLocal=s=>Uint8Array.from(s.replace(/[^0-9a-f]/gi,'').match(/../g)||[],h=>parseInt(h,16));
  // Виртуальная файловая система
  const FS={3:{root:[{name:'watch',dir:true,cluster:0x100},{name:'logo.jpg',dir:false,cluster:0x101,id:1,size:1536}],
      sub:{0x100:[{name:'face1.bin',dir:false,cluster:0x110,id:2,size:1024},{name:'face2.bin',dir:false,cluster:0x111,id:3,size:2048}]}},
    1:{root:[{name:'sd-readme.txt',dir:false,cluster:0x200,id:9,size:64}],sub:{}}};
  const fileBytes=(id,n)=>Uint8Array.from({length:n},(_,i)=>(id*31+i*7)&255);
  const SMALL={9:[{id:0x10,size:48},{id:0x11,size:32}],5:[{id:0x20,size:64}]};
  const encName=(s,unicode)=>unicode?Uint8Array.from([...s].flatMap(c=>[c.charCodeAt(0)&255,c.charCodeAt(0)>>8])):new TextEncoder().encode(s);
  const entryBytes=(e,dev)=>{const uni=!e.dir&&e.name.includes('face');const nm=encName(e.name,uni);
    const h=(e.dir?0:1)|(uni?0:2)|((dev&0x1F)<<2);
    return[...[h,(e.cluster>>>24)&255,(e.cluster>>>16)&255,(e.cluster>>>8)&255,e.cluster&255,((e.id||0)>>8)&255,(e.id||0)&255,nm.length],...nm]};
  // Состояния сессий
  let ota=null,cnt=null;
  const stat={frames:0,reads:0,writes:0,browse:0,otaBlocks:0,contentBytes:0};
  function rx(k,u){
    stat.writes++;
    if(k==='ae01'){
      // поток FE: собираем кадры (телефон фрагментирует большие кадры)
      let b=buf.ae01?catN(buf.ae01,u):u;
      for(;;){const i=b.findIndex?0:0;let s=0;while(s+3<b.length&&!(b[s]===0xFE&&b[s+1]===0xDC&&b[s+2]===0xBA))s++;
        if(s)b=b.subarray(s);
        const r=feTake(b);if(!r.frame){b=r.rest;break}b=r.rest;feFrame(r.frame)}
      buf.ae01=b;
      if(u.length===17||u.length===5)authRx(u);
      return}
    if(k==='fd02'&&u[0]===0x9E)qFrame(u)}
  function authRx(u){
    if(u[0]===0&&u.length===17)send('ae02',[1,...E(u.slice(1))]);
    else if(u.length===5&&u[0]===2){challenge=Uint8Array.from({length:16},(_,i)=>(i*13+7)&255);send('ae02',[0,...challenge])}
    else if(u[0]===1&&u.length===17){const e=E(challenge||new Uint8Array(16));
      if(e.every((x,i)=>x===u[1+i])){authed=true;send('ae02',[2,0x70,0x61,0x73,0x73])}}}
  function feFrame(f){
    const cmd=f[4],flag=f[3],len=(f[5]<<8)|f[6],body=f.subarray(7,7+len);
    const isCmd=(flag&0x80)!==0,s=isCmd?body[0]:body[1],p=isCmd?body.subarray(1):body.subarray(2);
    stat.frames++;
    if(!isCmd){ // ответы телефона на наши команды/пуши
      if(cmd===0x01&&cnt){cnt.acked++;return}
      if(cmd===0x0D||cmd===0x0C){return}
      if(cmd===0x20&&cnt){cnt.path=p;setTimeout(()=>send('ae02',feC(0x1C,[cnt.sn,0x00])),O.latency);return}
      if(cmd===0x1C&&cnt){cnt.done=true;return}
      if(cmd===0xE5&&ota){otaServe(p);return}
      if(cmd===0xE8&&ota)return;
      return}
    switch(cmd){
      case 0x06:return send('ae02',feR(0x06,[0,s]));
      case 0x02:return send('ae02',feR(0x02,[0,s,0,0,0,7]));
      case 0x03:return send('ae02',feR(0x03,[0,s,...fromHexLocal(TI)]));
      case 0x07:return send('ae02',feR(0x07,[0,s,...fromHexLocal(SI)]));
      case 0x0C:return browse(p,s);
      case 0x28:return smallFile(p,s);
      case 0xE1:return send('ae02',feR(0xE1,[0,s,0,0,0,0,0,0]));
      case 0xE2:return send('ae02',feR(0xE2,[0,s,0x00]));
      case 0xE6:return send('ae02',feR(0xE6,[0,s,ota&&ota.finished?0x00:0x00]));
      case 0xE3:return otaStart(s);
      case 0xE7:{send('ae02',feR(0xE7,[0,s]));setTimeout(()=>device.gatt.disconnect(),400);return}
      case 0x0B:return send('ae02',feR(0x0B,[0,s,0x00]));
      case 0x21:case 0x27:return send('ae02',feR(cmd,[0,s]));
      case 0x1B:return contentStart(p,s);
      case 0x01:return contentData(f,body);
      default:
        // часть опкодов вендорского enum девайс знает, но не реализовал → UNKOWN_CMD; прочие молчат
        if([0x08,0x09,0x0A,0x0E,0x12,0x13,0x14,0x15,0x19,0x1A,0x1F,0x22,0x23,0x24,0x25,0x26,0xA0,0xA1,0xA5,0xD4,0xD6].includes(cmd))
          return send('ae02',feR(cmd,[0x02,s]));
        return}}
  function browse(p,s){
    const type=p[0],readNum=p[1],dev=(p[3]<<24|p[4]<<16|p[5]<<8|p[6])>>>0,pl=p[7]|(p[8]<<8);
    const cluster=pl>=4?(p[9]<<24|p[10]<<16|p[11]<<8|p[12])>>>0:0;
    stat.browse++;
    const fs=FS[dev];
    if(!fs)return send('ae02',feR(0x0C,[0xFF,s]));
    send('ae02',feR(0x0C,[0,s]));
    const list=cluster?(fs.sub[cluster]||[]):fs.root;
    const data=list.flatMap(e=>[...entryBytes(e,dev)]);
    setTimeout(()=>{
      for(let i=0;i<data.length;i+=64){const part=data.slice(i,i+64);
        send('ae02',feC(0x01,[++sn&255,0x0C,...part],0x80))}
      setTimeout(()=>send('ae02',feC(0x0D,[++sn&255,0x00])),O.latency*3)},O.latency*2)}
  function smallFile(p,s){
    const op=p[0],type=p[1];
    if(op===0){const items=SMALL[type]||[];return send('ae02',feR(0x28,[0,s,0,...items.flatMap(x=>[(x.id>>8)&255,x.id&255,(x.size>>8)&255,x.size&255])]))}
    if(op===1){const id=(p[2]<<8)|p[3],len=(p[6]<<8)|p[7];
      const meta=Object.values(SMALL).flat().find(x=>x.id===id)||Object.values(FS).flatMap(f=>[...f.root,...Object.values(f.sub).flat()]).find(x=>x.id===id);
      if(!meta)return send('ae02',feR(0x28,[0,s,0x01,0,0]));
      const n=Math.min(len,meta.size),d=fileBytes(id,n),c=crc16(d);
      stat.reads++;return send('ae02',feR(0x28,[0,s,0x00,(c>>8)&255,c&255,...d]))}
    return send('ae02',feR(0x28,[0,s,0x02]))}
  function otaStart(s){
    ota={off:0,size:cnt?cnt.size:0,finished:false,blocks:0};
    send('ae02',feR(0xE3,[0,s,0x00]));
    setTimeout(()=>send('ae02',feC(0xE8,[++sn&255,0x00,0x04,0x00,0x00])),O.latency);
    setTimeout(()=>otaPull(),O.latency*4)}
  function otaPull(){
    if(!ota||!device.gatt.connected)return;
    if(ota.total&&ota.off>=ota.total){send('ae02',feC(0xE5,[++sn&255,0,0,0,0,0,0]));ota.finished=true;return}
    const len=512;
    send('ae02',feC(0xE5,[++sn&255,(ota.off>>>24)&255,(ota.off>>>16)&255,(ota.off>>>8)&255,ota.off&255,(len>>8)&255,len&255]))}
  function otaServe(data){
    if(!ota)return;ota.blocks++;stat.otaBlocks++;
    if(ota.total==null)ota.total=0;
    ota.off+=data.length;
    if(!ota.total)ota.total=O.otaSize||65536;
    setTimeout(()=>otaPull(),O.latency)}
  function contentStart(p,s){
    const size=(p[0]<<24|p[1]<<16|p[2]<<8|p[3])>>>0;
    cnt={size,got:0,sn:++sn&255,acked:0,win:4096,cs:490};
    send('ae02',feR(0x1B,[0,s,(cnt.cs>>8)&255,cnt.cs&255]));
    setTimeout(()=>contentWin(),O.latency*3)}
  function contentWin(){
    if(!cnt||!device.gatt.connected)return;
    const left=cnt.size-cnt.got,win=Math.min(cnt.win,left);
    send('ae02',feC(0x1D,[++sn&255,0x00,(win>>8)&255,win&255,(cnt.got>>>24)&255,(cnt.got>>>16)&255,(cnt.got>>>8)&255,cnt.got&255],0x80));
    if(win===0)setTimeout(()=>send('ae02',feC(0x20,[cnt.sn])),O.latency*2)}
  function contentData(f,body){
    if(!cnt)return;
    const data=body.subarray(5); // [sn][xmOp=1D][slot][crcH][crcL][data]
    cnt.got+=data.length;stat.contentBytes+=data.length;
    if(cnt.got>=cnt.size)setTimeout(()=>contentWin(),O.latency);
    else if(cnt.got%cnt.win===0)setTimeout(()=>contentWin(),O.latency)}
  function qFrame(u){
    const cmd=u[3],p=u.subarray(6);
    switch(cmd){
      case 0xC6:return send('fd01',q9(0xC7,[1,0x68,1,0x68,1,0x70,1,0x70,1,0xF4,0x10,0,0]));
      case 0x29:if(authed)send('fd01',q9(0x27,[0,91]));return;
      case 0xDC:return send('fd03',q9(0xFF,[0xDC,0]));
      case 0xFF:{const sub=p[0];
        if(sub===0x22)return send('fd01',q9(0x22,[0x19,1,2,1,0x28,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]));
        if(sub===0x24)return send('fd01',q9(0x24,[0x19,1,2,1,0x3C,5,0]));
        return}
      case 0x21:return send('fd01',q9(0x21,[0,7]));
      // Historical opcode observations were ACK-only; the simulator does not model flash data.
      case 0xA0:case 0xAA:case 0xA6:return send('fd03',q9(0xFF,[cmd,0]));
      default:return}}
  return{device,stat,get authed(){return authed},get content(){return cnt},get ota(){return ota},
    setOtaSize:n=>{O.otaSize=n},disconnect:()=>device.gatt.disconnect()}}
