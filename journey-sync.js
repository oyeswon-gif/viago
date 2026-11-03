// Pure three-way merge. Stable IDs let independent additions and edits coexist.
function mergeJourney(base, local, remote, preferRemote=false) {
  const conflicts=[];const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function merge(b,l,r,path) {
    if(eq(l,r))return l;if(eq(l,b))return r;if(eq(r,b))return l;
    if(Array.isArray(l)&&Array.isArray(r)&&Array.isArray(b)&&[...b,...l,...r].every(x=>x&&typeof x==='object'&&x.id)) {
      const bm=new Map(b.map(x=>[x.id,x])),lm=new Map(l.map(x=>[x.id,x])),rm=new Map(r.map(x=>[x.id,x]));
      const reordered=!eq(l.filter(x=>bm.has(x.id)).map(x=>x.id),b.filter(x=>lm.has(x.id)).map(x=>x.id));
      const remoteReordered=!eq(r.filter(x=>bm.has(x.id)).map(x=>x.id),b.filter(x=>rm.has(x.id)).map(x=>x.id));
      if(reordered&&remoteReordered&&!eq(l.map(x=>x.id),r.map(x=>x.id)))conflicts.push(path+' / 순서');
      const order=(reordered&&!preferRemote?[...l,...r,...b]:[...r,...l,...b]).map(x=>x.id),seen=new Set(),out=[];
      for(const id of order){if(seen.has(id))continue;seen.add(id);const value=merge(bm.get(id),lm.get(id),rm.get(id),path+'/'+id);if(value!==undefined)out.push(value)}return out;
    }
    if(b&&l&&r&&!Array.isArray(l)&&!Array.isArray(r)&&typeof b==='object'&&typeof l==='object'&&typeof r==='object') {
      const out={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){if(['__proto__','constructor','prototype'].includes(k))continue;const v=merge(b[k],l[k],r[k],path+'/'+k);if(v!==undefined)out[k]=v}return out;
    }
    conflicts.push(path);return preferRemote?r:l;
  }
  return {payload:merge(base,local,remote,'일정'),conflicts};
}
