const OTA_API_ENDPOINTS=[
  {id:'zrun-www-dev',url:'https://www.zgntec.com/hy-cloud/app/dev/upgrade',enabled:true},
  {id:'zrun-www-prod',url:'https://www.zgntec.com/hy-cloud/app/prod/upgrade',enabled:true},
  {id:'zrun-www-test',url:'https://www.zgntec.com/hy-cloud/app/test/upgrade',enabled:true},
  {id:'zrun-www-gray',url:'https://www.zgntec.com/hy-cloud/app/gray/upgrade',enabled:true},
  {id:'zrun-www-v2',url:'https://www.zgntec.com/hy-cloud/app/v2/upgrade',enabled:true},
  {id:'zrun-www-prod-upgrade-v2',url:'https://www.zgntec.com/hy-cloud/app/prod/upgrade/v2',enabled:true},
  {id:'zrun-www-prod-firmware',url:'https://www.zgntec.com/hy-cloud/app/prod/firmware',enabled:true},
  {id:'zrun-www-prod-ota',url:'https://www.zgntec.com/hy-cloud/app/prod/ota',enabled:true},
  {id:'zrun-www-prod-version',url:'https://www.zgntec.com/hy-cloud/app/prod/version',enabled:true},
  {id:'zrun-www-prod-check',url:'https://www.zgntec.com/hy-cloud/app/prod/check',enabled:true},
  {id:'zrun-www-ota-upgrade',url:'https://www.zgntec.com/hy-cloud/ota/upgrade',enabled:true},
  {id:'zrun-www-device-upgrade',url:'https://www.zgntec.com/hy-cloud/device/upgrade',enabled:true},
  {id:'zrun-www-cloud-root',url:'https://www.zgntec.com/hy-cloud/',enabled:true},
  {id:'zrun-www-root',url:'https://www.zgntec.com/',enabled:true},
  {id:'zrun-bare-dev',url:'https://zgntec.com/hy-cloud/app/dev/upgrade',enabled:true},
  {id:'zrun-bare-prod',url:'https://zgntec.com/hy-cloud/app/prod/upgrade',enabled:true},
  {id:'zrun-bare-test',url:'https://zgntec.com/hy-cloud/app/test/upgrade',enabled:true},
  {id:'zrun-bare-gray',url:'https://zgntec.com/hy-cloud/app/gray/upgrade',enabled:true},
  {id:'zrun-bare-v2',url:'https://zgntec.com/hy-cloud/app/v2/upgrade',enabled:true},
  {id:'zrun-bare-prod-upgrade-v2',url:'https://zgntec.com/hy-cloud/app/prod/upgrade/v2',enabled:true},
  {id:'zrun-bare-prod-firmware',url:'https://zgntec.com/hy-cloud/app/prod/firmware',enabled:true},
  {id:'zrun-bare-prod-ota',url:'https://zgntec.com/hy-cloud/app/prod/ota',enabled:true},
  {id:'zrun-bare-prod-version',url:'https://zgntec.com/hy-cloud/app/prod/version',enabled:true},
  {id:'zrun-bare-prod-check',url:'https://zgntec.com/hy-cloud/app/prod/check',enabled:true},
  {id:'zrun-bare-ota-upgrade',url:'https://zgntec.com/hy-cloud/ota/upgrade',enabled:true},
  {id:'zrun-bare-device-upgrade',url:'https://zgntec.com/hy-cloud/device/upgrade',enabled:true},
  {id:'zrun-bare-cloud-root',url:'https://zgntec.com/hy-cloud/',enabled:true},
  {id:'zrun-bare-root',url:'https://zgntec.com/',enabled:true},
  {id:'jieli-pkgman',url:'https://pkgman.jieliapp.com/',enabled:false},
  {id:'jieli-cam',url:'https://cam.jieliapp.com/',enabled:false},
  {id:'jieli-api-ota',url:'https://api.jieliapp.com/ota/upgrade',enabled:false},
  {id:'jieli-api-firmware',url:'https://api.jieliapp.com/app/firmware',enabled:false},
  {id:'jieli-open-file',url:'https://open.jieliapp.com/ota/file',enabled:false},
  {id:'jieli-ota-upgrade',url:'https://ota.jieliapp.com/upgrade',enabled:false},
  {id:'jieli-www-ota',url:'https://www.zh-jieli.com/api/ota/upgrade',enabled:false},
  {id:'jieli-www-firmware',url:'https://www.zh-jieli.com/openapi/firmware',enabled:false},
  {id:'jieli-docs',url:'https://doc.zh-jieli.com/',enabled:false},
  {id:'jieli-gitlab',url:'https://gitlab.zh-jieli.com/',enabled:false},
  {id:'jieli-test-docs',url:'https://test03.jieliapp.com/',enabled:false},
  {id:'jieli-root',url:'https://jieliapp.com/',enabled:false},
  {id:'source-jieli-ota-apk',url:'https://github.com/Jieli-Tech/Android-JL_OTA/tree/master/apk',enabled:false},
  {id:'source-jieli-bluetooth-apk',url:'https://github.com/Jieli-Tech/Android-JL_Bluetooth/tree/main/apk',enabled:false},
  {id:'source-electroniccats-fw',url:'https://github.com/ElectronicCats/jieli-ble-badge-research/tree/main/firmware',enabled:false},
  {id:'source-ebadge-cli',url:'https://github.com/guan4tou2/ebadge-python-cli',enabled:false},
  {id:'source-qq-store',url:'https://sj.qq.com/appdetail/com.jieli.otasdk',enabled:false},
  {id:'source-app-store',url:'https://apps.apple.com/cn/app/id1535431659',enabled:false},
  {id:'source-play-store',url:'https://play.google.com/store/apps/details?id=com.zijun.zrun',enabled:false}
];
const OTA_API_REQUEST={running:false};
function otaApiEndpoint(id){return OTA_API_ENDPOINTS.find(x=>x.id===id)||null}
function buildOtaApiRequest(endpointId,model,version){
  const endpoint=otaApiEndpoint(endpointId);
  if(!endpoint||!endpoint.enabled)throw new Error('Для этого URL нет подтверждённого формата запроса');
  const clean=(value,label)=>{const s=String(value||'').trim();if(!/^[\x20-\x7E]{1,80}$/.test(s))throw new Error(`${label}: требуется 1–80 печатных ASCII символов`);return s};
  const safeModel=clean(model,'model');
  if(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{16}$/.test(safeModel))throw new Error('model похож на authKey и не будет отправлен');
  return{endpointId,model:safeModel,version:clean(version,'version')}}
