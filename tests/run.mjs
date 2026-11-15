// Unit + mock tests: core rules, protocol guards, CRC/SHA vectors, hash mock, and dump validation.
import{readFileSync}from'node:fs';import vm from'node:vm';import{webcrypto}from'node:crypto';
globalThis.crypto??=webcrypto;
vm.runInThisContext(['protocol/jl-auth.js','core/registry.js','core/opmap.js','core/core.js','core/bitfields.js','protocol/rcsp.js','protocol/probe.js','protocol/filebrowse.js','protocol/ota.js','protocol/hash.js','integrity/core.js']
  .map(f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8')).join('\n'),{filename:'core-bundle.js'});
const res=[...vm.runInThisContext('selfTest()'),...await vm.runInThisContext('asyncSelfTest()')];
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
res.push(await vm.runInThisContext(`(async()=>{
  const saved={browseOnce,renderLab:globalThis.renderLab,log:globalThis.log,S:globalThis.S};
  const calls=[];
  try{
    globalThis.S={abort:false,res:[],smallFiles:[],P:null};
    globalThis.renderLab=()=>{};
    globalThis.log=()=>{};
    browseOnce=async o=>{
      calls.push(o);
      const entries=o.devHandler===2&&o.type===0?[{name:'BAG',isFile:false,cluster:7,devIndex:2}]:
        o.devHandler===2&&o.type===1?[{name:'image.bin',isFile:true,cluster:9,devIndex:2,id:3}]:[];
      return{...o,ok:true,entries,pushes:entries.length,bytes:0}
    };
    const result=await browseAll({deep:true,maxDepth:3});
    return{n:'browse walker retains device handler and discovered files',ok:result.files.length===1&&result.files[0].dev===2&&
      result.files[0].path==='BAG/image.bin'&&calls.some(x=>x.type===1&&x.devHandler===2)&&globalThis.S.resManifest===result.manifest}
  }catch(e){return{n:'browse walker retains device handler and discovered files',ok:false,error:e.message}}
  finally{
    browseOnce=saved.browseOnce;BROWSE.tree=[];BROWSE.files=[];BROWSE.manifest=null;
    for(const k of['S','renderLab','log'])if(saved[k]===undefined)delete globalThis[k];else globalThis[k]=saved[k]
  }
})()`));
res.push(await vm.runInThisContext(`(async()=>{
  const saved={rcspCmd,rcspAck,S:globalThis.S};let badCrc=false,request=null;
  const frame=(cmd,body)=>Uint8Array.of(0xFE,0xDC,0xBA,0xC0,cmd,body.length>>8,body.length&255,...body,0xEF);
  try{
    globalThis.S={abort:false,conn:'on',gattReady:true,P:{auth:{ok:true}},set:{reqTo:1000,browseTo:10000}};
    rcspAck=async()=>{};
    rcspCmd=async(cmd,payload)=>{
      request={cmd,payload:Array.from(payload)};
      const bytes=Uint8Array.of(0x41,0x42,0x43),crc=crc16(bytes)^(badCrc?1:0);
      rcspRoute('ae02',frame(0x01,[0x45,0x24,0,0,0,0,crc>>8,crc&255,...bytes]));
      rcspRoute('ae02',frame(0x24,[0x46,0x80,0,0,0,0]));
      return{kind:'fe-response',status:0,payload:Uint8Array.of(0x01,0,0,0,3)}
    };
    const file={devHandler:2,cluster:0x12345678,path:'BAG/image.jpg'};
    const good=await readBrowseFile(file);
    badCrc=true;
    const bad=await readBrowseFile(file);
    return{n:'0x24 cluster read validates request, stream CRC, and completion',ok:good.ok&&hex(good.data,'')==='414243'&&
      request.cmd===0x24&&request.payload.length===13&&request.payload[0]===1&&request.payload[4]===2&&
      request.payload.slice(9).join(',')==='18,52,86,120'&&!bad.ok&&bad.error.includes('CRC mismatch')}
  }catch(e){return{n:'0x24 cluster read validates request, stream CRC, and completion',ok:false,error:e.message}}
  finally{
    rcspCmd=saved.rcspCmd;rcspAck=saved.rcspAck;
    if(saved.S===undefined)delete globalThis.S;else globalThis.S=saved.S
  }
})()`));
let fail=0;for(const r of res){console.log((r.ok?'✓ ':'✕ ')+r.n);if(!r.ok)fail++}
console.log(`\n${res.length-fail}/${res.length} passed`);process.exit(fail?1:0);
