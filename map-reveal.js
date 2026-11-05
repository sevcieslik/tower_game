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
// Independent offset polygons in a local miles coordinate system.
// The target is only a containment constraint, not the polygon centre.
let revealRegions = null;
function revealInside(point,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a[1]>point[1])!==(b[1]>point[1])) &&
       point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function revealBuildRegions(){
  const r=revealCurrent;
  const latMiles=1/69;
  const lonMiles=1/(69.172*Math.max(.15,Math.cos(r.lat*Math.PI/180)));
  const areas=[2500000,700000,180000];
  const regions=[];
  let parent=null;
  for(let level=0;level<3;level++){
    const radius=Math.sqrt(areas[level]/Math.PI);
    const seed=revealHash(r.file+":independent:"+level);
    const direction=(seed%6283)/1000;
    const offset=radius*(level===0?.60:level===1?.42:.35);
    // Every level has its own centre, phase, orientation and silhouette.
    const center=[Math.cos(direction)*offset,Math.sin(direction)*offset];
    const orientation=((seed>>>9)%6283)/1000;
    const p2=((seed>>>17)%6283)/1000;
    const p3=((seed>>>23)%6283)/1000;
    const build=scale=>Array.from({length:128},(_,i)=>{
      const angle=2*Math.PI*i/128;
      const distortion=1+.21*Math.sin(3*angle+p2)+.15*Math.cos(5*angle+p3)+.09*Math.sin(8*angle+orientation);
      const d=radius*scale*distortion;
      return [center[0]+Math.cos(angle)*d,center[1]+Math.sin(angle)*d];
    });
    let scale=1;
    let polygon=build(scale);
    // Ensure the actual location and the entire child shape are inside the parent.
    // Shrink only when needed; the next shape is never a scaled parent contour.
    for(let attempt=0;attempt<50;attempt++){
      if(revealInside([0,0],polygon)&&(!parent||polygon.every(p=>revealInside(p,parent))))break;
      scale*=.96;
      polygon=build(scale);
    }
    // In unlikely pathological cases, centre the shape on an interior position.
    if(!revealInside([0,0],polygon)|| (parent&&!polygon.every(p=>revealInside(p,parent)))){
      const fallbackCenter=[0,0];
      center[0]=fallbackCenter[0];center[1]=fallbackCenter[1];
      scale=.65;
      polygon=build(scale);
      while(parent&&!polygon.every(p=>revealInside(p,parent))&&scale>.01){
        scale*=.9;polygon=build(scale);
      }
    }
    parent=polygon;
    const points=polygon.map(([x,y])=>[r.lng+x*lonMiles,r.lat+y*latMiles]);
    regions.push({points,radius,latitudeMiles:latMiles,longitudeMiles:lonMiles,centroid:[r.lng+center[0]*lonMiles,r.lat+center[1]*latMiles]});
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
  const vertices=region.points.map(p=>map.project(p));
  const centre=map.project([revealCurrent.lng,revealCurrent.lat]);
  const east=map.project([revealCurrent.lng+region.radius*region.longitudeMiles,revealCurrent.lat]);
  const north=map.project([revealCurrent.lng,revealCurrent.lat+region.radius*region.latitudeMiles]);
  const pixelRadius=Math.max(1,Math.min(Math.abs(east.x-centre.x),Math.abs(north.y-centre.y)));
  const feather=Math.max(5,Math.min(28,pixelRadius*.18));
  ctx.save();
  ctx.globalCompositeOperation='destination-out';
  // Blur only the clearing, not the underlying map.
  ctx.filter='blur('+feather+'px)';
  ctx.beginPath();
  vertices.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));
  ctx.closePath();
  ctx.fillStyle='#000';
  ctx.fill();
  ctx.restore();
  // Subtle lime halo along the soft boundary; never draw a precise hard outline.
  ctx.save();
  ctx.beginPath();
  vertices.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));
  ctx.closePath();
  ctx.shadowColor='rgba(125,190,38,.72)';
  ctx.shadowBlur=18;
  ctx.strokeStyle='rgba(119,174,38,.34)';
  ctx.lineWidth=3;
  ctx.filter='blur(7px)';
  ctx.stroke();
  ctx.restore();
}
