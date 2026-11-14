/* ===== render ===== */
function kv(sel,o,empty){$(sel).innerHTML=o?Object.entries(o).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join(''):`<dd class="kv__empty">${esc(empty)}</dd>`}
function ring(){const p=S.prog,f=p.total?p.done/p.total:0,el=(performance.now()-p.t0)/1000,sp=el>0?(p.done-p.start)/1024/el:0;
  $('#ringArc').style.strokeDashoffset=String(1024.2*(1-f));$('#ringPct').textContent=Math.floor(f*100)+'%';$('#ringPhase').textContent=S.phase;
  $('#ring').setAttribute('aria-valuenow',Math.floor(f*100));$('#ring').classList.toggle('ring--live',S.phase==='transferring');
  $('#ringSub').textContent=p.total?`${sp.toFixed(2)} KB/s  ETA ${sp>0?Math.ceil((p.total-p.done)/1024/sp)+' s':'—'}\nwin ${p.win}  chunk ${Math.ceil(p.done/S.set.chunk)}/${Math.ceil(p.total/S.set.chunk)}`:''}
function render(){
  const on=S.conn==='on',P=S.P,R=S.R,act=ACTIVE.includes(S.phase);
  $('#connDot').className='dot dot--'+S.conn;$('#connTxt').textContent=t('st_'+S.conn);
  $('#hdrName').textContent=(P&&P.name)||(S.dev&&S.dev.name)||'—';$('#hdrBatt').textContent=P&&P.battery.level!=null?`🔋${P.battery.level}%`:'';
  $('#btnConn').textContent=on?t('disc'):t('conn');$('#btnConnAll').hidden=on;
  kv('#passKv',P&&{name:P.name,deviceId:P.deviceId,chipFamily:P.chipFamily,sdkString:P.sdkString,fwVersion:P.fwVersion,productName:P.productName,
    display:P.display&&`${P.display.width}×${P.display.height} · ${P.display.w2}×${P.display.h2} · f5=${P.display.f5} f6=${P.display.f6} f7=${P.display.f7}`,variant:P.variant,
    battery:`${P.battery.level??'—'}% charging=${P.battery.charging}`,auth:P.auth.ok?'ok, profile '+P.auth.keyProfile:'—',profileId:P.profileId||'— (OTA BLOCK)',
    capabilities:Object.entries(P.capabilities).filter(x=>x[1]).map(x=>x[0]).join(', ')||'—',testModeSuspected:P.testModeSuspected,capturedAt:P.capturedAt},t('noDev'));
  $('#gattPre').textContent=S.gatt?Object.entries(S.gatt.chars).map(([s,c])=>s+'\n  '+c.join('\n  ')).join('\n'):'—';
  kv('#imgKv',R&&{fileName:R.fileName,size:`${R.size} B`,sha256:R.sha256,kind:R.kind,qixWrapped:R.qixWrapped,chipkey:hx(R.chipkey),ubootHash:R.ubootHash,appBinSize:hx(R.appBinSize),
    crc:JSON.stringify(R.crc),internalJlCrcOk:R.internalJlCrcOk,fileCrc16:hx(R.fileCrc16),'slice on-flash':R.slices.onflash,'slice plaintext':R.slices.plain,version:R.version,sdkString:R.sdkString,targetProfileId:R.targetProfileId,
    geometry:R.geometry&&`${hx(R.geometry.flashSize)} [${R.geometry.codeSpan.map(hx)}] slot ${hx(R.geometry.appSlot)}`,containsKeyMac:R.containsKeyMac},t('noImg'));
  $('#heur').hidden=!(R&&!UFW.parse);
  S.V=P&&R?evaluate(P,R,ctxNow()):null;const V=S.V;
  $('#verdict').className='verdict'+(V?' verdict--'+V.overall:'');$('#verdict').innerHTML=V?`${V.overall}<small>${V.rules.filter(r=>r.severity!=='pass').map(r=>r.id).join(' ')||'✓'}</small>`:`<small>${esc(t('verdictNone'))}</small>`;
  $('#rules').innerHTML=V?V.rules.map(r=>`<li class="rule rule--${r.severity}"><span class="rule__i" aria-label="${r.severity}">${{pass:'✓',warn:'⚠',block:'✕'}[r.severity]}</span><span class="rule__id">${r.id}</span><span>${esc(r.message)}</span><span class="rule__ev">${esc(r.evidence)}</span></li>`).join(''):'';
  $('#warnBox').hidden=!(V&&V.overall==='WARN');
  const ck=[['pf_batt',P&&P.battery.level!=null&&(P.battery.level>=30||P.battery.charging)],['pf_gatt',on&&S.gattReady],['pf_verdict',gateOk()],
    ['pf_test',!S.flags.testMode&&!S.flags.probe&&!(P&&P.testModeSuspected)],['pf_wake','wakeLock' in navigator],['pf_phone',$('#phoneBt').checked],['pf_tr',QIX.ready]];
  $('#checks').innerHTML=ck.map(([k,v])=>`<li class="${v?'ok':'no'}" data-i="${v?'✓':'✕'}">${esc(t(k))}</li>`).join('');
  $('#btnFlash').disabled=!gateOk()||act;$('#btnAbort').disabled=!ABORTABLE.includes(S.phase);
  $('#btnProbe').disabled=!QIX.ready||!on||!(P&&P.profileId)||act;$('#btnPC').disabled=act;$('#btnReport').disabled=!S.report;
  $('#btnRescan').disabled=!on||act;$('#btnConn').disabled=act||!navigator.bluetooth;
  ring();renderInt()}
function renderAllow(){$('#alList').innerHTML=['image','uboot'].flatMap(k=>S.allow[k].map(h=>`<li><button class="btn btn--s" data-rm="${k}:${h}" aria-label="remove">✕</button>${k} ${h}</li>`)).join('')}
function applyI18n(){document.documentElement.lang=S.set.lang;document.documentElement.dataset.theme=S.set.theme;
  document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));document.querySelectorAll('[data-i18n-ph]').forEach(e=>e.placeholder=t(e.dataset.i18nPh));
  $('#btnLang').textContent=S.set.lang==='en'?'RU':'EN';
  authSelfTest();const tests=[...selfTest(),...(S.asyncTests||[]),...['A','B'].map(i=>({n:`auth ${i}: ${AUTH.encrypt?(AUTH.profiles[i].vector?'test vector':'no vector'):'PORT: jl-auth'}`,ok:AUTH.ok[i]}))];
  $('#tests').innerHTML=tests.map(x=>`<li class="${x.ok?'ok':'no'}">${x.ok?'✓':'✕'} ${esc(x.n)}</li>`).join('');render()}
function setSetting(k,v){S.set[k]=v;SV('set',S.set);document.querySelectorAll(`[data-set="${k}"]`).forEach(el=>el.type==='checkbox'?el.checked=v:el.value=v);applyI18n();if(k==='expert')rebuildLog();if(k==='verifySpan')computeSlices().then(render)}
