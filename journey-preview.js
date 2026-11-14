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


// GitHub Pages has no server-side exchange route. Keep the existing UI and cache.
(()=>{
  if(typeof loadExchange!=='function')return;
    let exchangeRetryAt=0;
    function hasExchangeRates(rates){return Object.keys(currencyMeta).every(code=>Number.isFinite(rates?.[code])&&rates[code]>0)}
    loadExchange=async function(force=false){
      if(exchangeLoading||(!force&&document.hidden))return;
      const now=Date.now(),hasRates=hasExchangeRates(exchangeData?.rates);
      if(hasRates)renderExchange();
      if(!force&&hasRates&&now-exchangeData.fetchedAt<3600000)return;
      if(now<exchangeRetryAt){if(force)toast('잠시 후 환율을 다시 확인해주세요');return}
      exchangeLoading=true;
      renderExchange();
      $('#exchangeState').textContent='환율 확인 중';
      $('#exchangeState').className='exchange-state stale';
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
      try{
        const response=await fetch('https://open.er-api.com/v6/latest/USD',{signal:controller.signal});
        if(response.status===429)exchangeRetryAt=Date.now()+3600000;
        if(!response.ok)throw new Error('exchange_failed');
        const data=await response.json(),updatedAt=Date.parse(data.time_last_update_utc);
        if(data.result!=='success'||data.base_code!=='USD'||!hasExchangeRates(data.rates)||!Number.isFinite(updatedAt))throw new Error('invalid_exchange_data');
        const rates=Object.fromEntries(Object.keys(currencyMeta).map(code=>[code,data.rates[code]]));
        exchangeData={rates,updatedAt:new Date(updatedAt).toISOString(),fetchedAt:Date.now(),source:'ExchangeRate-API'};
        try{localStorage.setItem(EXCHANGE_CACHE_KEY,JSON.stringify(exchangeData))}catch{}
      }catch{
        exchangeRetryAt=Math.max(exchangeRetryAt,Date.now()+60000);
        if(!exchangeData)toast('환율을 불러오지 못했어요');else toast('저장된 최근 환율을 보여드려요');
      }finally{clearTimeout(timer);exchangeLoading=false;renderExchange();if(!hasExchangeRates(exchangeData?.rates))$('#exchangeState').textContent='환율 조회 불가'}
    };
})();

