/* ===== protocol/testmode: BLE-дамп флеша — порт qix-ble cli.py cmd_dump =====
 * После auth + bootstrap: Qix 0xA0 [01] SET_TEST_MODE → 0xAA TEST_GET_FLASH <addr LE32><len LE32> → ответ 0xAA с байтами → 0xA6 TEST_CLOSE.
 * Включает TEST_MODE: до power-cycle бейдж молча отвергает REQ_UPDATE (R-TEST). */
const le32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
READBACK.ready=true;
READBACK.dumpRange=async(ctx,addr,len,onProgress)=>{
  if(!S.P||!S.P.auth.ok||!S.boot)throw new Error('E-DUMP-002 нужны auth + bootstrap');
  const out=new Uint8Array(len),cs=Math.max(16,Math.min(1024,S.set.dumpChunk|0||256)),tmo=Math.max(2000,S.set.reqTo);
  await qreq(0xA0,[0x01],tmo,{expect:null});log('EV','',null,`TEST_MODE on, dump ${hx(addr)}+${hx(len)} chunk ${cs}`);
  S.quiet=true; // 16k кадров на 4 МБ — в журнал только прогресс
  try{for(let off=0;off<len;){if(S.abort)throw new Error('E-ABORT');const n=Math.min(cs,len-off);let r;
      for(let tries=0;;tries++){try{r=await qreq(0xAA,[...le32(addr+off),...le32(n)],tmo);if(r.payload.length!==n)throw new Error(`short ${r.payload.length}/${n}`);break}
        catch(e){if(S.abort||!S.gattReady||tries>=S.set.retries)throw new Error(`E-DUMP-001 @${hx(addr+off)}: ${e.message}`);await sleep(150*2**tries)}}
      out.set(r.payload,off);off+=n;if(onProgress)onProgress(off);if(off%0x40000===0){S.quiet=false;log('EV','',null,`dump ${hx(off)}/${hx(len)}`);S.quiet=true}}}
  finally{S.quiet=false;await qix(0x00,0xA6,[],'TEST_CLOSE').catch(()=>{})}
  return out};
