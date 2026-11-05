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
// The clearing is a deterministic irregular region, never a circle centred on the target.
function revealRegion(){
  const r=revealCurrent,seed=revealHash(r.file);
  const areas=[0,2500000,700000,180000];
  const radius=Math.sqrt(areas[revealLevel]/Math.PI);
  const latitudeMiles=1/69,longitudeMiles=1/(69.172*Math.max(.15,Math.cos(r.lat*Math.PI/180)));
  const angle=(seed%360)*Math.PI/180;
  // Keep the actual point well inside the region without placing it at the centre.
  const offsetX=(((seed>>>3)%17)-8)/32;
  const offsetY=(((seed>>>9)%17)-8)/32;
  const center=[r.lng+offsetX*radius*longitudeMiles,r.lat+offsetY*radius*latitudeMiles];
  const points=[];
  for(let i=0;i<24;i++){
    const theta=i*Math.PI*2/24;
    const wave=1+.13*Math.sin(3*theta+angle)+.09*Math.sin(5*theta-angle*.7)+.05*Math.cos(7*theta+angle);
    const x=Math.cos(theta)*radius*wave,y=Math.sin(theta)*radius*wave;
    points.push([center[0]+x*longitudeMiles,center[1]+y*latitudeMiles]);
  }
  return {center,points,radius,latitudeMiles,longitudeMiles};
}
function revealBuy(){
  if(!active||!revealCurrent||revealLevel>=3)return;
  revealLevel++;
  revealPenaltiesKm+=revealMilesToKm(REVEAL_COST_MI);
  revealCanvas.style.display='block';
  revealUpdate();
  const region=revealRegion();
  // Keep a consistent geographic view so successive hints genuinely narrow the region.
  // Do not automatically zoom to the smaller region.
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
  ctx.fillStyle='rgba(5,13,26,.59)';
  ctx.fillRect(0,0,w,h);
  const region=revealRegion();
  const vertices=region.points.map(p=>map.project(p));
  const centre=map.project(region.center);
  const east=map.project([region.center[0]+region.radius*region.longitudeMiles,region.center[1]]);
  const north=map.project([region.center[0],region.center[1]+region.radius*region.latitudeMiles]);
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
  ctx.shadowColor='rgba(174,226,87,.8)';
  ctx.shadowBlur=18;
  ctx.strokeStyle='rgba(176,221,105,.26)';
  ctx.lineWidth=3;
  ctx.filter='blur(7px)';
  ctx.stroke();
  ctx.restore();
}
