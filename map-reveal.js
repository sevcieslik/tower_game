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
  const phase=(revealHash(r.file+":phase:"+revealLevel)%6283)/1000;
  const phase2=(revealHash(r.file+":detail:"+revealLevel)%6283)/1000;
  const bias=(revealHash(r.file+":bias:"+revealLevel)%6283)/1000;
  const points=[];
  for(let i=0;i<96;i++){
    const theta=i*2*Math.PI/96;
    const wave=1+.20*Math.cos(theta-bias)+.11*Math.sin(3*theta+phase)+.07*Math.cos(5*theta+phase2)+.035*Math.sin(8*theta+phase);
    const dist=radius*wave;
    points.push([r.lng+Math.cos(theta)*dist*longitudeMiles,Math.max(-84,Math.min(84,r.lat+Math.sin(theta)*dist*latitudeMiles))]);
  }
  return {points,radius,latitudeMiles,longitudeMiles};
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
