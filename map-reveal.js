/* Map Reveal: soft-edged geographic fog. No external services required. */
const REVEAL_COST_MI = 200;
let revealLevel = 0;
let revealCanvas = null;
let revealCtx = null;
let revealResizeObserver = null;
let revealCurrent = null;
let revealPenaltiesKm = 0;
const revealMilesToKm = miles => miles * 1.609344;
function revealHash(s){ let h=2166136261; for(const c of s){h=Math.imul(h^c.charCodeAt(0),16777619)}return h>>>0; }
function revealSetup(){
  const panel=document.querySelector('.map-panel');
  if(!panel || revealCanvas)return;
  revealCanvas=document.createElement('canvas');
  revealCanvas.id='revealFog';
  Object.assign(revealCanvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'4',display:'none'});
  panel.appendChild(revealCanvas);
  const controls=document.createElement('div');
  controls.id='revealControls';
  controls.innerHTML='<button id="revealButton" type="button">Reveal map · +200 mi</button><span id="revealStatus">0/3 hints · +0 mi</span>';
  Object.assign(controls.style,{position:'absolute',bottom:'34px',left:'12px',zIndex:'8',display:'none',alignItems:'center',gap:'9px',flexWrap:'wrap'});
  panel.appendChild(controls);
  const btn=document.getElementById('revealButton');
  Object.assign(btn.style,{background:'#8dc63f',color:'#091323',border:'0',borderRadius:'8px',padding:'12px 15px',fontWeight:'800',cursor:'pointer'});
  document.getElementById('revealStatus').style.cssText='background:rgba(2,6,23,.88);color:white;padding:8px 10px;border-radius:6px;font-size:13px';
  btn.addEventListener('click',revealBuy);
  revealCtx=revealCanvas.getContext('2d');
  map.on('move',revealDraw);
  map.on('resize',revealDraw);
  if(window.ResizeObserver){revealResizeObserver=new ResizeObserver(revealDraw);revealResizeObserver.observe(panel);}
}
function revealBegin(r){
  revealSetup();
  revealCurrent=r;
  revealRegions=null;
  revealLevel=0;
  revealPenaltiesKm=0;
  document.getElementById('revealControls').style.display='flex';
  revealCanvas.style.display='none';
  revealUpdate();
}
function revealHide(){
  if(revealCanvas)revealCanvas.style.display='none';
  const controls=document.getElementById('revealControls');
  if(controls)controls.style.display='none';
}
function revealUpdate(){
  const b=document.getElementById('revealButton');
  const status=document.getElementById('revealStatus');
  if(!b||!status)return;
  b.disabled=revealLevel>=3||!active;
  b.style.opacity=b.disabled?'.5':'1';
  b.textContent=revealLevel>=3?'All hints used':'Reveal map · +200 mi';
  status.textContent=revealLevel+'/3 hints · +'+(revealLevel*REVEAL_COST_MI)+' mi';
}
// Geographic hints are intersections of independently generated shapes.
// Each successive mask has a different centre and silhouette, not a smaller
// version of the previous one. Areas are calibrated in a local miles plane.
let revealRegions=null;
function revealInside(point,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>point[1])!==(b[1]>point[1]))
      if(point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function revealArea(poly){
  let sum=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    sum+=a[0]*b[1]-b[0]*a[1];
  }
  return Math.abs(sum)/2;
}
function revealShape(level,scale){
  const r=revealCurrent;
  const seed=revealHash(r.file+":intersection:"+level);
  const angle=(seed%6283)/1000;
  const nominal=[Math.sqrt(2500000/Math.PI),Math.sqrt(700000/Math.PI),Math.sqrt(180000/Math.PI)][level];
  // Independent centres. The true position is offset from each geometric centre.
  const offset=[.50,.48,.44][level]*nominal;
  const cx=Math.cos(angle)*offset,cy=Math.sin(angle)*offset;
  const phase=((seed>>>9)%6283)/1000,phase2=((seed>>>19)%6283)/1000;
  return Array.from({length:96},(_,i)=>{
    const t=i*Math.PI*2/96;
    const variation=1+.19*Math.sin(3*t+phase)+.12*Math.cos(5*t+phase2)+.07*Math.sin(8*t+angle);
    const distance=nominal*scale*variation;
    return [cx+Math.cos(t)*distance,cy+Math.sin(t)*distance];
  });
}
function revealIntersectionArea(polys,extent,steps){
  // Deterministic grid integration of the *actual intersection*.
  const min=-extent,max=extent,step=(max-min)/steps;
  let count=0;
  for(let iy=0;iy<steps;iy++){
    const y=min+(iy+.5)*step;
    for(let ix=0;ix<steps;ix++){
      const p=[min+(ix+.5)*step,y];
      if(polys.every(poly=>revealInside(p,poly)))count++;
    }
  }
  return count*step*step;
}
function revealBuildRegions(){
  const r=revealCurrent;
  const latMiles=1/69;
  const lonMiles=1/(69.172*Math.max(.15,Math.cos(r.lat*Math.PI/180)));
  const targets=[2500000,700000,180000];
  const extent=1500;
  const polys=[];
  const regions=[];
  for(let level=0;level<3;level++){
    // Binary search the independent polygon size to hit the intersection
    // area, rather than shrinking it until it happens to fit the parent.
    let low=.01,high=8;
    for(let iteration=0;iteration<18;iteration++){
      const mid=(low+high)/2;
      const candidate=revealShape(level,mid);
      const area=level===0?revealArea(candidate):
        revealIntersectionArea([...polys,candidate],extent,90);
      if(area<targets[level])low=mid;
      else high=mid;
    }
    const polygon=revealShape(level,(low+high)/2);
    polys.push(polygon);
    const points=polygon.map(([x,y])=>[r.lng+x*lonMiles,r.lat+y*latMiles]);
    regions.push({points,polys:polys.slice(),latitudeMiles:latMiles,longitudeMiles:lonMiles});
  }
  return regions;
}
function revealRegion(){
  if(!revealRegions)revealRegions=revealBuildRegions();
  return revealRegions[revealLevel-1];
}
function revealBuy(){
  if(!active||!revealCurrent||revealLevel>=3)return;
  revealLevel++;
  revealPenaltiesKm+=revealMilesToKm(REVEAL_COST_MI);
  revealCanvas.style.display='block';
  revealUpdate();
  revealDraw();
}
function revealDraw(){
  if(!revealCanvas||!revealCurrent||!revealLevel||!map)return;
  const rect=revealCanvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  if(!w||!h)return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  revealCanvas.width=Math.round(w*dpr);revealCanvas.height=Math.round(h*dpr);
  const ctx=revealCtx;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  // The rest of the map remains readable through a lighter fog.
  ctx.fillStyle='rgba(130,143,151,.35)';
  ctx.fillRect(0,0,w,h);
  const region=revealRegion();
  // Reveal only the intersection of all purchased hint shapes.
  // A soft mask is drawn offscreen, then blurred once at the final boundary.
  const mask=document.createElement('canvas');
  mask.width=revealCanvas.width;mask.height=revealCanvas.height;
  const m=mask.getContext('2d');
  m.setTransform(dpr,0,0,dpr,0,0);
  m.fillStyle='#fff';
  region.polys.forEach((poly,i)=>{
    const projected=poly.map(([x,y])=>map.project([
      revealCurrent.lng+x*region.longitudeMiles,
      revealCurrent.lat+y*region.latitudeMiles
    ]));
    m.beginPath();
    projected.forEach((v,j)=>j?m.lineTo(v.x,v.y):m.moveTo(v.x,v.y));
    m.closePath();
    if(i===0)m.clip();
    else m.clip();
  });
  m.fillRect(0,0,w,h);
  ctx.save();
  ctx.globalCompositeOperation='destination-out';
  ctx.filter='blur(15px)';
  ctx.drawImage(mask,0,0,w,h);
  ctx.restore();
  // A faint glow follows the outer contours; no target marker is drawn.
  ctx.save();
  ctx.filter='blur(10px)';
  ctx.strokeStyle='rgba(135,195,48,.22)';
  ctx.lineWidth=3;
  for(const poly of region.polys){
    ctx.beginPath();
    poly.forEach(([x,y],i)=>{
      const p=map.project([revealCurrent.lng+x*region.longitudeMiles,revealCurrent.lat+y*region.latitudeMiles]);
      i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);
    });
    ctx.closePath();ctx.stroke();
  }
  ctx.restore();
}
