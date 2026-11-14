// Zero-dep сборщик: src/* → dist-single/index.html (один файл) + dist/ (PWA). Запуск: node build.mjs
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';
export const ORDER=['protocol/jl-auth.js','core/core.js','protocol/hash.js','integrity/core.js','adapters/ports.js','ui/i18n.js','ui/i18n-int.js','state/store.js','util/util.js',
  'ble/transport.js','protocol/testmode.js','protocol/auth.js','protocol/meta.js','image/image.js','ota/flasher.js','integrity/session.js','ui/render.js','main.js'];
const root=new URL('./',import.meta.url),src=f=>readFileSync(new URL('src/'+f,root),'utf8'),out=(f,d)=>{mkdirSync(new URL(f.replace(/[^/]+$/,''),root),{recursive:true});writeFileSync(new URL(f,root),d)};
const js="'use strict';\n"+ORDER.map(f=>`/* ---- src/${f} ---- */\n${src(f)}`).join('\n');
if(/<\/script/i.test(js))throw new Error('</script> inside JS');
const CSP=pwa=>`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src blob:${pwa?" 'self'":''}; img-src data:${pwa?" 'self'; manifest-src 'self'":''}; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const page=pwa=>src('shell.html').replace('%CSP%',CSP(pwa))
  .replace('%HEAD%',pwa?'<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg"><meta name="theme-color" content="#111A2E">':'')
  .replace('%CSS%',()=>src('styles.css')).replace('%JS%',()=>js);
const single=page(false),pwa=page(true),ver=createHash('sha256').update(pwa).digest('hex').slice(0,12);
out('dist-single/index.html',single);out('dist/index.html',pwa);out('dist/sw.js',src('pwa/sw.js').replace('%VERSION%',ver));
for(const f of['manifest.webmanifest','icon.svg'])out('dist/'+f,src('pwa/'+f));
console.log(`dist-single/index.html ${(single.length/1024).toFixed(1)} KB · dist/ PWA (sw ${ver})`);
