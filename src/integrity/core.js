/* ===== integrity/core: формы, срезы, L0/L1/L2, валидатор дампа (чистые функции) ===== */
const sha256hex=async u=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',u)),'').toLowerCase();
function parseSpan(s){const m=String(s).trim().match(/^(0x[0-9a-f]+|\d+)\s*[:-]\s*(0x[0-9a-f]+|\d+)$/i);if(!m)return null;const a=Number(m[1]),b=Number(m[2]);return a>=0&&b>a?[a,b]:null}
// shortcut: за пределами образа считаем 0xFF (стёртый NOR); подтверждается калибровкой §8.5 на HIL
function spanSlice(u,[a,b]){const o=new Uint8Array(b-a).fill(0xFF);if(a<u.length)o.set(u.subarray(a,Math.min(b,u.length)));return o}

// R-FORM: digest сравнивается только с кандидатом одной формы
function compareForm(d,c,form){
  if(form){const exp=form==='on-flash'?c.onflash:c.plain;if(!exp)return{match:false,expected:null,form,code:'E-INT-005'};
    return{match:d===exp,expected:exp,form,code:d===exp?null:'E-INT-006'}}
  if(c.onflash&&d===c.onflash)return{match:true,expected:d,form:'on-flash'};
  if(c.plain&&d===c.plain)return{match:true,expected:d,form:'plaintext'};
  return{match:false,expected:c.onflash||c.plain||null,form:null,code:'E-INT-006'}}
const l0ok=r=>r.chunkCrc.fail===0&&r.chunkCrc.ok>0&&r.wholeFileCrc16.ok===true&&r.bootMarker.ok===true;

// e: {l0, span, cands:{onflash,plain}, form, caps(), hash(addr,len), readback(addr,len)|null, sha(u8), onCalibrate(form)}
async function verifyFlash(e){
  const len=e.span[1]-e.span[0];
  const rep={level:'L0',...e.l0,codeSliceSha256:(e.form==='plaintext'?e.cands.plain:e.cands.onflash)||e.cands.plain||null,readback:{method:'none'},verdict:'partial',errors:[]};
  if(!l0ok(rep)){rep.verdict='failed';rep.errors.push('L0');return rep}
  let digest=null,method='none',caps=0;
  try{caps=await e.caps()}catch{}
  if(caps&CAPS.HASH_RANGE){try{digest=await e.hash(e.span[0],len);method='hash-cmd'}catch(x){rep.errors.push(x.message)}}
  if(!digest&&e.readback){try{digest=await e.sha(await e.readback(e.span[0],len));method='ble-dump'}catch(x){rep.errors.push(x.message)}}
  if(!digest)return rep; // partial: только L0
  rep.level=method==='hash-cmd'?'L2':'L1';
  const m=compareForm(digest,e.cands,e.form);
  rep.readback={method,digest,expected:m.expected,match:m.match,formUsed:m.form,ranges:[{addr:e.span[0],len,ok:m.match}]};
  if(m.match){if(!e.form)e.onCalibrate(m.form);rep.verdict='verified'}else{rep.verdict='failed';rep.errors.push(m.code)}
  return rep}

// §8.1 → DumpCertificate (без подписи). io: {sha, reRead?, decrypt?, parseHeader?, verifyCrcs?, layoutOk?, spotN?, rand?}
async function validateDump(buf,passport,profile,method,io){
  const size=profile.flash.size,errors=[],checks={sizeOk:buf.length===size,decryptOk:false,internalCrcOk:false,geomOk:false};
  if(!checks.sizeOk)errors.push('E-INT-001');
  const dumpSha256=await io.sha(buf);
  if(method==='ble-testmode'){checks.spotOk=false;
    if(io.reRead&&checks.sizeOk){const B=4096,rnd=io.rand||Math.random,rs=[0,size-B];
      for(let i=0;i<(io.spotN||16);i++)rs.push(Math.floor(rnd()*(size/B))*B);
      checks.spotOk=true;for(const a of rs)if(!eq(await io.reRead(a,B),buf.subarray(a,a+B))){checks.spotOk=false;errors.push('E-INT-002 @'+hx(a));break}}}
  try{const code=io.decrypt?await io.decrypt(buf.subarray(0,profile.flash.appSlot)):null;
    checks.decryptOk=!!code&&!!(await io.parseHeader(code));checks.internalCrcOk=checks.decryptOk&&!!(await io.verifyCrcs(code));
    if(!checks.decryptOk)errors.push('E-INT-004');else if(!checks.internalCrcOk)errors.push('E-INT-003')}
  catch(x){errors.push('E-INT-004 '+x.message)}
  checks.geomOk=checks.sizeOk&&!!(io.layoutOk&&await io.layoutOk(buf,profile));
  const verified=checks.sizeOk&&checks.decryptOk&&checks.internalCrcOk&&checks.geomOk&&(method==='wired-uboot'||checks.spotOk===true);
  return{dumpSha256,size:buf.length,method,passport,checks,verified,errors,createdAt:new Date().toISOString()}}

