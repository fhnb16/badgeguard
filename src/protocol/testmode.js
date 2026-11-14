/* ===== protocol/testmode: BLE-дамп флеша — порт qix-ble cli.py cmd_dump + диагностика =====
 * После auth + bootstrap: Qix 0xA0 [01] SET_TEST_MODE → 0xAA TEST_GET_FLASH <addr LE32><len LE32> → ответ 0xAA с байтами → 0xA6 TEST_CLOSE.
 * ElectronicCats помечают BLE-вектор как «to be validated» и снимают дамп проводом (UBOOT) — поэтому сначала проба:
 * размеры [chunk,128,64,16] (вдруг ответ не влезает в MTU), таймаут 10 с как в qix-ble, ack 0xFF [AA,status] = отказ,
 * и временная подписка на FD05 (канал «тяжёлых» передач; TEST_MODE и так требует power-cycle перед OTA). */
const le32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const isAA=(u,n)=>u[3]===0xAA||u[3]===0xFF&&u[6]===0xAA;
READBACK.ready=true;
READBACK.dumpRange=async(ctx,addr,len,onProgress)=>{
  if(!S.P||!S.P.auth.ok||!S.boot)throw new Error('E-DUMP-002 нужны auth + bootstrap');
  const tmo=Math.max(10000,S.set.reqTo),fd05=S.chars.fd05;let sub5=false;
  const get=async(off,n)=>{const r=await qreq(0xAA,[...le32(addr+off),...le32(n)],tmo,{match:isAA});
    if(r.cmd===0xFF)throw new Error(`E-DUMP-003 0xAA отклонён: ack status ${hx(r.payload[1])}`);
    if(r.payload.length!==n)throw new Error(`short ${r.payload.length}/${n}`);return r.payload};
  S.flags.testMode=S.flags.dump=true;saveFlags(); // ставим до 0xA0: даже без ответа бейдж может уже быть в TEST_MODE
  try{
    if(fd05&&(fd05.properties.notify||fd05.properties.indicate))try{await gq(()=>fd05.startNotifications());fd05.addEventListener('characteristicvaluechanged',onRx,{signal:S.ac.signal});sub5=true}catch{}
    await qreq(0xA0,[0x01],tmo,{expect:null});await sleep(300);
    const max=Math.max(16,Math.min(1024,S.set.dumpChunk|0||256));let cs=0,first=null,lastErr='';
    for(const n of S.dumpCs?[S.dumpCs]:[...new Set([max,128,64,16])].filter(x=>x<=max)){ // рабочий размер кэшируется на соединение (spot-check не пробует заново)if(S.abort)throw new Error('E-ABORT');
      log('EV','',null,`probe TEST_GET_FLASH ${n} B, timeout ${tmo/1000} s`);
      try{first=await get(0,Math.min(n,len));cs=n;break}catch(e){lastErr=e.message;log('EV','',null,`probe ${n} B ✕ ${e.message}`);if(e.message.startsWith('E-DUMP-003'))throw e}}
    if(!cs)throw new Error(`E-DUMP-003 TEST_GET_FLASH не отвечает (16–${max} B, FD01/FD03${sub5?'/FD05':''}; max notify ${JSON.stringify(S.maxNotify)}): ${lastErr}`);
    S.dumpCs=cs;log('EV','',null,`TEST_GET_FLASH ✓ chunk ${cs} B; dump ${hx(addr)}+${hx(len)}`);
    const out=new Uint8Array(len);out.set(first);let off=first.length;if(onProgress)onProgress(off);
    S.quiet=true; // в журнал не пишем тысячи кадров 0xAA; прочие кадры видны
    for(;off<len;){if(S.abort)throw new Error('E-ABORT');const n=Math.min(cs,len-off);let r;
      for(let tries=0;;tries++){try{r=await get(off,n);break}
        catch(e){if(S.abort||!S.gattReady||tries>=S.set.retries||e.message.startsWith('E-DUMP-003'))throw new Error(`E-DUMP-001 @${hx(addr+off)}: ${e.message}`);await sleep(150*2**tries)}}
      out.set(r,off);off+=n;if(onProgress)onProgress(off);if(off%0x40000===0)log('EV','',null,`dump ${hx(off)}/${hx(len)}`)}
    return out}
  finally{S.quiet=false;await qix(0x00,0xA6,[],'TEST_CLOSE').catch(()=>{});
    if(sub5){fd05.removeEventListener('characteristicvaluechanged',onRx);await gq(()=>fd05.stopNotifications()).catch(()=>{})}}};
