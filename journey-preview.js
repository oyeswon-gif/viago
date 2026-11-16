// Google first; free OSM fallback is selected before creating a new map.
// 2026-11-15: 일정 탭 하루 미리보기 — 한 손가락으로 이동(greedy), 일차 전체 일정 맞춤,
// 사용자가 옮긴 지도 위치 유지, 좌표 없는 장소는 '위치 확인 필요'로 안내.
(()=>{
 const preview=document.getElementById('journeyDayPreview'),button=document.getElementById('journeyPreviewOpen'),container=document.getElementById('journeyDayMap'),note=document.getElementById('journeyPreviewNote');
 // 시안 C 컨트롤 (2026-11-16)
 const homeBtn=document.getElementById('journeyMapHome'),hintEl=document.getElementById('journeyMapHint'),
   zoomInBtn=document.getElementById('journeyZoomIn'),zoomOutBtn=document.getElementById('journeyZoomOut'),
   sheet=document.getElementById('mapViewSheet'),sheetDesc=document.getElementById('mapViewSheetDesc'),
   sheetDaySub=document.getElementById('mapViewDaySub'),sheetTripSub=document.getElementById('mapViewTripSub'),
   VIEW_KEY_PREFIX='journey-note-map-views-',HINT_KEY_PREFIX='journey-note-map-hint-';
 let value,objects=[],layer,generation=0,signature='',frame,noteFrame=0,userMoved=false,fitContext='',lastTabDay=null,framingUntil=0,lastPaint=null,frameMode='auto',previewMoveEnd=null;
 // 지도 가장자리와 우측 하단 '전체 동선' 버튼·안내 문구가 차지하는 자리는 비워 둔다.
 const ZOOM_MAX=17,FIT_MAX=16,PAD_TOP=14,PAD_LEFT=14,PAD_RIGHT=98,PAD_BOTTOM=58;
 function visibility(){const entries=overviewEntries();preview.hidden=foodMode||!entries.length;if(preview.hidden||!sharedReady)return;const next=JSON.stringify([activeTrip.id,candidateMode,dayIndex,entries.map(x=>[x.p.id,x.p.name,x.c,x.label])]);if(next===signature)return;signature=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update().catch(()=>{signature='';container.textContent='지도를 연결하지 못했어요. Google 지도에서 길찾기는 계속 사용할 수 있어요.'}))}
 function project(point,zoom){const size=256*Math.pow(2,zoom),rad=point[0]*Math.PI/180;return [(point[1]+180)/360*size,(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*size]}
 function size(){return {w:container.clientWidth,h:container.clientHeight}}
 function pads(w,h){const right=Math.min(PAD_RIGHT,Math.max(56,Math.round(w*0.32))),bottom=Math.min(PAD_BOTTOM,Math.max(44,Math.round(h*0.2)));return {top:PAD_TOP,left:PAD_LEFT,right,bottom}}
 // 좌표가 있는 장소 전부가 들어가는 최대 확대 단계를 고르고, 비어 둔 여백만큼 중심을 옮긴다.
 function fitView(points,w,h,pad){
  if(!points.length)return {zoom:13,lat:35.1709,lng:136.9065};
  if(new Set(points.map(x=>x.c[0].toFixed(6)+','+x.c[1].toFixed(6))).size===1)return {zoom:FIT_MAX,lat:points[0].c[0],lng:points[0].c[1]};
  const aw=Math.max(60,w-pad.left-pad.right),ah=Math.max(60,h-pad.top-pad.bottom);
  // 어떤 배율에서도 들어가지 않으면(좌표 이상) 세계지도(1)로 떨어지지 않게 도시 배율에서 멈춘다.
  let zoom=4;
  for(let z=FIT_MAX;z>=1;z--){const px=points.map(x=>project(x.c,z)),xs=px.map(p=>p[0]),ys=px.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)<=aw&&Math.max(...ys)-Math.min(...ys)<=ah){zoom=z;break}}
  const px=points.map(x=>project(x.c,zoom)),xs=px.map(p=>p[0]),ys=px.map(p=>p[1]);
  const midX=(Math.min(...xs)+Math.max(...xs))/2,midY=(Math.min(...ys)+Math.max(...ys))/2;
  const [lat,lng]=viagoLatLngAt(midX+(w/2-(pad.left+aw/2)),midY+(h/2-(pad.top+ah/2)),zoom);
  return {zoom,lat,lng};
 }
 function outsideList(points,w,h,zoom,lat,lng){if(!points.length)return [];const center=project([lat,lng],zoom);return points.filter(x=>{const p=project(x.c,zoom);return Math.abs(p[0]-center[0])>w/2-8||Math.abs(p[1]-center[1])>h/2-8})}
 function paintNote(text,full){if(!note)return;const offline=navigator.onLine===false,base=text||'',parts=[];
  if(offline)parts.push('오프라인 — 지도 배경은 표시되지 않아요. 저장된 일정·마커만 볼 수 있어요');
  if(base)parts.push(base);
  note.textContent=parts.join(' · ');note.hidden=!parts.length;note.title=[full||base,offline?'오프라인에서는 지도 배경 타일을 받을 수 없습니다. 저장된 일정과 장소 마커만 볼 수 있습니다.':''].filter(Boolean).join(' · ');
  note.toggleAttribute('data-offline',offline);
  const canRefit=!!base&&/화면 밖/.test(base);
  if(canRefit)note.dataset.refit='1';else delete note.dataset.refit;
  note.setAttribute('role',canRefit?'button':'text');note.tabIndex=canRefit?0:-1}
 // offline-keep: 오프라인 보관은 서비스 워커가 한 번 설치된 뒤부터 동작한다.
 function offlineFirstRunNote(){try{return navigator.onLine===false&&!navigator.serviceWorker?.controller?'처음 한 번은 인터넷에 연결해 열어야 오프라인에서도 열립니다':''}catch{return ''}}
 // 화면 밖 장소와 좌표를 확인하지 못한 장소를 한 줄로 알린다. (좌표 없는 장소는 지도에 임의로 찍지 않는다)
 function noteLine(points,missing,w,h,zoom,lat,lng){
  const parts=[];
  if(missing.length)parts.push('위치 확인 필요 '+missing.length+'곳'+(missing.length<=2?': '+missing.map(x=>x.p.name).join(', '):''));
  const out=missing.length?[]:outsideList(points,w,h,zoom,lat,lng);
  if(out.length)parts.push('화면 밖 '+out.length+'곳');
  return parts.join(' · ');
 }
 function noteDetail(points,missing,w,h,zoom,lat,lng){
  const parts=[];
  if(missing.length)parts.push('위치 확인 필요 '+missing.length+'곳: '+missing.map(x=>x.p.name).join(', '));
  const out=outsideList(points,w,h,zoom,lat,lng);
  if(out.length)parts.push('화면 밖 '+out.length+'곳: '+out.map(x=>x.p.name).join(', '));
  return parts.join(' · ');
 }
 function paintView(points,missing,w,h,zoom,lat,lng){lastPaint={points,missing,w,h,zoom,lat,lng};const extra=navigator.onLine===false?offlineFirstRunNote():'';paintNote([noteLine(points,missing,w,h,zoom,lat,lng),extra].filter(Boolean).join(' · '),noteDetail(points,missing,w,h,zoom,lat,lng))}
 // 지도 한 곳에 보기를 적용한다(Google·Leaflet 공통).
 function setMapView(map,provider,view,animate){
  try{
   if(provider==='google'){map.setCenter({lat:view.lat,lng:view.lng});map.setZoom(view.zoom);google.maps.event.trigger(map,'resize')}
   else{map.invalidateSize();map.setView([view.lat,view.lng],view.zoom,{animate:!!animate})}
  }catch(e){}
 }
 // mode: 'auto' = 저장된 기본값이 있으면 그 화면으로 / 'bounds' = 사용자가 요청한 전체 동선 맞춤
 function applyFrame(map,provider,points,missing,mode){const {w,h}=size();if(w<40||h<40)return false;framingUntil=Date.now()+600;
  const saved=mode==='bounds'?null:daySavedView(dayIndex);
  if(saved){setMapView(map,provider,saved,false);paintView(points,missing,w,h,saved.zoom,saved.lat,saved.lng);lastZoom=saved.zoom;return true}
  const pad=pads(w,h),f=fitView(points,w,h,pad);
  setMapView(map,provider,f,false);
  paintView(points,missing,w,h,f.zoom,f.lat,f.lng);lastZoom=f.zoom;return true}
 // 사용자가 지도를 움직인 뒤에도 '화면 밖' 안내가 실제 화면과 맞도록 다시 계산한다.
 // 가장 빽빽한 장소 무리(예: 사카에 11곳)의 좌표 — 확대했을 때 빈 곳 대신 일정 쪽을 보여주는 기준
 function densestCenter(points){let best=points[0],bestN=-1;for(const p of points){let n=0;for(const q of points){if(Math.abs(q.c[0]-p.c[0])<0.02&&Math.abs(q.c[1]-p.c[1])<0.02)n++}if(n>bestN){bestN=n;best=p}}return best&&best.c}
 let lastZoom=null;
 function followView(map,provider,points,missing){if(Date.now()<framingUntil)return;cancelAnimationFrame(noteFrame);noteFrame=requestAnimationFrame(()=>{const {w,h}=size();if(w<40||h<40)return;let zoom,center;try{zoom=map.getZoom();center=map.getCenter();center=typeof center.lat==='function'?[center.lat(),center.lng()]:[center.lat,center.lng]}catch{return}if(!Number.isFinite(zoom)||!center)return;
  // 확대했는데 그날 장소가 하나도 화면에 없으면 가장 빽빽한 무리로 중심을 옮긴다. (빈 땅만 확대되는 것 방지)
  if(points.length&&lastZoom!==null&&zoom>lastZoom&&outsideList(points,w,h,zoom,center[0],center[1]).length===points.length){const target=densestCenter(points);if(target){lastZoom=zoom;try{provider==='google'?map.setCenter({lat:target[0],lng:target[1]}):map.panTo([target[0],target[1]],{animate:false})}catch(e){}center=[target[0],target[1]]}}
  lastZoom=zoom;paintView(points,missing,w,h,zoom,center[0],center[1])})}
 // 한 손가락 드래그로 이동, 두 손가락 핀치로 확대. (cooperative 의 '두 손가락' 안내 없음)
 function enableGestures(map,provider){if(provider==='google'){try{map.setOptions({gestureHandling:'greedy',disableDefaultUI:true,zoomControl:false,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,clickableIcons:false,keyboardShortcuts:false})}catch{}}else{try{map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable()}catch{}}}
 async function update(){const run=++generation;value=await createTravelMap('journeyDayMap',{center:{lat:35.1709,lng:136.9065},zoom:13,maxZoom:ZOOM_MAX,disableDefaultUI:true,gestureHandling:'greedy',clickableIcons:false,zoomControl:false,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,keyboardShortcuts:false});if(run!==generation)return;const {map,provider}=value,entries=overviewEntries(),points=entries.filter(x=>x.c),missing=entries.filter(x=>!x.c),color=candidateMode?'#8764df':'#3187ff';
 enableGestures(map,provider);
 // 일차·여행·후보 탭이 바뀔 때만 다시 맞춘다. 같은 일차의 동기화·재렌더로는 위치를 건드리지 않는다.
 const context=[activeTrip.id,candidateMode?'candidate':foodMode?'food':'day',dayIndex].join('|');if(context!==fitContext){fitContext=context;userMoved=false}
 if(provider==='google'){objects.forEach(x=>x.setMap(null));objects=[]}
 else{layer?.remove();layer=L.layerGroup().addTo(map)}
 const draw=()=>viagoDrawLocated('preview',map,provider,points,color,{connect:!candidateMode,labels:false,holder:provider==='google'?objects:layer,compact:true,zoomMax:ZOOM_MAX,pad:userMoved?null:{top:8,left:8,right:pads(size().w,size().h).right,bottom:PAD_BOTTOM}});
 const mode=frameMode;frameMode='auto';
 if(!userMoved){
  if(!applyFrame(map,provider,points,missing,mode))setTimeout(()=>{if(run===generation&&!userMoved){applyFrame(map,provider,points,missing,mode);draw()}},220);
  else draw();
 }else draw();
 paintHint();
 if(provider==='google'){google.maps.event.clearListeners(map,'idle');google.maps.event.addListener(map,'idle',()=>followView(map,provider,points,missing))}
 // 주의: map.off('moveend') 로 전부 지우면 Leaflet 타일 그리드의 moveend 처리까지 사라져
 //       (드래그 후 새로 드러난 쪽 타일이 비는 원인) 우리 핸들러만 뗀다.
 else{if(previewMoveEnd)map.off('moveend',previewMoveEnd);previewMoveEnd=()=>followView(map,provider,points,missing);map.on('moveend',previewMoveEnd)}
 const label=providerLabel(value)+' · '+points.length+'곳 표시 · 손가락으로 이동하고 확대할 수 있어요'+(missing.length?' · 위치 확인 필요 '+missing.length+'곳':'');container.setAttribute('aria-label',label);button.title=providerLabel(value);button.textContent=candidateMode?'후보 전체 지도':'전체 동선';
 }
 // 사용자가 지도를 만진 뒤에는 백그라운드 동기화·재렌더가 지도 위치를 되돌리지 않는다.
 const markMoved=()=>{userMoved=true};
 container.addEventListener('pointerdown',markMoved,{passive:true});
 container.addEventListener('touchstart',markMoved,{passive:true});
 container.addEventListener('wheel',markMoved,{passive:true});
 // 같은 일차 탭을 한 번 더 누르면 그날 전체가 보이도록 명시적으로 다시 맞춘다.
 document.getElementById('dateTabs')?.addEventListener('click',event=>{const tab=event.target&&event.target.closest?event.target.closest('[data-i]'):null;if(!tab)return;const index=Number(tab.dataset.i);if(index===lastTabDay){frameMode='bounds';userMoved=false;signature='';visibility()}lastTabDay=index});
 button.onclick=()=>setView('map');new MutationObserver(visibility).observe(document.getElementById('timeline'),{childList:true});
 // 모두 화면 밖일 때는 안내를 눌러 그날 전체로 바로 돌아올 수 있게 한다.
 const refitDay=(mode='bounds')=>{frameMode=mode;userMoved=false;signature='';visibility()};
 if(note){note.addEventListener('click',()=>{if(note.dataset.refit)refitDay()});note.addEventListener('keydown',event=>{if(note.dataset.refit&&(event.key==='Enter'||event.key===' ')){event.preventDefault();refitDay()}})}
 // Google 지도 키·한도 문제로 구글 지도가 깨지면(구글 오류 문구) OSM 지도로 다시 만든다.
 window.addEventListener('viago:google-failed',()=>{try{viagoDetachMarkers('preview')}catch(e){}objects=[];if(layer){try{layer.remove()}catch(e){}layer=null}value=undefined;signature='';fitContext='';visibility()});
 // 온라인·오프라인 전환 즉시 안내 문구를 바꿔 준다.
 const repaint=()=>{if(lastPaint)paintView(lastPaint.points,lastPaint.missing,lastPaint.w,lastPaint.h,lastPaint.zoom,lastPaint.lat,lastPaint.lng)};
 window.addEventListener('online',()=>{repaint();signature='';visibility()});window.addEventListener('offline',repaint);
 // 동기화(또는 오프라인 보관)가 화면 렌더보다 늦게 끝나면 그때 한 번 지도를 그린다.
 // (이 보완이 없으면 오프라인으로 처음 열 때 지도 영역이 비어 있었다)
 let readyWatch=setInterval(()=>{try{if(typeof sharedReady!=='undefined'&&sharedReady){clearInterval(readyWatch);readyWatch=0;signature='';visibility()}}catch(e){clearInterval(readyWatch);readyWatch=0}},400);
 setTimeout(()=>{if(readyWatch){clearInterval(readyWatch);readyWatch=0}},30000);

 /* ===== 2026-11-16 시안 C: 지도 기본값(⌂) · 길게 눌러 저장 · ＋/－ =====
    저장 위치는 여행 문서의 선택 필드다 — mapView(여행 공통), dayMapViews(일차별).
    기존 payload 동기화(3-way 병합)·Firestore 보안 규칙·반지 앱과 같은 문서 형식을 그대로 쓰고,
    오프라인·첫 렌더를 위해 localStorage 에 사본을 둔다(journey-note-map-views-<tripId>).
    Google 지도 API 추가 호출은 없다(중심·배율과 저장된 좌표만 사용). */
 function cleanView(v){
  if(!v||typeof v!=='object')return null;
  const lat=Number(v.lat),lng=Number(v.lng),zoom=Number(v.zoom);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(zoom))return null;
  if(Math.abs(lat)>90||Math.abs(lng)>180||zoom<0||zoom>22)return null;
  return {lat:+lat.toFixed(6),lng:+lng.toFixed(6),zoom:Math.round(zoom*10)/10};
 }
 function previewTripId(){try{return (activeTrip&&activeTrip.id)||''}catch(e){return ''}}
 function readViewMirror(){try{const raw=localStorage.getItem(VIEW_KEY_PREFIX+previewTripId()),data=raw?JSON.parse(raw):null;return data&&typeof data==='object'?data:null}catch(e){return null}}
 function writeViewMirror(store){try{localStorage.setItem(VIEW_KEY_PREFIX+previewTripId(),JSON.stringify(store))}catch(e){}}
 // 여행 문서 필드가 기준이다. 문서에 아직 두 필드가 없을 때(처음 쓰는 기기·사본만 있는 오프라인)만
 // localStorage 사본으로 메운다 — 저장한 값을 문서에서 지운 뒤 사본이 되살리는 일이 없도록.
 function viewStore(){
  const out={common:null,days:{}};
  let hasDocumentFields=false;
  try{
   if(activeTrip){
    hasDocumentFields=Object.prototype.hasOwnProperty.call(activeTrip,'mapView')||Object.prototype.hasOwnProperty.call(activeTrip,'dayMapViews');
    const common=cleanView(activeTrip.mapView);if(common)out.common=common;
    const per=activeTrip.dayMapViews;
    if(per&&typeof per==='object')Object.keys(per).forEach(k=>{const v=cleanView(per[k]);if(v)out.days[String(k)]=v});
   }
  }catch(e){}
  if(hasDocumentFields)return out;
  const mirror=readViewMirror();
  if(mirror){
   if(!out.common)out.common=cleanView(mirror.common);
   const days=mirror.days&&typeof mirror.days==='object'?mirror.days:{};
   Object.keys(days).forEach(k=>{if(!out.days[String(k)]){const v=cleanView(days[k]);if(v)out.days[String(k)]=v}});
  }
  return out;
 }
 // 해당 일차 설정 → 없으면 여행 공통 설정 → 없으면 null(자동 맞춤)
 function daySavedView(index){const s=viewStore();return s.days[String(index)]||s.common||null}
 function anySavedView(){const s=viewStore();return !!(s.common||Object.keys(s.days).length)}
 function currentViewValue(){
  if(!value||!value.map)return null;
  try{
   const map=value.map,z=map.getZoom(),c=map.getCenter(),lat=typeof c.lat==='function'?c.lat():c.lat,lng=typeof c.lng==='function'?c.lng():c.lng;
   return cleanView({lat,lng,zoom:z});
  }catch(e){return null}
 }
 function saveView(scope){
  const v=currentViewValue();if(!v)return false;
  let trip=null;try{trip=activeTrip}catch(e){}
  if(!trip)return false;
  const per=Object.assign({},trip.dayMapViews||{});
  if(scope==='day')per[String(dayIndex)]=v;
  else{
   // 여행 전체 공통: 중심·배율을 함께 저장하고 이 일차에 따로 저장된 값은 지워서
   // 지금 화면(중심+배율)이 그대로 복귀되게 한다. 다른 일차는 자기 중심을 지키고 배율만 함께 맞춘다.
   trip.mapView={lat:v.lat,lng:v.lng,zoom:v.zoom};
   delete per[String(dayIndex)];
   Object.keys(per).forEach(k=>{const e=cleanView(per[k]);if(e)per[k]={lat:e.lat,lng:e.lng,zoom:v.zoom}});
  }
  if(Object.keys(per).length)trip.dayMapViews=per;else delete trip.dayMapViews;
  writeViewMirror(viewStore());
  try{persistTrips()}catch(e){}
  userMoved=true;lastZoom=v.zoom;dismissHint();
  return true;
 }
 function hintKey(){return HINT_KEY_PREFIX+previewTripId()}
 function hintDismissed(){try{return localStorage.getItem(hintKey())==='1'}catch(e){return false}}
 function dismissHint(){try{localStorage.setItem(hintKey(),'1')}catch(e){}if(hintEl)hintEl.hidden=true}
 // 첫 1회 안내: 아직 기본값을 저장한 적이 없고, 사용자가 말풍선을 눌러 닫지 않았을 때만 보인다.
 function paintHint(){if(hintEl)hintEl.hidden=anySavedView()||hintDismissed()}
 function haversineM(a,b,c,d){const R=6371000,r=Math.PI/180,dlat=(c-a)*r,dlng=(d-b)*r,s=Math.sin(dlat/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dlng/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(s)))}
 // 지금 화면의 중심 지역을 저장된 일정 좌표로만 판단한다(역지오코딩·외부 호출 없음).
 function areaLabel(view){
  if(!view)return '지도 중심';
  const list=[];const add=arr=>(arr||[]).forEach(p=>{if(p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng))list.push(p)});
  try{add((days[dayIndex]||{}).places)}catch(e){}
  if(!list.length){try{(days||[]).forEach(d=>add(d.places))}catch(e){}}
  let best=null,bestD=Infinity;
  list.forEach(p=>{const d=haversineM(view.lat,view.lng,p.lat,p.lng);if(d<bestD){bestD=d;best=p}});
  if(best&&bestD<=6000){const name=String(best.name||'').trim();if(name)return (name.length>18?name.slice(0,17)+'…':name)+' 근처'}
  let destination='';try{destination=String((activeTrip&&activeTrip.destination)||'').trim()}catch(e){}
  return destination?destination+' 부근':'지도 중심';
 }
 function zoomLabel(z){return Math.round(Number(z)||0)+'배율'}
 function daySheetLabel(){
  let d={};try{d=(days||[])[dayIndex]||{}}catch(e){}
  const title=String(d.title||'').replace(/요일$/,'').trim();
  return (title?title+' · ':'')+(dayIndex+1)+'일차 지도';
 }
 function openSheet(){
  if(!sheet)return;
  const v=currentViewValue();
  if(sheetDesc)sheetDesc.textContent=v
    ?`지금 화면(${areaLabel(v)} · ${zoomLabel(v.zoom)})을 기본값으로 저장할까요? 저장하면 홈 버튼 한 번으로 이 화면에 돌아옵니다.`
    :'지금 화면을 기본값으로 저장할까요? 저장하면 홈 버튼 한 번으로 이 화면에 돌아옵니다.';
  if(sheetDaySub)sheetDaySub.textContent=daySheetLabel();
  if(sheetTripSub){const n=Math.max(1,(()=>{try{return (days||[]).length}catch(e){return 1}})());sheetTripSub.textContent=(n>1?`1~${n}일차`:`${n}일차`)+' 모두 같은 배율로 열기'}
  sheet.hidden=false;
  try{sheet.querySelector('.mvs-opt')?.focus({preventScroll:true})}catch(e){}
 }
 function closeSheet(){if(sheet)sheet.hidden=true}
 // 홈 버튼 한 번: 저장된 기본 화면으로 즉시 복귀하고, 카메라 가드는 '새 기준'으로 정리한다.
 function applySavedView(view){
  if(!value||!view)return false;
  framingUntil=Date.now()+600;
  zoomIntent=null;zoomBusyUntil=0;
  setMapView(value.map,value.provider,view,true);
  lastZoom=view.zoom;
  const p=lastPaint;if(p)paintView(p.points,p.missing,p.w,p.h,view.zoom,view.lat,view.lng);
  try{const cam=viagoCamera('preview');cam.touchedAt=0;cam.fittedAt=Date.now();cam.context=''}catch(e){}
  return true;
 }
 function goHome(){
  const saved=daySavedView(dayIndex);
  if(saved&&applySavedView(saved)){userMoved=true;return}
  refitDay('bounds');   // 저장된 기본값이 아직 없으면 이 일차 전체 동선으로
 }
 // 확대 애니메이션(약 250ms)이 끝나기 전에 들어온 두 번째 탭은 지도가 무시하므로,
 // 방금 요청한 배율을 기준으로 이어 세고 애니메이션이 끝난 뒤 한 번에 적용한다(연속 탭이 합산된다).
 function zoomCommit(target,delay){
  clearTimeout(zoomApplyTimer);
  const run=()=>{zoomBusyUntil=Date.now()+320;try{value.map.setZoom(target)}catch(e){}};
  if(delay>0)zoomApplyTimer=setTimeout(run,delay);else run();
 }
 function zoomStep(delta){
  if(!value||!value.map)return;
  const z=value.map.getZoom();if(!Number.isFinite(z))return;
  const base=Number.isFinite(zoomIntent)?zoomIntent:z,next=Math.round((base+delta)*10)/10;
  zoomIntent=next;
  clearTimeout(zoomIntentTimer);zoomIntentTimer=setTimeout(()=>{zoomIntent=null},900);
  userMoved=true;
  try{viagoCameraTouch('preview')}catch(e){}
  const wait=zoomBusyUntil-Date.now();
  zoomCommit(next,wait>0?wait+40:0);
 }
 // 짧게 누르기 = 복귀, 500ms 길게 누르기 = 저장 시트. 터치·마우스를 pointer 이벤트 하나로 처리한다.
 let homePressTimer=0,homePressStart=null,longPressFired=false,zoomIntent=null,zoomIntentTimer=0,zoomApplyTimer=0,zoomBusyUntil=0;
 function clearHomePress(){if(homePressTimer){clearTimeout(homePressTimer);homePressTimer=0}homePressStart=null}
 if(homeBtn){
  homeBtn.addEventListener('pointerdown',event=>{
   if(event.pointerType==='mouse'&&event.button!==0)return;
   longPressFired=false;homePressStart={x:event.clientX,y:event.clientY};
   clearTimeout(homePressTimer);
   homePressTimer=setTimeout(()=>{homePressTimer=0;longPressFired=true;openSheet()},500);
  });
  homeBtn.addEventListener('pointermove',event=>{
   if(!homePressStart||!homePressTimer)return;
   if(Math.abs(event.clientX-homePressStart.x)>10||Math.abs(event.clientY-homePressStart.y)>10)clearHomePress();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(name=>homeBtn.addEventListener(name,clearHomePress));
  homeBtn.addEventListener('contextmenu',event=>{event.preventDefault();clearHomePress()});
  homeBtn.addEventListener('click',event=>{event.preventDefault();if(longPressFired){longPressFired=false;return}goHome()});
 }
 if(hintEl){
  hintEl.addEventListener('click',()=>dismissHint());
  hintEl.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();dismissHint()}});
 }
 zoomInBtn?.addEventListener('click',event=>{event.preventDefault();zoomStep(1)});
 zoomOutBtn?.addEventListener('click',event=>{event.preventDefault();zoomStep(-1)});
 if(sheet){
  const saved=(scope)=>{
   const ok=saveView(scope);closeSheet();
   try{toast(ok?(scope==='day'?'이 일차 지도 기본값을 저장했어요':'여행 전체 지도 기본값을 저장했어요'):'지도 화면을 확인한 뒤 다시 눌러주세요')}catch(e){}
  };
  document.getElementById('mapViewSaveDay')?.addEventListener('click',()=>saved('day'));
  document.getElementById('mapViewSaveTrip')?.addEventListener('click',()=>saved('trip'));
  document.getElementById('mapViewCancel')?.addEventListener('click',closeSheet);
  document.getElementById('mapViewDim')?.addEventListener('click',closeSheet);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!sheet.hidden){event.preventDefault();closeSheet()}});
 }
 visibility();
})();



