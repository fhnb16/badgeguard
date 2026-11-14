/* ===== image ===== */
function workerMain(){onmessage=async e=>{const buf=e.data,b=new Uint8Array(buf);
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),x=>x.toString(16).padStart(2,'0')).join('');
  const out=[];let s='';for(let i=0;i<=b.length;i++){const c=b[i];if(c>=32&&c<127)s+=String.fromCharCode(c);else{if(s.length>=5&&out.length<8000)out.push(s);s=''}}
  const txt=out.join('\n'),m=re=>(txt.match(re)||[null])[0];
  postMessage({buf,sha,qix:(b[0]===0x62&&b[1]===0x63&&b[2]===0x61&&b[3]===0x66)||(b[0]===0xBC&&b[1]===0xAF),
    sdk:m(/jl_sdk_ac\w+/),ver:m(/\b\d+\.\d+\.\d+\.\d+\.\d+\b/),keyMac:/key_mac/i.test(txt),crc:crc16(b)},[buf])}}
function parseInWorker(buf){return new Promise((res,rej)=>{
  const url=URL.createObjectURL(new Blob([`const crc16=${crc16};(${workerMain})()`],{type:'text/javascript'})),wk=new Worker(url);
  const end=()=>{wk.terminate();URL.revokeObjectURL(url)};wk.onmessage=e=>{end();res(e.data)};wk.onerror=e=>{end();rej(new Error(e.message))};
  wk.postMessage(buf,[buf])})} // буфер передаётся в воркер и обратно без копий
async function loadImage(f){
  if(!f)return;if(ACTIVE.includes(S.phase))return toast(t('busy'),'warn');
  if(f.size>16<<20)return toast('E-IMG-001: > 16 MB','block');
  try{const r=await parseInWorker(await f.arrayBuffer());S.buf=r.buf;const dump=f.size===0x400000||r.keyMac;
    S.R={fileName:f.name,size:f.size,sha256:r.sha,kind:dump?'full-dump':'unknown',qixWrapped:r.qix,chipkey:null,targetProfileId:profileForSdk(r.sdk,S.profiles),
      ubootHash:null,appBinSize:null,crc:{hdr:null,list:null,data:null,qix:null},version:r.ver,geometry:null,containsKeyMac:dump,sdkString:r.sdk,fileCrc16:r.crc,internalJlCrcOk:null,slices:{onflash:null,plain:null}};
    S.img={flashBin:null,appBin:null};
    if(UFW.parse){const{flashBin=null,appBin=null,...rest}=await UFW.parse(new Uint8Array(S.buf),S.R);Object.assign(S.R,rest);S.img={flashBin,appBin}}
    await computeSlices();
    $('#phrase').value='';$('#riskAck').checked=false;toast(t('imgOk'),'ok');log('EV','',null,`image ${f.name} ${f.size} B sha256=${r.sha.slice(0,16)}…`)}
  catch(e){S.R=null;toast('E-IMG-001: '+e.message,'block')}
  render()}
