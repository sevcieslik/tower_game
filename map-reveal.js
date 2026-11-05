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
// Build three independently shaped, nested regions. A different displaced centre
// drives each hint; the target is inside, never marked or used as a visual centre.
// Store the shapes once per image so panning/zooming cannot change the hint.
let revealRegions = null;
function revealBuildRegions(){
  const r=revealCurrent;
  const latMiles=1/69;
  const lonMiles=1/(69.172*Math.max(.15,Math.cos(r.lat*Math.PI/180)));
  const areas=[2500000,700000,180000];
  const N=144;
  const radii=[];
  const regions=[];
  for(let level=0;level<3;level++){
    const nominal=Math.sqrt(areas[level]/Math.PI);
    const seed=revealHash(r.file+":region:"+level);
    const heading=(seed%6283)/1000;
    const detail=((seed>>>8)%6283)/1000;
    const third=((seed>>>16)%6283)/1000;
    const current=[];
    for(let i=0;i<N;i++){
      const angle=i*2*Math.PI/N;
      // Strong first harmonic shifts the polygon's centroid. Higher harmonics
      // create a different silhouette for each level, not scaled copies.
      const factor=1
        +.40*Math.cos(angle-heading)
        +.20*Math.sin(2*angle+detail)
        +.13*Math.cos(4*angle+third)
        +.075*Math.sin(7*angle-heading);
      let distance=nominal*Math.max(.25,factor);
      // Strict containment: every new contour stays inside the preceding one.
      if(level>0)distance=Math.min(distance,radii[level-1][i]*.88);
      current.push(distance);
    }
    radii.push(current);
    const points=current.map((distance,i)=>{
      const angle=i*2*Math.PI/N;
      return [
        r.lng+Math.cos(angle)*distance*lonMiles,
        Math.max(-84,Math.min(84,r.lat+Math.sin(angle)*distance*latMiles))
      ];
    });
    regions.push({points,radius:nominal,latitudeMiles:latMiles,longitudeMiles:lonMiles});
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
