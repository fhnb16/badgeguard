/* ===== Device tools: bounded, read-only probes and supported RCSP features ===== */
const labBusy=()=>ACTIVE.includes(S.phase)||PROBE.running||BROWSE.running||OTA.running||CONTENT.running;
const labConnected=()=>S.conn==='on'&&S.gattReady&&S.P&&S.P.auth.ok;

async function sendLabProbe(){
  const transport=$('#probeTransport').value,u=fromHex($('#probeHex').value),raw=$('#probeHex').value;
  if(!/^[\da-f\s:,-]+$/i.test(raw)||raw.replace(/[\s:,-]/g,'').length%2)throw new Error('Hex должен содержать полные байты');
  validateReadOnlyProbe(transport,u);
  const ms=Math.max(500,Math.min(10000,Number($('#probeTimeout').value)||S.set.probeTo));
  const result=await rawProbe({transport,hexBytes:hex(u,''),ms,note:'manual read-only probe'});
  $('#rawResult').textContent=JSON.stringify(result,null,2);return result}

function bindLab(){
  const action=(id,fn)=>{$(id).onclick=()=>Promise.resolve().then(fn).catch(e=>{log('EV','',null,`device tool: ${e.message}`);toast(e.message,'warn')})};
  action('#btnRaw',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');await sendLabProbe()});
  action('#btnExportMatrix',()=>download('capability-matrix.json',buildCapabilityMatrix()));
  action('#btnBrowse',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');await browseAll({deep:true,maxDepth:3})});
  action('#btnSmallList',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');S.smallFiles=await listSmallFiles();renderLab()});
  action('#btnFetchResources',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');await fetchResources()});
  action('#btnExportResources',()=>exportResourcesZip());
  action('#btnExportManifest',()=>{if(!S.resManifest)throw new Error('Сначала выполните поиск или выгрузку ресурсов');download('resources-manifest.json',S.resManifest)});
  action('#btnOtaProbe',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');await otaProbe()});
  action('#btnScreen',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');const result=await readScreen();S.labScreen=result;renderLab()});
  action('#btnHealth',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');await readHealth()});
  action('#btnTime',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');await syncTime()});
  action('#btnSendImage',async()=>{if(!labConnected())throw new Error('Подключите устройство и пройдите auth');if(labBusy())throw new Error('Другая операция уже выполняется');
    const f=$('#contentImage').files[0];if(!f)throw new Error('Выберите изображение');
    const jpeg=await imageToJpeg(f);await contentUpload(jpeg,'image');$('#contentImage').value=''});
}

function renderLab(){
  const active=labBusy(),ready=labConnected();
  for(const id of['#btnRaw','#btnBrowse','#btnSmallList','#btnFetchResources','#btnOtaProbe','#btnScreen','#btnHealth','#btnTime','#btnSendImage'])
    $(id).disabled=!ready||active;
  $('#btnExportResources').disabled=!S.res.length;
  $('#btnExportManifest').disabled=!S.resManifest;
  $('#btnExportMatrix').disabled=false;
  const rows=[
    S.labScreen&&`screen: ${JSON.stringify(S.labScreen)}`,
    S.health&&`health (SDK stub): ${JSON.stringify(S.health)}`,
    S.otaProbe&&`OTA probe: ${JSON.stringify(S.otaProbe)}`,
    S.smallFiles.length&&`small files: ${JSON.stringify(S.smallFiles)}`,
    BROWSE.tree.length&&`browse tree: ${JSON.stringify(BROWSE.tree.map(n=>({dev:n.devName,ok:n.ok,reason:n.reason,
      files:n.files.map(({node,...f})=>f),children:n.children.map(({children,files,...c})=>({...c,files:files.map(({node,...f})=>f)}))})))}`,
    S.res.length&&`resources: ${JSON.stringify(S.res.map(({data,node,...r})=>r))}`,
    S.resManifest&&`manifest: ${JSON.stringify(S.resManifest)}`].filter(Boolean);
  $('#labResult').textContent=rows.join('\n\n')||'—';
  if(PROBE.last)$('#rawResult').textContent=JSON.stringify(PROBE.last,null,2);
}
