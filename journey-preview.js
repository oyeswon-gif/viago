// Google first; free OSM fallback is selected before creating a new map.
// 2026-11-15: 일정 탭 하루 미리보기 — 한 손가락으로 이동(greedy), 일차 전체 일정 맞춤,
// 사용자가 옮긴 지도 위치 유지, 좌표 없는 장소는 '위치 확인 필요'로 안내.
(()=>{
 const preview=document.getElementById('journeyDayPreview'),button=document.getElementById('journeyPreviewOpen'),container=document.getElementById('journeyDayMap'),note=document.getElementById('journeyPreviewNote');
 let value,objects=[],layer,generation=0,signature='',frame,noteFrame=0,userMoved=false,fitContext='',lastTabDay=null,framingUntil=0,lastPaint=null;
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
  let zoom=1;
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
 function applyFrame(map,provider,points,missing){const {w,h}=size();if(w<40||h<40)return false;framingUntil=Date.now()+600;
  const pad=pads(w,h),f=fitView(points,w,h,pad);
  if(provider==='google'){map.setCenter({lat:f.lat,lng:f.lng});map.setZoom(f.zoom);google.maps.event.trigger(map,'resize')}
  else{map.invalidateSize();map.setView([f.lat,f.lng],f.zoom,{animate:false})}
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
 if(!userMoved){
  if(!applyFrame(map,provider,points,missing))setTimeout(()=>{if(run===generation&&!userMoved){applyFrame(map,provider,points,missing);draw()}},220);
  else draw();
 }else draw();
 if(provider==='google'){google.maps.event.clearListeners(map,'idle');google.maps.event.addListener(map,'idle',()=>followView(map,provider,points,missing))}
 else{map.off('moveend');map.on('moveend',()=>followView(map,provider,points,missing))}
 const label=providerLabel(value)+' · '+points.length+'곳 표시 · 손가락으로 이동하고 확대할 수 있어요'+(missing.length?' · 위치 확인 필요 '+missing.length+'곳':'');container.setAttribute('aria-label',label);button.title=providerLabel(value);button.textContent=candidateMode?'후보 전체 지도':'전체 동선';
 }
 // 사용자가 지도를 만진 뒤에는 백그라운드 동기화·재렌더가 지도 위치를 되돌리지 않는다.
 const markMoved=()=>{userMoved=true};
 container.addEventListener('pointerdown',markMoved,{passive:true});
 container.addEventListener('touchstart',markMoved,{passive:true});
 container.addEventListener('wheel',markMoved,{passive:true});
 // 같은 일차 탭을 한 번 더 누르면 그날 전체가 보이도록 명시적으로 다시 맞춘다.
 document.getElementById('dateTabs')?.addEventListener('click',event=>{const tab=event.target&&event.target.closest?event.target.closest('[data-i]'):null;if(!tab)return;const index=Number(tab.dataset.i);if(index===lastTabDay){userMoved=false;signature='';visibility()}lastTabDay=index});
 button.onclick=()=>setView('map');new MutationObserver(visibility).observe(document.getElementById('timeline'),{childList:true});
 // 모두 화면 밖일 때는 안내를 눌러 그날 전체로 바로 돌아올 수 있게 한다.
 const refitDay=()=>{userMoved=false;signature='';visibility()};
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
 visibility();
})();



