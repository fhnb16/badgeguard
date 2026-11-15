// Unit + mock tests: core rules, protocol guards, CRC/SHA vectors, hash mock, and dump validation.
import{readFileSync}from'node:fs';import vm from'node:vm';import{webcrypto}from'node:crypto';
globalThis.crypto??=webcrypto;
vm.runInThisContext(['protocol/jl-auth.js','core/registry.js','core/opmap.js','core/core.js','core/bitfields.js','protocol/rcsp.js','protocol/content.js','protocol/probe.js','protocol/filebrowse.js','protocol/ota.js','protocol/ota-api.js','protocol/hash.js','integrity/core.js']
  .map(f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8')).join('\n'),{filename:'core-bundle.js'});
const res=[...vm.runInThisContext('selfTest()'),...await vm.runInThisContext('asyncSelfTest()')];
res.push(...vm.runInThisContext(`(()=>{
  const check=(n,fn)=>{try{fn();return{n,ok:true}}catch(e){return{n,ok:false,error:e.message}}};
  return[
    check('OTA API permits one fixed ZRun request without authKey fields',()=>{
      const body=buildOtaApiRequest('zrun-www-prod','E87_EN','11.1.0.2');
      if(body.endpointId!=='zrun-www-prod'||body.model!=='E87_EN'||body.version!=='11.1.0.2'||Object.hasOwn(body,'authKey'))throw Error('unexpected request fields')
      let blocked=false;try{buildOtaApiRequest('zrun-www-prod','Abcd1234Efgh5678','11.1.0.2')}catch{blocked=true}
      if(!blocked)throw Error('authKey-like model accepted')
    }),
    check('OTA API disables JieLi endpoints without a request contract',()=>{
      let blocked=false;try{buildOtaApiRequest('jieli-api-ota','E87_EN','11.1.0.2')}catch{blocked=true}
      if(!blocked)throw Error('unverified endpoint accepted')
    }),
    check('OTA helper URL requires HTTPS except loopback',()=>{
      if(normalizeOtaHelperUrl('http://127.0.0.1:8765/ota-helper.php').remote)throw Error('loopback not recognized');
      if(!normalizeOtaHelperUrl('https://helper.example/ota-helper.php').remote)throw Error('remote helper not recognized');
      let blocked=false;try{normalizeOtaHelperUrl('http://helper.example/ota-helper.php')}catch{blocked=true}
      if(!blocked)throw Error('remote HTTP helper accepted')
    })
  ];
})()`));
res.push(...vm.runInThisContext(`(()=>{
  const check=(n,fn)=>{try{fn();return{n,ok:true}}catch(e){return{n,ok:false,error:e.message}}};
  const reject=(transport,frame)=>{let denied=false;try{validateReadOnlyProbe(transport,frame)}catch{denied=true}if(!denied)throw Error('unsafe frame accepted')};
  return[
    check('read-only probe accepts exact FE request',()=>validateReadOnlyProbe('ae01',Uint8Array.of(0xFE,0xDC,0xBA,0xC0,0x02,0,1,0,0xEF))),
    check('read-only probe rejects unsafe FE opcode',()=>reject('ae01',Uint8Array.of(0xFE,0xDC,0xBA,0xC0,0xA0,0,1,0,0xEF))),
    check('read-only probe accepts confirmed C6 request',()=>validateReadOnlyProbe('fd02',qixEncode(0x0B,0xC6,[1]))),
    check('read-only probe rejects other sideband commands',()=>reject('fd02',qixEncode(0x0B,0xA0,[1]))),
    check('FE pushes and generic ACKs are not command responses',()=>{
      const push=classifyFrame('ae02',Uint8Array.of(0xFE,0xDC,0xBA,0xC0,0x03,0,1,1,0xEF));
      const ack=classifyFrame('fd02',qixEncode(0x0B,0xFF,[0xC6,0]));
      if(isRealResponse(push)||isRealResponse(ack))throw Error('non-response classified as success')
    })
  ];
})()`));
res.push(...vm.runInThisContext(`(()=>{
  const saved={localStorage:globalThis.localStorage,log:globalThis.log},store=new Map();
  try{
    globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
    globalThis.log=()=>{};
    const savedFirmware=saveProductFirmware('device-e87',{name:'E87_EN',version:'11.1.0.2',build:'251229'});
    const loaded=loadProductFirmware('device-e87');
    clearProductFirmware('device-e87');
    return[{n:'service-menu product firmware persists per Web Bluetooth device',
      ok:savedFirmware.version==='11.1.0.2'&&loaded.build==='251229'&&loadProductFirmware('device-q87')===null&&loadProductFirmware('device-e87')===null}]
  }catch(e){return[{n:'service-menu product firmware persists per Web Bluetooth device',ok:false,error:e.message}]}
  finally{for(const k of['localStorage','log'])if(saved[k]===undefined)delete globalThis[k];else globalThis[k]=saved[k]}
})()`));
res.push(await vm.runInThisContext(`(async()=>{
  const savedS=globalThis.S;
  const frame=Uint8Array.of(0xFE,0xDC,0xBA,0xC0,0xE5,0,7,0x1C,0,0,0,0,0,8,0xEF);
  const queue=otaQueue();
  try{
    globalThis.S={abort:false};
    rcspRoute('ae02',frame);
    const request=await queue.next(50);
    return{n:'OTA pull queue captures E5 before transfer loop starts',
      ok=request&&request.cmd===0xE5&&hex(request.payload,'')==='000000000008'}
  }catch(e){return{n:'OTA pull queue captures E5 before transfer loop starts',ok:false,error:e.message}}
  finally{queue.un();if(savedS===undefined)delete globalThis.S;else globalThis.S=savedS}
})()`));
res.push(...vm.runInThisContext(`(()=>{
  const saved={S:globalThis.S,localStorage:globalThis.localStorage,log:globalThis.log},store=new Map();
  try{
    globalThis.S={P:{deviceId:'q87-device',profileId:'e87-ac697x',mode:'receiver',mac:'47:89:00:02:09:dc',availableMemoryHistory:[]},availableMemoryHistoryKey:null};
    globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
    globalThis.log=()=>{};
    const first=Uint8Array.of(1,0x68,1,0x68,1,0x70,1,0x70,1,0xF4,0x10,0,0);
    const next=Uint8Array.of(1,0x68,1,0x68,1,0x70,1,0x70,1,0x90,0x10,0,0);
    recordC7(first);bindMemoryHistory();recordC7(next);
    const key=memoryHistoryKey(S.P),e87Key=memoryHistoryKey({...S.P,mode:'standard',mac:'46:88:00:02:09:dc'});
    const savedHistory=JSON.parse(store.get('bg.'+key));
    return[{n:'C7 available-memory history persists per mode/device',
      ok:S.P.display.availableMemoryKiB===4240&&S.P.availableMemoryHistory.length===2&&S.P.availableMemoryHistory[0].value===4340&&
        S.P.availableMemoryHistory[1].value===4240&&savedHistory.length===2&&key.includes('receiver')&&key!==e87Key}]
  }catch(e){return[{n:'C7 available-memory history persists per mode/device',ok:false,error:e.message}]}
  finally{for(const k of['S','localStorage','log'])if(saved[k]===undefined)delete globalThis[k];else globalThis[k]=saved[k]}
})()`));
res.push(...vm.runInThisContext(`(()=>{
  const check=(n,fn)=>{try{fn();return{n,ok:true}}catch(e){return{n,ok:false,error:e.message}}};
  return[
    check('upload memory preflight applies 20% reserve in KiB',()=>{
      const r=contentMemoryPreflight(36599,43);
      if(r.requiredMemoryKiB!==43||r.availableMemoryKiB!==43)throw Error('wrong capacity calculation');
      let blocked=false;try{contentMemoryPreflight(36599,42)}catch(e){blocked=e.message.startsWith('E-CNT-004')}
      if(!blocked)throw Error('insufficient capacity accepted')
    }),
    check('content final status rejects device failure',()=>{
      if(!assertContentStatus(0))throw Error('success status rejected');
      let rejected=false;try{assertContentStatus(1)}catch(e){rejected=e.message.startsWith('E-CNT-003')}
      if(!rejected)throw Error('non-zero status accepted')
    })
  ];
})()`));
res.push(await vm.runInThisContext(`(async()=>{
  const saved={browseOnce,renderLab:globalThis.renderLab,log:globalThis.log,S:globalThis.S,context:BROWSE.context,contextKey:BROWSE.contextKey,manifest:BROWSE.manifest};
  const calls=[];
  try{
    globalThis.S={abort:false,res:[],smallFiles:[],P:null};
    globalThis.renderLab=()=>{};
    globalThis.log=()=>{};
    browseOnce=async o=>{
      calls.push(o);
      const entries=o.devHandler===2&&o.type===0?[{name:'test-dir',isFile:false,cluster:7,devIndex:2}]:
        o.devHandler===2&&o.type===1?[{name:'image.bin',isFile:true,cluster:9,devIndex:2,id:3}]:[];
      return{...o,ok:true,entries,pushes:entries.length,bytes:0}
    };
    const result=await browseAll({deep:true,maxDepth:3});
    const listed={file:result.files[0],count:result.manifest.listedFileCount,entryCount:result.manifest.listedEntryCount,fileCount:result.files.length};
    const e87=browseContextKey({profileId:'e87-ac697x',mode:'standard',mac:'46:88:00:02:09:dc',deviceId:'e87',name:'E87'});
    const q87Context={profileId:'e87-ac697x',mode:'receiver',mac:'47:89:00:02:09:dc',deviceId:'q87',name:'Q87'};
    const q87=browseContextKey(q87Context);useBrowseContext(q87Context,q87);
    return{n:'browse walker retains handler and isolates E87/Q87 manifests',ok:listed.fileCount===1&&listed.file.dev===2&&
      listed.file.path==='test-dir/image.bin'&&listed.count===1&&listed.entryCount===2&&
      calls.some(x=>x.type===1&&x.devHandler===2)&&globalThis.S.resManifest===null&&e87!==q87&&
      BROWSE.context.mode==='receiver'&&BROWSE.files.length===0}
  }catch(e){return{n:'browse walker retains handler and isolates E87/Q87 manifests',ok:false,error:e.message}}
  finally{
    browseOnce=saved.browseOnce;BROWSE.tree=[];BROWSE.files=[];BROWSE.manifest=null;
    BROWSE.context=saved.context;BROWSE.contextKey=saved.contextKey;BROWSE.manifest=saved.manifest;
    for(const k of['S','renderLab','log'])if(saved[k]===undefined)delete globalThis[k];else globalThis[k]=saved[k]
  }
})()`));
res.push(await vm.runInThisContext(`(async()=>{
  const saved={rcspCmd,rcspAck,S:globalThis.S,context:BROWSE.context,contextKey:BROWSE.contextKey};let badCrc=false,rejectRequest=false,request=null;
  const frame=(cmd,body)=>Uint8Array.of(0xFE,0xDC,0xBA,0xC0,cmd,body.length>>8,body.length&255,...body,0xEF);
  try{
    globalThis.S={abort:false,conn:'on',gattReady:true,dev:{id:'e87-test',name:'E87'},P:{auth:{ok:true},deviceId:'e87-test',name:'E87',advertisedName:'E87',profileId:'e87-ac697x',mode:'standard'},set:{reqTo:1000,browseTo:10000}};
    BROWSE.context=browseContext();BROWSE.contextKey=browseContextKey(BROWSE.context);
    rcspAck=async()=>{};
    rcspCmd=async(cmd,payload)=>{
      request={cmd,payload:Array.from(payload)};
      if(rejectRequest){rejectRequest=false;return{kind:'fe-response',status:1,payload:new Uint8Array(0)}}
      const bytes=Uint8Array.of(0x41,0x42,0x43),crc=crc16(bytes)^(badCrc?1:0);
      rcspRoute('ae02',frame(0x01,[0x45,0x24,0,0,0,0,crc>>8,crc&255,...bytes]));
      rcspRoute('ae02',frame(0x24,[0x46,0x80,0,0,0,0]));
      return{kind:'fe-response',status:0,payload:Uint8Array.of(0x01,0,0,0,3)}
    };
    const file={devHandler:2,cluster:0x12345678,path:'test-dir/image.jpg'};
    const good=await readBrowseFile(file);
    badCrc=true;
    const bad=await readBrowseFile(file);
    rejectRequest=true;const rejected=await readBrowseFile(file);
    return{n:'0x24 cluster read validates request, stream CRC, and completion',ok:good.ok&&hex(good.data,'')==='414243'&&
      request.cmd===0x24&&request.payload.length===13&&request.payload[0]===1&&request.payload[4]===2&&
      request.payload.slice(9).join(',')==='18,52,86,120'&&!bad.ok&&bad.error.includes('CRC mismatch')&&
      !rejected.ok&&rejected.status===1&&rejected.error.includes(hx(1))}
  }catch(e){return{n:'0x24 cluster read validates request, stream CRC, and completion',ok:false,error:e.message}}
  finally{
    rcspCmd=saved.rcspCmd;rcspAck=saved.rcspAck;
    BROWSE.context=saved.context;BROWSE.contextKey=saved.contextKey;
    if(saved.S===undefined)delete globalThis.S;else globalThis.S=saved.S
  }
})()`));
let fail=0;for(const r of res){console.log((r.ok?'✓ ':'✕ ')+r.n);if(!r.ok)fail++}
console.log(`\n${res.length-fail}/${res.length} passed`);process.exit(fail?1:0);
