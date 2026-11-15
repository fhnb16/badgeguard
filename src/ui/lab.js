/* ===== Device tools: bounded, read-only probes and supported RCSP features ===== */
const labBusy=()=>ACTIVE.includes(S.phase)||PROBE.running||BROWSE.running||BROWSE.fetching||OTA.running||CONTENT.running;
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
  $('#otaApiConsent').addEventListener('change',renderLab);
  $('#otaApiEndpoint').addEventListener('change',renderLab);
  $('#otaApiHelperUrl').addEventListener('input',renderLab);
  $('#btnOtaApiCheck').onclick=async()=>{
    if(!$('#otaApiConsent').checked)return toast(t('otaApiConsent'),'warn');
    $('#otaApiResult').textContent='…';$('#otaApiDownload').hidden=true;
    try{
      const result=await requestOtaApiCheck({helperUrl:$('#otaApiHelperUrl').value,token:$('#otaApiHelperToken').value,
        endpointId:$('#otaApiEndpoint').value,model:$('#otaApiModel').value,version:$('#otaApiVersion').value});
      renderOtaApiResult(result);log('EV','',null,`OTA API request sent to ${result.endpointId}; HTTP ${result.upstreamStatus}`)}
    catch(e){renderOtaApiResult({ok:false,error:e.message});log('EV','',null,'OTA API request ✕ '+e.message);toast(e.message,'warn')}};
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
  $('#btnOtaApiCheck').disabled=!$('#otaApiConsent').checked||OTA_API_REQUEST.running;
  $('#btnExportResources').disabled=!S.res.length;
  $('#btnExportManifest').disabled=!S.resManifest;
  $('#btnExportMatrix').disabled=false;
  const otaEndpoint=otaApiEndpoint($('#otaApiEndpoint').value);
  $('#otaApiEndpointUrl').textContent=otaEndpoint?otaEndpoint.url:'—';
  let helperTarget=null;try{helperTarget=normalizeOtaHelperUrl($('#otaApiHelperUrl').value,location.href)}catch{}
  $('#otaApiTokenField').hidden=!helperTarget||!helperTarget.remote;
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