// GitHub Pages is static: look up public link metadata and places without a paid API.
(()=>{
  if(typeof analyzeTravelLink!=='function'||typeof apiFetch!=='function')return;
  const originalApiFetch=apiFetch,placeCache=new Map();
  const labels=host=>/(^|\.)threads\.(com|net)$/.test(host)?'Threads':/(^|\.)instagram\.com$/.test(host)?'Instagram':/(^|\.)naver\.com$/.test(host)?'Naver':/(^|\.)youtube\.com$|^youtu\.be$/.test(host)?'YouTube':'웹 게시물';
  function publicUrl(value){try{const u=new URL(value);if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.port||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(u.hostname)||!u.hostname.includes('.'))return null;return u}catch{return null}}
  function candidateName(description,context){
    const text=(description||'').replace(/\r/g,'\n'),lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
    const quoted=[...text.matchAll(/[“「『]([^”」』\n]{2,60})[”」』]/g)].map(m=>m[1].trim()).filter(x=>!/[.!?。！]/.test(x));
    const japanese=lines.filter(x=>x.length>=3&&x.length<=55&&/[ぁ-んァ-ヶ]/.test(x)&&!/[。！？]/.test(x)).map(x=>x.replace(/^[^\p{L}\p{N}]+/u,'').trim());
    const english=lines.filter(x=>x.length>=4&&x.length<=55&&/^[A-Za-z][A-Za-z0-9 &.'’\-]+$/.test(x)&&!/^(instagram|threads|youtube)$/i.test(x));
    const marked=lines.filter(x=>/^(📍|🏠|店名|가게명|상호명)/.test(x)).map(x=>x.replace(/^(📍|🏠|店名|가게명|상호명)\s*[:：]?\s*/,'').trim()).filter(x=>x.length>=2&&x.length<=60);
    const manual=(context||'').trim();return japanese.at(-1)||marked[0]||quoted[0]||english.at(-1)||(manual.length>=2&&manual.length<=80?manual:'');
  }
  async function freePlaces(q,country,lat,lng,signal){
    const key=JSON.stringify([q,country,lat,lng]),cached=placeCache.get(key);if(cached&&Date.now()-cached.at<3600000)return cached.places;
    const params=new URLSearchParams({q,limit:'6',lang:'en'});if(/^[a-z]{2}$/i.test(country||''))params.set('countrycode',country.toUpperCase());if(Number.isFinite(lat)&&Number.isFinite(lng)){params.set('lat',String(lat));params.set('lon',String(lng))}
    const res=await fetch('https://photon.komoot.io/api/?'+params,{signal});if(!res.ok)throw Error('place_unavailable');const json=await res.json();
    const places=(json.features||[]).map(f=>{const p=f.properties||{},c=f.geometry?.coordinates||[];return{name:String(p.name||p.street||'').slice(0,180),address:[p.housenumber,p.street,p.city,p.state,p.country].filter(Boolean).join(', ').slice(0,400),placeId:'osm:'+String(p.osm_type||'')+String(p.osm_id||''),lat:c[1],lng:c[0],kind:'장소',source:'osm'}}).filter(p=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180);placeCache.set(key,{at:Date.now(),places});return places
  }
  apiFetch=function(url,options={}){const parsed=new URL(url,location.href);if(parsed.origin===location.origin&&parsed.pathname==='/api/place-search'){
    const p=parsed.searchParams;if(p.get('mode')!=='free'&&p.get('mode')!=='text')return Promise.resolve(Response.json({suggestions:[]}));
    const q=(p.get('q')||'').trim(),num=k=>p.has(k)?Number(p.get(k)):undefined;if(q.length<2)return Promise.resolve(Response.json({suggestions:[]}));
    return freePlaces(q,p.get('country')||'',num('lat'),num('lng'),options.signal).then(places=>Response.json({suggestions:places,place:places[0]||null,source:'osm'})).catch(()=>Response.json({error:'search_unavailable',suggestions:[]},{status:503}))
  }return originalApiFetch(url,options)};
  analyzeTravelLink=async function(){
    const raw=$('#travelLink').value.trim(),sourceUrl=publicUrl(raw);if(!sourceUrl){$('#linkResult').className='link-result open';$('#linkResult').textContent='https://로 시작하는 공개 게시물 링크를 입력해주세요.';return}
    const context=$('#linkContext').value.trim(),result=$('#linkResult');$('#linkAnalyze').disabled=true;$('#linkAnalyze').textContent='분석 중';result.className='link-result open';result.innerHTML='<div class="link-loading">공개 게시물의 설명에서 장소를 찾고 있어요…</div>';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);let metadata=null,blocked=false;
    try{const endpoint='https://api.microlink.io/?'+new URLSearchParams({url:sourceUrl.href});const response=await fetch(endpoint,{signal:controller.signal});const data=await response.json();if(!response.ok||data.status!=='success'||!data.data)throw Error('metadata_unavailable');metadata=data.data}catch{blocked=true}finally{clearTimeout(timer)}
    const name=candidateName(metadata?.description||'',context),finalUrl=publicUrl(metadata?.url||'')||sourceUrl,image=publicUrl(metadata?.image?.url||'');
    const source={url:sourceUrl.href,finalUrl:finalUrl.href,platform:labels(sourceUrl.hostname),title:String(metadata?.title||'공개 게시물').slice(0,180),description:String(metadata?.description||'').slice(0,1500),image:image?.href||''};
    let places=[];if(name){try{const center=days.flatMap(d=>d.places).filter(p=>p.kind!=='항공').map(coordsFor).find(Boolean),signal=AbortSignal.timeout(7000),found=await freePlaces(name,destinationCountry()||'',center?.[0],center?.[1],signal);const norm=x=>String(x).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');places=found.filter(p=>norm(p.name).includes(norm(name))||norm(name).includes(norm(p.name)))}catch{}if(!places.length)places=[{name,address:'',placeId:'',kind:'게시물에서 추출 · 지점 확인 필요',source:'post'}]}
    linkAnalysis={ok:true,source,places,query:name,reason:blocked&&!name?'blocked':!name?'lookup_error':'',needsPlaceConfirmation:true};linkPlaceSelection=null;renderLinkAnalysis();
    if(name){const note=document.createElement('p');note.className='link-help';note.textContent='게시물에서 찾은 이름입니다. Google 지도에서 지점과 주소를 확인한 뒤 선택해 저장해주세요.';const verify=document.createElement('a');verify.className='link-direct-search';verify.textContent='Google 지도에서 장소 확인';verify.href='https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:name+' '+activeTrip.destination});verify.target='_blank';verify.rel='noopener noreferrer';result.append(note,verify)}
    if(blocked&&!name){const note=document.createElement('p');note.className='link-help';note.textContent='게시물을 공개로 열 수 없어요. 원문에서 가게 이름을 복사해 위의 입력란에 넣고 다시 분석하거나 직접 검색해주세요.';result.append(note)}
    $('#linkAnalyze').disabled=false;$('#linkAnalyze').textContent='다시 분석';
  };
})();