async function asyncSelfTest(){
  const out=[],ok=(n,v)=>out.push({n,ok:!!v}),enc=s=>new TextEncoder().encode(s),has=(r,c)=>r.errors.some(x=>x.startsWith(c));
  ok('SHA-256 "abc"',await sha256hex(enc('abc'))==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  ok('SHA-256 ""',await sha256hex(new Uint8Array(0))==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const onf=Uint8Array.from({length:64},(_,i)=>i^0x5A),pl=Uint8Array.from({length:40},(_,i)=>i),span=[0,64];
  const c={onflash:await sha256hex(spanSlice(onf,span)),plain:await sha256hex(spanSlice(pl,span))};
  ok('R-FORM: plaintext digest ≠ on-flash digest',c.onflash!==c.plain);
  ok('R-FORM: on-flash profile rejects plaintext digest',!compareForm(c.plain,c,'on-flash').match);
  ok('R-FORM: missing slice of profile form → E-INT-005',compareForm(c.onflash,{plain:c.plain},'on-flash').code==='E-INT-005');
  const L0={imageSha256:'h',chunkCrc:{ok:10,fail:0},wholeFileCrc16:{value:1,ok:true},ufwCrc:{},internalJlCrcOk:true,bootMarker:{ok:true,value:null},nameChanged:true,versionBefore:null,versionAfter:null};
  const resp=(st,d)=>{const u=new Uint8Array(37);u[0]=0xD5;u[1]=st;u[2]=1;if(d)u.set(fromHex(d),3);const x=crc16(u.subarray(1,35));u[35]=x>>8;u[36]=x&255;return u};
  const io=h=>({req:async(k,b)=>{const r=h(Uint8Array.from(b));if(!r)throw new Error('timeout');return{k,u:r}}});
  const dev=(d,st=0)=>io(b=>b[0]===0xD7?Uint8Array.of(0xD7,0,0,0,0,CAPS.HASH_RANGE):b[0]===0xD5&&st>=0?resp(st,d):null);
  const run=(D,o={})=>verifyFlash({l0:o.l0||L0,span,cands:c,form:o.form??null,caps:()=>readCaps(D,50),hash:(a,l)=>hashRange(D,a,l,0x400000,50),
    readback:o.rb||null,sha:sha256hex,onCalibrate:o.cal||(()=>{})});
  let r=await run(dev(c.onflash),{form:'on-flash'});ok('L2: HASH_RANGE match → verified',r.level==='L2'&&r.verdict==='verified');
  r=await run(dev('00'.repeat(32)));ok('L2: mismatch → failed E-INT-006',r.verdict==='failed'&&has(r,'E-INT-006'));
  let cal=null;r=await run(dev(c.plain),{cal:f=>cal=f});ok('calibration: plaintext form recorded',r.verdict==='verified'&&cal==='plaintext');
  r=await run(dev(null,2),{rb:async()=>spanSlice(onf,span)});ok('unsupported → E-INT-007 → fallback L1 verified',r.level==='L1'&&r.verdict==='verified'&&has(r,'E-INT-007'));
  r=await run(dev(null,-1));ok('HASH_RANGE timeout → E-INT-008 → partial',r.verdict==='partial'&&has(r,'E-INT-008'));
  r=await run(io(()=>null));ok('no Caps, no readback → L0 partial',r.level==='L0'&&r.verdict==='partial');
  r=await run(dev(c.onflash),{l0:{...L0,chunkCrc:{ok:9,fail:1}}});ok('L0: chunk CRC fail → failed',r.verdict==='failed');
  const bad=resp(0,c.onflash);bad[36]^=1;let thrown=false;try{parseHashResp(bad)}catch{thrown=true}ok('HASH_RANGE: response CRC checked',thrown);
  const prof={flash:{size:0x10000,appSlot:0x8000}},dump=Uint8Array.from({length:0x10000},(_,i)=>i*7&255),pp={deviceId:'dev'},
    jl={decrypt:async x=>x,parseHeader:async()=>true,verifyCrcs:async()=>true,layoutOk:async()=>true,sha:sha256hex,spotN:8,rand:()=>.5};
  let ct=await validateDump(dump,pp,prof,'ble-testmode',{...jl,reRead:async(a,l)=>dump.slice(a,a+l)});ok('dump: BLE + spot-check clean → verified',ct.verified&&ct.checks.spotOk);
  ct=await validateDump(dump,pp,prof,'ble-testmode',{...jl,reRead:async(a,l)=>{const x=dump.slice(a,a+l);if(!a)x[100]^=4;return x}});
  ok('dump: bit-flip → E-INT-002, not verified',!ct.verified&&ct.errors.some(e=>e.startsWith('E-INT-002')));
  ct=await validateDump(dump.subarray(0,0x8000),pp,prof,'wired-uboot',jl);ok('dump: size mismatch → E-INT-001',!ct.verified&&ct.errors.includes('E-INT-001'));
  ct=await validateDump(dump,pp,prof,'wired-uboot',{...jl,verifyCrcs:async()=>false});ok('dump: internal JL CRC fail → E-INT-003',!ct.verified&&ct.errors.includes('E-INT-003'));
  ct=await validateDump(dump,pp,prof,'wired-uboot',{sha:sha256hex});ok('dump: no JL port → not verified (fail-closed)',!ct.verified);
  return out}
