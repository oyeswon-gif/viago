// Google first; free OSM fallback is selected before creating a new map.
(()=>{
 const preview=document.getElementById('journeyDayPreview'),button=document.getElementById('journeyPreviewOpen'),container=document.getElementById('journeyDayMap');
 let value,objects=[],layer,generation=0,signature='',frame;
 function visibility(){const entries=overviewEntries();preview.hidden=foodMode||!entries.length;if(preview.hidden||!sharedReady)return;const next=JSON.stringify([activeTrip.id,candidateMode,dayIndex,entries.map(x=>[x.p.id,x.p.name,x.c,x.label])]);if(next===signature)return;signature=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update().catch(()=>{signature='';container.textContent='지도를 연결하지 못했어요. Google 지도에서 길찾기는 계속 사용할 수 있어요.'}))}
 async function update(){const run=++generation;value=await createTravelMap('journeyDayMap',{center:{lat:35.1709,lng:136.9065},zoom:13,disableDefaultUI:true,gestureHandling:'none',clickableIcons:false});if(run!==generation)return;const {map,provider}=value,points=overviewEntries().filter(x=>x.c),color=candidateMode?'#8764df':'#3187ff';
 if(provider==='google'){objects.forEach(x=>x.setMap(null));objects=[];const bounds=new google.maps.LatLngBounds();points.forEach(({p,c,label})=>{const position={lat:c[0],lng:c[1]};bounds.extend(position);objects.push(new google.maps.Marker({map,position,title:p.name,label:{text:String(label),color:'#fff'},icon:{path:google.maps.SymbolPath.CIRCLE,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:2,scale:13}}))});if(!candidateMode&&points.length>1)objects.push(new google.maps.Polyline({map,path:points.map(x=>({lat:x.c[0],lng:x.c[1]})),strokeColor:color,strokeWeight:3}));if(points.length===1){map.setCenter({lat:points[0].c[0],lng:points[0].c[1]});map.setZoom(14)}else if(points.length)map.fitBounds(bounds,24)}
 else{layer?.remove();layer=L.layerGroup().addTo(map);points.forEach(({c,label})=>L.marker(c,{icon:markerIcon(label,color)}).addTo(layer));if(!candidateMode&&points.length>1)L.polyline(points.map(x=>x.c),{color,weight:3,dashArray:'6 6'}).addTo(layer);map.invalidateSize();if(points.length===1)map.setView(points[0].c,14);else if(points.length)map.fitBounds(points.map(x=>x.c),{padding:[20,20],maxZoom:15});else map.setView([35.17,136.9],12)}
 container.setAttribute('aria-label',providerLabel(value)+' · '+points.length+'곳 표시');button.title=providerLabel(value);button.textContent=candidateMode?'후보 전체 지도':'전체 동선';
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
