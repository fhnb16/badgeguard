/* ===== auth: 6-шаговый handshake JieLi на AE01/AE02 (порт qix-ble auth.py, сверен с btsnoop) ===== */
const profKey=id=>({key:fromHex(AUTH.profiles[id].key),magic:fromHex(AUTH.profiles[id].magic)});
const PASS=Uint8Array.of(0x02,0x70,0x61,0x73,0x73); // "\x02pass"
function authSelfTest(){for(const id of Object.keys(AUTH.profiles)){const v=AUTH.profiles[id].vectors||[];AUTH.ok[id]=false;
  if(AUTH.encrypt&&v.length)try{AUTH.ok[id]=v.every(([i,o])=>eq(AUTH.encrypt(fromHex(i),profKey(id)),fromHex(o)))}catch{}}}
async function authHandshake(ms){
  const ids=Object.keys(AUTH.profiles).filter(i=>AUTH.ok[i]);if(!ids.length){log('EV','',null,t('authNP'));return{ok:false,keyProfile:null}}
  if(!S.chars.ae01||!S.chars.ae02)throw new Error('E-GATT-001 AE01/AE02');
  const rnd=crypto.getRandomValues(new Uint8Array(16)),on=(b,n)=>(k,u)=>k==='ae02'&&u[0]===b&&u.length===n;
  const r=await req('ae01',[0,...rnd],on(1,17),'auth 1/6',ms);
  const id=ids.find(i=>eq(r.u.slice(1,17),AUTH.encrypt(rnd,profKey(i))));
  if(!id)throw new Error('E-AUTH-001 step 2: device encryption mismatch');
  const ch=await req('ae01',PASS,on(0,17),'auth 3/6',ms);
  const fin=await req('ae01',[1,...AUTH.encrypt(ch.u.slice(1,17),profKey(id))],(k,u)=>k==='ae02'&&u[0]===2,'auth 5/6',ms);
  if(!eq(fin.u,PASS))throw new Error('E-AUTH-001 step 6: no "\\x02pass"');
  log('EV','',null,'auth ✓ (6/6)');return{ok:true,keyProfile:id}}
