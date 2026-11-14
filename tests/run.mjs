// Unit + mock тесты: ядро правил, CRC/SHA-векторы, HASH_RANGE-мок, валидатор дампа. Запуск: node tests/run.mjs
import{readFileSync}from'node:fs';import vm from'node:vm';import{webcrypto}from'node:crypto';
globalThis.crypto??=webcrypto;
vm.runInThisContext(['core/core.js','protocol/hash.js','integrity/core.js'].map(f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8')).join('\n'),{filename:'core-bundle.js'});
const res=[...vm.runInThisContext('selfTest()'),...await vm.runInThisContext('asyncSelfTest()')];
let fail=0;for(const r of res){console.log((r.ok?'✓ ':'✕ ')+r.n);if(!r.ok)fail++}
console.log(`\n${res.length-fail}/${res.length} passed`);process.exit(fail?1:0);