function normalizeOtaHelperUrl(value,base=globalThis.location?.href||'http://127.0.0.1:8765/'){
  let url,page;try{page=new URL(base);url=new URL(String(value||'').trim(),page)}catch{throw new Error('Укажите URL PHP-помощника')}
  const host=url.hostname.toLowerCase(),local=['127.0.0.1','localhost','[::1]','::1'].includes(host),sameOrigin=url.origin===page.origin;
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local&&page.protocol==='http:'))throw new Error('Удалённый PHP-помощник должен использовать HTTPS');
  if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/ota-helper.php'))throw new Error('URL должен указывать на ota-helper.php без логина, query и fragment');
  return{url:url.href,remote:!sameOrigin}}
async function requestOtaApiCheck({helperUrl,token,endpointId,model,version}){
  if(OTA_API_REQUEST.running)throw new Error('OTA API-запрос уже выполняется');
  const target=normalizeOtaHelperUrl(helperUrl,location.href),payload=buildOtaApiRequest(endpointId,model,version),secret=String(token||'').trim();
  if(target.remote&&secret.length<32)throw new Error('Для удалённого helper нужен токен не короче 32 символов');
  OTA_API_REQUEST.running=true;renderLab();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const headers={'Content-Type':'application/json'};
    if(target.remote)headers['X-BadgeGuard-Helper-Token']=secret;
    const response=await fetch(target.url,{method:'POST',headers,body:JSON.stringify(payload),credentials:'omit',
      cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!result||typeof result!=='object')throw new Error(`PHP helper вернул не JSON (HTTP ${response.status})`);
    if(!response.ok||result.ok!==true)throw new Error(result.error||`PHP helper HTTP ${response.status}`);
    return{...result,endpointId,endpointUrl:otaApiEndpoint(endpointId).url,helperUrl:target.url,model:payload.model,version:payload.version}}
  catch(e){if(e.name==='AbortError')throw new Error('Таймаут PHP helper (20 с)');throw e}
  finally{clearTimeout(timer);OTA_API_REQUEST.running=false;renderLab()}}
function renderOtaApiResult(result){
  const pre=$('#otaApiResult'),link=$('#otaApiDownload');pre.textContent=JSON.stringify(result,null,2);
  link.hidden=true;link.removeAttribute('href');
  const raw=result&&result.response&&result.response.body&&result.response.body.download_address;
  if(typeof raw==='string'&&raw){try{const url=new URL(raw);if(url.protocol==='https:'){link.href=url.href;link.textContent=url.href;link.hidden=false}}
    catch(e){log('EV','',null,'OTA API returned invalid download URL: '+e.message)}}
}
