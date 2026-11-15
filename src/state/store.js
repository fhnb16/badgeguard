/* ===== state ===== */
const DEF={connectTo:15000,reqTo:3000,winTo:5000,chunk:490,win:8,retries:3,expert:false,chime:false,theme:'dark',lang:'ru',readbackOffer:true,spotN:16,verifySpan:'0x0:0xFC000',hashTo:30000,rcspPreAuth:false,probeTo:3000,scanTo:1500,browseTo:5000,otaLoopTo:10000};
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem('bg.'+k))??d}catch{return d}};
const SV=(k,v)=>{try{localStorage.setItem('bg.'+k,JSON.stringify(v))}catch{}};
function loadProfiles(){
  const saved=LS('profiles.v3',null);if(!saved)return structuredClone(PROFILES);
  const out={...structuredClone(PROFILES),...saved};
  for(const[id,base]of Object.entries(PROFILES)){
    const old=saved[id];if(!old)continue;
    const oldNames=Array.isArray(old.match&&old.match.names)?old.match.names.filter(name=>typeof name==='string'):[];
    const retainedNames=id==='e87-ac697x'?oldNames.filter(name=>!/^Q87/i.test(name)):oldNames;
    const names=[...(base.match.names||[]),...retainedNames];
    out[id]={...base,...old,match:{...base.match,...(old.match||{}),names:[...new Set(names)]}};
    if(Object.hasOwn(base,'ota'))out[id].ota=base.ota;
    if(Object.hasOwn(base,'mode'))out[id].mode=base.mode}
  return out}
const S={set:{...DEF,...LS('set',{})},allow:LS('allow',{uboot:[],image:[]}),flags:LS('flags',{testMode:false,dump:false,probe:false}),profiles:loadProfiles(),
  dev:null,chars:{},gatt:null,gattReady:false,conn:'off',P:null,R:null,buf:null,dumpPass:null,V:null,path:'qix',phase:'idle',log:[],waiters:[],ac:null,wake:null,
  prog:{done:0,total:0,t0:0,start:0,win:0},abort:false,locked:false,userDisc:false,reconnecting:false,report:null,dumpCert:null,dumpBuf:null,img:null,l0:null,int:null,asyncTests:null,chunkCrc:{ok:0,fail:0},boot:false,quiet:false,battAt:0,maxNotify:{},
  rawLog:[],scan:[],capMatrix:null,smallFiles:[],res:[],resManifest:null,health:null,otaProbe:null};
const ACTIVE=['preflight','armed','transferring','paused','resuming','applying','rebooting','verifying-marker','verifying-hash','verifying-readback','dumping'];
const ABORTABLE=['preflight','armed','transferring','paused','resuming','dumping','verifying-readback'];
