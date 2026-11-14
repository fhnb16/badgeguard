/* ===== auth ===== */
const profKey=id=>({key:fromHex(AUTH.profiles[id].key),magic:fromHex(AUTH.profiles[id].magic)});
function authSelfTest(){for(const id of['A','B']){const v=AUTH.profiles[id].vector;AUTH.ok[id]=false;
  if(AUTH.encrypt&&v)try{AUTH.ok[id]=eq(AUTH.encrypt(fromHex(v[0]),profKey(id)),fromHex(v[1]))}catch{}}}
async function authHandshake(ms){
  const ids=['A','B'].filter(i=>AUTH.ok[i]);if(!ids.length){log('EV','',null,t('authNP'));return{ok:false,keyProfile:null}}
  if(!S.chars.ae01||!S.chars.ae02)throw new Error('E-GATT-001 AE01/AE02');
  const rnd=crypto.getRandomValues(new Uint8Array(16)),on=(k,u,b)=>k==='ae02'&&u[0]===b;
  const r=await req('ae01',[0,...rnd],(k,u)=>on(k,u,1)&&u.length>=17,'auth 1/6',ms);
  const id=ids.find(i=>eq(r.u.slice(1,17),AUTH.encrypt(rnd,profKey(i)))); // авто-выбор ключ-профиля по ответу
  if(!id)throw new Error('E-AUTH-001 key profile mismatch');
  const ch=await req('ae01',[2,...new TextEncoder().encode('pass')],(k,u)=>on(k,u,0)&&u.length>=17,'auth 3/6',ms);
  const fin=await req('ae01',[1,...AUTH.encrypt(ch.u.slice(1,17),profKey(id))],(k,u)=>on(k,u,2),'auth 5/6',ms);
  if(!ascii(fin.u).includes('pass'))throw new Error('E-AUTH-001');
  return{ok:true,keyProfile:id}}
