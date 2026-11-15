/* ===== media — подготовка контента: JPEG для декодера JieLi + MJPG AVI =====
 * Порт auracast (MIT): sanitizeJpegForBadge + buildMjpgAvi.
 * Важно: APP1..APP15 (ICC/EXIF/Adobe) ВЫРЕЗАЮТСЯ — иначе бейдж рисует только первые строки.
 */
const E87_PIC=368;            // размер картинки для панели 360×360 (auracast E87_IMAGE_WIDTH/HEIGHT)
const MAX_UPLOAD_BYTES=900000;
const catN=(...us)=>{const n=us.reduce((s,u)=>s+u.length,0),o=new Uint8Array(n);let p=0;for(const u of us){o.set(u,p);p+=u.length}return o};
const fcc=s=>Uint8Array.from(s,c=>c.charCodeAt(0)&255);
const u32le=v=>Uint8Array.of(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);
const u16le=v=>Uint8Array.of(v&255,(v>>>8)&255);
const padEven=d=>d.length&1?catN(d,new Uint8Array(1)):d;
const riffChunk=(id,d)=>catN(fcc(id),u32le(d.length),padEven(d));
const riffList=(type,...ch)=>{const inner=catN(fcc(type),...ch);return catN(fcc('LIST'),u32le(inner.length),inner)};

function sanitizeJpeg(jpeg){
  if(jpeg.length<4||jpeg[0]!==0xFF||jpeg[1]!==0xD8)return jpeg;
  const out=[jpeg.subarray(0,2)];let i=2,stripped=false;
  while(i<jpeg.length-1){
    while(i<jpeg.length&&jpeg[i]===0xFF&&jpeg[i+1]===0xFF)i++;
    if(jpeg[i]!==0xFF)break;
    const m=jpeg[i+1];
    if(m===0xD8||m===0xD9){out.push(jpeg.subarray(i));break}
    if(m===0xDA){out.push(jpeg.subarray(i));break}
    if(i+4>jpeg.length)break;
    const len=(jpeg[i+2]<<8)|jpeg[i+3],end=i+2+len;
    if(end>jpeg.length)break;
    if(m>=0xE1&&m<=0xEF){stripped=true;i=end;continue}
    out.push(jpeg.subarray(i,end));i=end}
  return stripped?catN(...out):jpeg}

function buildMjpgAvi(rawFrames,{width=E87_PIC,height=E87_PIC,fps=null}={}){
  if(!rawFrames.length)throw new Error('нет кадров');
  const frames=rawFrames.map(sanitizeJpeg);
  const rate=Math.max(1,Math.min(120,Math.round(fps||(frames.length<=6?1:12))));
  const usec=Math.round(1e6/rate),maxSize=frames.reduce((m,f)=>Math.max(m,f.length),0),n=frames.length;
  const avih=riffChunk('avih',catN(u32le(usec),u32le(25000),u32le(0),u32le(0x0910),u32le(n),u32le(0),u32le(1),u32le(0x00100000),u32le(width),u32le(height),new Uint8Array(16)));
  const strh=riffChunk('strh',catN(fcc('vids'),fcc('MJPG'),u32le(0),u16le(0),u16le(0),u32le(0),u32le(1),u32le(rate),u32le(0),u32le(n),u32le(maxSize),u32le(0xFFFFFFFF),u32le(0),
    u16le(0),u16le(0),u16le(width),u16le(height)));
  const strf=riffChunk('strf',catN(u32le(40),u32le(width),u32le(height),u16le(1),u16le(24),fcc('MJPG'),u32le(width*height*3),u32le(0),u32le(0),u32le(0),u32le(0)));
  const junkSuper=new Uint8Array(4120);junkSuper[0]=4;junkSuper.set(fcc('00dc'),8);
  const strl=riffList('strl',strh,strf,riffChunk('JUNK',junkSuper));
  const vprp=riffChunk('vprp',catN(u32le(0),u32le(0),u32le(rate),u32le(width),u32le(height),u32le(1|(1<<16)),u32le(width),u32le(height),u32le(1),
    u32le(width),u32le(height),u32le(width),u32le(height),u32le(0),u32le(0),u32le(0),u32le(0)));
  const hdrl=riffList('hdrl',avih,strl,vprp,riffChunk('JUNK',new Uint8Array(260)));
  const info=riffList('INFO',riffChunk('ISFT',fcc('BadgeGuard\0')));
  const headerSoFar=12+hdrl.length+info.length+8;
  const align=riffChunk('JUNK',new Uint8Array(Math.max(0,5742-headerSoFar-8)));
  const movi=riffList('movi',...frames.map(f=>riffChunk('00dc',f)));
  const idx=[];let off=4;
  for(const f of frames){idx.push(catN(fcc('00dc'),u32le(0x10),u32le(off),u32le(f.length)));off+=8+f.length+(f.length&1)}
  const idx1=riffChunk('idx1',catN(...idx));
  const content=catN(fcc('AVI '),hdrl,info,align,movi,idx1);
  return catN(fcc('RIFF'),u32le(content.length),content)}

/* ---------- Canvas: рендер кадров ---------- */
const picSize=()=>{const d=S.P&&S.P.display;return d&&d.w2?Math.min(1024,d.w2):E87_PIC};
function newCanvas(n){const c=document.createElement('canvas');c.width=c.height=n;return c}
async function canvasJpeg(c,q=0.88){
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
  if(!blob)throw new Error('canvas.toBlob недоступен');
  return sanitizeJpeg(new Uint8Array(await blob.arrayBuffer()))}
