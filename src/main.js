/* ===== init ===== */
function init(){
  document.querySelectorAll('[data-set]').forEach(el=>{const k=el.dataset.set;el.type==='checkbox'?el.checked=S.set[k]:el.value=S.set[k];
    el.addEventListener('change',()=>{let v=el.type==='checkbox'?el.checked:el.value;
      if(el.type==='number'){v=Math.round(Math.min(+el.max,Math.max(+el.min,+v||DEF[k])));el.value=v}
      if(k==='verifySpan'){const sp=parseSpan(v);if(!sp||sp[1]>0x17E000){el.value=S.set[k];return toast('VERIFY_SPAN: 0xA:0xB ⊆ CODE [0x0, 0x17E000)','warn')}}
      setSetting(k,v)})});
  $('#btnConn').onclick=()=>S.conn==='on'?disconnect():connect(false);$('#btnConnAll').onclick=()=>connect(true);
  $('#btnTheme').onclick=()=>setSetting('theme',S.set.theme==='dark'?'light':'dark');$('#btnLang').onclick=()=>setSetting('lang',S.set.lang==='en'?'ru':'en');
  $('#btnRescan').onclick=()=>collectMeta();$('#btnExpPass').onclick=()=>S.P&&download('passport.json',S.P);$('#btnCopyPass').onclick=()=>S.P&&copy(JSON.stringify(S.P,null,2));
  const drop=$('#drop');$('#fileImg').onchange=e=>{loadImage(e.target.files[0]);e.target.value=''};
  drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#fileImg').click()}};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('drop--over')};drop.ondragleave=()=>drop.classList.remove('drop--over');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drop--over');loadImage(e.dataTransfer.files[0])};
  document.querySelectorAll('[name=path]').forEach(r=>r.onchange=()=>{S.path=r.value;render()});
  $('#fileCert').onchange=async e=>{try{const o=JSON.parse(await e.target.files[0].text());if(!o.dumpSha256||!o.passport)throw new Error('format');
    S.dumpCert={...o,sigOk:await verifyCert(o)};if(!S.dumpCert.sigOk)toast(t('certSig'),'warn')}catch(x){S.dumpCert=null;toast('cert: '+x.message,'warn')}e.target.value='';render()};
  ['#phrase','#riskAck','#phoneBt'].forEach(s=>$(s).addEventListener('input',render));
  $('#btnFlash').onclick=flash;$('#btnAbort').onclick=()=>{if(ABORTABLE.includes(S.phase)){S.abort=true;if(QIX.abort)Promise.resolve().then(()=>QIX.abort({w,log})).catch(()=>{});log('EV','',null,'abort requested')}};
  $('#btnProbe').onclick=probe;$('#btnPC').onclick=powerCycled;$('#btnReport').onclick=()=>download('flash-report.json',S.report);
  bindLab();
  $('#btnCopyLog').onclick=()=>copy(logText());$('#btnDlLog').onclick=()=>download('session.log',logText());
  $('#alAdd').onclick=()=>{const h=$('#alHash').value.trim().toLowerCase(),k=$('#alType').value;if(!/^[0-9a-f]{64}$/.test(h))return toast('SHA-256: 64 hex','warn');
    if(!S.allow[k].includes(h))S.allow[k].push(h);SV('allow',S.allow);$('#alHash').value='';renderAllow();render()};
  $('#alList').onclick=e=>{const d=e.target.dataset.rm;if(!d)return;const[k,h]=d.split(':');S.allow[k]=S.allow[k].filter(x=>x!==h);SV('allow',S.allow);renderAllow();render()};
  $('#fileProf').onchange=async e=>{try{const o=JSON.parse(await e.target.files[0].text());
      for(const p of Object.values(o))if(!p.match||!p.family||!Array.isArray(p.match.gattServices))throw new Error('bad profile');
      for(const p of Object.values(o)){if(p.ubootSha256Allowlist)p.ubootSha256Allowlist=p.ubootSha256Allowlist.map(h=>h.toLowerCase());(p.knownGoodImages||[]).forEach(x=>x.sha256=x.sha256.toLowerCase())}
      S.profiles=o;SV('profiles.v3',o);toast('profiles ✓','ok')}catch(x){toast('profiles: '+x.message,'block')}e.target.value='';render()};
  $('#btnExpProf').onclick=()=>download('profiles.json',S.profiles);
  $('#btnReset').onclick=()=>{S.profiles=structuredClone(PROFILES);SV('profiles.v3',null);Object.entries(DEF).forEach(([k,v])=>setSetting(k,v))};
  $('#btnRb').onclick=()=>reverify('L1');$('#btnRh').onclick=()=>reverify('L2');
  $('#btnAccept').onclick=()=>{if(S.int&&S.int.verdict==='partial'){S.int.acceptedPartial=true;idb('sessions',{integrity:S.int});render()}};
  $('#btnDump').onclick=takeDump;$('#btnSpot').onclick=spotCheck;$('#btnCertWired').onclick=certifyWired;
  $('#btnExpCert').onclick=()=>S.dumpCert&&download('dump.cert.json',stripCert(S.dumpCert));$('#btnExpInt').onclick=()=>S.int&&download('integrity-report.json',S.int);
  $('#btnCopyDig').onclick=()=>S.int&&copy(JSON.stringify({image:S.int.imageSha256,codeSlice:S.int.codeSliceSha256,readback:S.int.readback},null,2));
  addEventListener('beforeunload',e=>{if(ACTIVE.includes(S.phase)){e.preventDefault();e.returnValue=''}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.wake&&S.wake.released&&ACTIVE.includes(S.phase))navigator.wakeLock.request('screen').then(x=>S.wake=x,()=>{})});
  if(!navigator.bluetooth){$('#unsup').hidden=false;$('#btnConn').disabled=$('#btnConnAll').disabled=true}
  applyI18n();renderAllow();asyncSelfTest().then(r=>{S.asyncTests=r;applyI18n()},e=>toast('self-test: '+e.message,'block'));
  if(!LS('disc',0)){$('#disc').showModal();$('#btnDisc').onclick=()=>{SV('disc',1);$('#disc').close()}}
  log('EV','',null,`BadgeGuard ready. auth=${AUTH.ok.A||AUTH.ok.B} ufw=${!!UFW.parse} qix=${QIX.ready} readback=${READBACK.ready} jl=${!!JL.decrypt}`)}
if('serviceWorker' in navigator&&document.querySelector('link[rel=manifest]'))navigator.serviceWorker.register('sw.js').catch(()=>{});
init();
