// Google first; free OSM fallback is selected before creating a new map.
// 2026-11-15: 일정 탭 하루 미리보기 — 크게, 밀집 지역 중심, 터치·확대 허용, 화면 밖 장소 안내.
(()=>{
 const preview=document.getElementById('journeyDayPreview'),button=document.getElementById('journeyPreviewOpen'),container=document.getElementById('journeyDayMap'),note=document.getElementById('journeyPreviewNote');
 let value,objects=[],layer,generation=0,signature='',frame,noteFrame=0;
 const ZOOM_MAX=17,FIT_MAX=15,CORE_M=4000;
 function visibility(){const entries=overviewEntries();preview.hidden=foodMode||!entries.length;if(preview.hidden||!sharedReady)return;const next=JSON.stringify([activeTrip.id,candidateMode,dayIndex,entries.map(x=>[x.p.id,x.p.name,x.c,x.label])]);if(next===signature)return;signature=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update().catch(()=>{signature='';container.textContent='지도를 연결하지 못했어요. Google 지도에서 길찾기는 계속 사용할 수 있어요.'}))}
 function project(point,zoom){const size=256*Math.pow(2,zoom),rad=point[0]*Math.PI/180;return [(point[1]+180)/360*size,(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*size]}
 function size(){return {w:container.clientWidth,h:container.clientHeight}}
 function fitZoom(points,w,h,pad){for(let zoom=FIT_MAX;zoom>=1;zoom--){const px=points.map(x=>project(x.c,zoom));const dx=Math.max(...px.map(q=>q[0]))-Math.min(...px.map(q=>q[0])),dy=Math.max(...px.map(q=>q[1]))-Math.min(...px.map(q=>q[1]));if(dx<=w-2*pad&&dy<=h-2*pad)return zoom}return 1}
 // 하루 전체가 아니라 '한 지역'이 보이도록, 가운데서 4km 넘게 떨어진 장소(공항·다른 도시)는 범위에서 뺀다.
 function denseCore(points,limit=CORE_M){if(points.length<3)return points;let best=null,bestScore=-1;points.forEach((seed,si)=>{const cos=Math.cos(seed.c[0]*Math.PI/180),members=points.filter((x,xi)=>{const dy=(x.c[0]-seed.c[0])*111320,dx=(x.c[1]-seed.c[1])*111320*cos;return Math.sqrt(dx*dx+dy*dy)<=limit});const score=members.length*100+members.reduce((s,x)=>s+points.indexOf(x),0)/points.length+(si/points.length)*0.5;if(score>bestScore){bestScore=score;best=members}});return best&&best.length>=2?best:points}
 function noteText(points,w,h,zoom,lat,lng){if(!points.length)return '';const center=project([lat,lng],zoom),outside=points.filter(x=>{const p=project(x.c,zoom);return Math.abs(p[0]-center[0])>w/2-8||Math.abs(p[1]-center[1])>h/2-8});if(!outside.length)return '';const names=outside.slice(0,2).map(x=>x.p.name).join(', ');return `화면 밖 ${outside.length}곳${names?' · '+names+(outside.length>2?' 외':''):''}`}
 function paintNote(text){if(!note)return;note.textContent=text||'';note.hidden=!text;note.title=text?text+' · 전체 동선에서 확인':''}
 function frameOf(points,w,h){const core=denseCore(points);let zoom=fitZoom(core,w,h,12);if(new Set(core.map(x=>x.c[0].toFixed(6)+','+x.c[1].toFixed(6))).size===1)zoom=Math.max(zoom,16);const lat=(Math.min(...core.map(x=>x.c[0]))+Math.max(...core.map(x=>x.c[0])))/2,lng=(Math.min(...core.map(x=>x.c[1]))+Math.max(...core.map(x=>x.c[1])))/2;return {zoom,lat,lng,w,h}}
 function applyFrame(map,provider,points){const {w,h}=size();if(w<40||h<40)return false;if(!points.length){if(provider==='google'){map.setCenter({lat:35.1709,lng:136.9065});map.setZoom(13);google.maps.event.trigger(map,'resize')}else map.setView([35.1709,136.9065],13);paintNote('');return true}
  const f=frameOf(points,w,h);if(provider==='google'){map.setCenter({lat:f.lat,lng:f.lng});map.setZoom(f.zoom);google.maps.event.trigger(map,'resize')}else map.setView([f.lat,f.lng],f.zoom);
  paintNote(noteText(points,w,h,f.zoom,f.lat,f.lng));return true}
 // 사용자가 지도를 움직인 뒤에도 '화면 밖' 안내가 실제 화면과 맞도록 다시 계산한다.
 function followView(map,provider,points){cancelAnimationFrame(noteFrame);noteFrame=requestAnimationFrame(()=>{const {w,h}=size();if(w<40||h<40)return;let zoom,center;try{zoom=map.getZoom();center=map.getCenter();center=[center.lat(),center.lng()]}catch{return}if(!Number.isFinite(zoom)||!center)return;paintNote(noteText(points,w,h,zoom,center[0],center[1]))})}
 function enableGestures(map,provider){if(provider==='google'){try{map.setOptions({gestureHandling:'cooperative',disableDefaultUI:true,zoomControl:false,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,clickableIcons:false,keyboardShortcuts:false})}catch{}}else{try{map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable()}catch{}}}
 async function update(){const run=++generation;value=await createTravelMap('journeyDayMap',{center:{lat:35.1709,lng:136.9065},zoom:13,disableDefaultUI:true,gestureHandling:'cooperative',clickableIcons:false,zoomControl:false,streetViewControl:false,mapTypeControl:false,fullscreenControl:false,keyboardShortcuts:false});if(run!==generation)return;const {map,provider}=value,points=overviewEntries().filter(x=>x.c),color=candidateMode?'#8764df':'#3187ff';
 enableGestures(map,provider);
 if(provider==='google'){objects.forEach(x=>x.setMap(null));objects=[]}
 else{layer?.remove();layer=L.layerGroup().addTo(map)}
 viagoDrawLocated('preview',map,provider,points,color,{connect:!candidateMode,labels:false,holder:provider==='google'?objects:layer,compact:true,zoomMax:ZOOM_MAX});
 if(!applyFrame(map,provider,points))setTimeout(()=>{if(run===generation)applyFrame(map,provider,points)},220);
 if(provider==='google'){google.maps.event.clearListeners(map,'idle');google.maps.event.addListener(map,'idle',()=>followView(map,provider,points))}
 else{map.off('moveend');map.on('moveend',()=>followView(map,provider,points))}
 container.setAttribute('aria-label',providerLabel(value)+' · '+points.length+'곳 표시 · 손가락으로 이동하고 확대할 수 있어요');button.title=providerLabel(value);button.textContent=candidateMode?'후보 전체 지도':'전체 동선';
 }
 button.onclick=()=>setView('map');new MutationObserver(visibility).observe(document.getElementById('timeline'),{childList:true});visibility();
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