function drawCover(ctx,src,n,mode='cover'){
  const sw=src.width||src.videoWidth,sh=src.height||src.videoHeight;
  ctx.fillStyle='#000';ctx.fillRect(0,0,n,n);
  if(mode==='contain'){const k=Math.min(n/sw,n/sh),w=sw*k,h=sh*k;ctx.drawImage(src,(n-w)/2,(n-h)/2,w,h);return}
  const k=Math.max(n/sw,n/sh),w=sw*k,h=sh*k;ctx.drawImage(src,(n-w)/2,(n-h)/2,w,h)}
async function bitmapOf(file){
  if('createImageBitmap'in window)try{return await createImageBitmap(file)}catch{}
  return await new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error('не удалось декодировать изображение'));img.src=URL.createObjectURL(file)})}
// Одиночный кадр (картинка / QR / статичный текст)
async function imageToJpeg(file,{size=picSize(),quality=0.88,fit='cover'}={}){
  const bmp=await bitmapOf(file),c=newCanvas(size);drawCover(c.getContext('2d'),bmp,size,fit);
  if(bmp.close)bmp.close();return await canvasJpeg(c,quality)}
// Текст / danmaku: несколько кадров прокрутки
function textFrames(text,{size=picSize(),fps=12,frames=24,mode='scroll',font='bold 64px sans-serif',color='#22D3EE',bg='#000'}={}){
  const c=newCanvas(size),ctx=c.getContext('2d');ctx.textBaseline='middle';ctx.font=font;
  const lines=String(text).split('\n'),out=[];
  const lh=size/(lines.length+1);
  for(let i=0;i<frames;i++){
    ctx.fillStyle=bg;ctx.fillRect(0,0,size,size);ctx.fillStyle=color;ctx.font=font;
    const p=i/frames;
    lines.forEach((ln,k)=>{
      const tw=ctx.measureText(ln).width;
      const x=mode==='scroll'?size-p*(tw+size):(size-tw)/2;
      const y=mode==='scroll'?size/2+(k-(lines.length-1)/2)*lh:(k+1)*lh;
      ctx.fillText(ln,x,y)});
    out.push(c)}
  return out}
async function textToAvi(text,opts={}){
  const o={size:picSize(),fps:12,frames:24,quality:0.85,...opts};
  const cs=textFrames(text,o),frames=[];
  for(const c of cs)frames.push(await canvasJpeg(c,o.quality));
  return buildMjpgAvi(frames,{width:o.size,height:o.size,fps:o.fps})}
// Слайдшоу: несколько картинок → AVI с низким fps
async function slideshowToAvi(files,{size=picSize(),fps=1,quality=0.85}={}){
  const frames=[];for(const f of files)frames.push(await imageToJpeg(f,{size,quality}));
  return buildMjpgAvi(frames,{width:size,height:size,fps})}
// Видео → кадры через <video> + seek (без WebCodecs, работает везде)
async function videoToFrames(file,{fps=12,maxFrames=120,size=picSize(),quality=0.8,onProgress=null}={}){
  const url=URL.createObjectURL(file),v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.src=url;
  try{
    await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=()=>rej(new Error('видео не декодируется браузером'));setTimeout(()=>rej(new Error('timeout видео')),15000)});
    const dur=Math.min(v.duration||1,60),step=1/fps,n=Math.min(maxFrames,Math.max(1,Math.floor(dur*fps)));
    const c=newCanvas(size),ctx=c.getContext('2d'),out=[];
    for(let i=0;i<n;i++){
      if(S.abort)break;
      await new Promise(res=>{v.onseeked=res;v.currentTime=Math.min(dur-0.05,i*step);setTimeout(res,1200)});
      drawCover(ctx,v,size);out.push(await canvasJpeg(c,quality));
      if(onProgress)onProgress(i+1,n)}
    return{frames:out,fps,duration:dur}}
  finally{URL.revokeObjectURL(url)}}
// GIF → кадры через WebCodecs ImageDecoder, если он есть
async function gifToFrames(file,{size=picSize(),maxFrames=60,quality=0.85}={}){
  if(!('ImageDecoder'in window))return null;
  const dec=new ImageDecoder({data:await file.arrayBuffer(),type:'image/gif'});
  await dec.completed;
  const n=Math.min(maxFrames,dec.tracks.selectedTrack.frameCount||1),c=newCanvas(size),ctx=c.getContext('2d'),out=[];let fps=10;
  for(let i=0;i<n;i++){
    const{image}=await dec.decode({frameIndex:i});
    if(image.duration&&i===0)fps=Math.max(1,Math.min(30,Math.round(1e6/image.duration)));
    drawCover(ctx,image,size);out.push(await canvasJpeg(c,quality));image.close()}
  dec.close();return{frames:out,fps}}
// Подгонка под бюджет устройства: понижаем качество, пока не влезем
async function fitFrames(frames,{budget=MAX_UPLOAD_BYTES,width,height,fps}={}){
  let total=frames.reduce((s,f)=>s+f.length,0);
  if(total<=budget)return{frames,fps,bytes:total,fits:true};
  const c=newCanvas(width||picSize()),ctx=c.getContext('2d');
  for(const q of[0.75,0.6,0.5,0.4,0.3,0.22]){
    const out=[];
    for(const f of frames){const bmp=await createImageBitmap(new Blob([f],{type:'image/jpeg'}));drawCover(ctx,bmp,c.width);bmp.close();out.push(await canvasJpeg(c,q))}
    total=out.reduce((s,f)=>s+f.length,0);
    if(total<=budget)return{frames:out,fps,bytes:total,fits:true,quality:q}}
  return{frames,fps,bytes:total,fits:false}}
