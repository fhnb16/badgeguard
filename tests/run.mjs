// Unit + mock tests: core rules, protocol guards, CRC/SHA vectors, hash mock, and dump validation.
import{readFileSync}from'node:fs';import vm from'node:vm';import{webcrypto}from'node:crypto';
globalThis.crypto??=webcrypto;
vm.runInThisContext(['protocol/jl-auth.js','core/registry.js','core/opmap.js','core/core.js','core/bitfields.js','protocol/rcsp.js','protocol/probe.js','protocol/hash.js','integrity/core.js']
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
let fail=0;for(const r of res){console.log((r.ok?'✓ ':'✕ ')+r.n);if(!r.ok)fail++}
console.log(`\n${res.length-fail}/${res.length} passed`);process.exit(fail?1:0);
