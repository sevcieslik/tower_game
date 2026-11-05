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
  Object.assign(controls.style,{position:'absolute',bottom:'16px',left:'12px',zIndex:'8',display:'none',alignItems:'center',gap:'9px',flexWrap:'wrap'});
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
  const ctx=revealCtx;ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='rgba(5,13,26,.80)';ctx.fillRect(0,0,w,h);
  const r=revealCurrent,seed=revealHash(r.file);
  // Elliptical irregular clearing area. The true location is deliberately off-centre.
  // Level 3 ellipse is approximately 200 square miles (area, not radius).
  const areas=[0,180000,9000,200];
  const radiusMiles=Math.sqrt(areas[revealLevel]/Math.PI);
  const latRad=r.lat*Math.PI/180;
  const mileLat=1/69.0,mileLng=1/(69.172*Math.max(.15,Math.cos(latRad)));
  const skew=.78+((seed%31)/100);
  const angle=(seed%360)*Math.PI/180;
  const offsetX=((seed%13)-6)/15,offsetY=(((seed>>>5)%13)-6)/15;
  const cx=r.lng+offsetX*radiusMiles*mileLng*.48;
  const cy=r.lat+offsetY*radiusMiles*mileLat*.48;
  const origin=map.project([cx,cy]);
  const edge=map.project([cx+radiusMiles*mileLng,cy]);
  const north=map.project([cx,cy+radiusMiles*mileLat]);
  const rx=Math.max(2,Math.abs(edge.x-origin.x)*skew),ry=Math.max(2,Math.abs(north.y-origin.y)/skew);
  ctx.save();ctx.globalCompositeOperation='destination-out';
  ctx.translate(origin.x,origin.y);ctx.rotate(angle);
  // Soft, asymmetric boundary, with no hard edge and no target pin.
  for(let i=0;i<9;i++){
    const a=i*Math.PI*2/9,variation=.83+((revealHash(r.file+':'+i)%35)/100);
    const px=Math.cos(a)*rx*.36*variation,py=Math.sin(a)*ry*.36*variation;
    const rad=Math.max(1,Math.min(rx,ry)*.76);
    ctx.save();ctx.translate(px,py);ctx.scale(Math.max(.1,rx/Math.max(1,ry)),1);
    const g=ctx.createRadialGradient(0,0,rad*.35,0,0,rad);
    g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.55,'rgba(0,0,0,.95)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,rad,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  ctx.restore();
}
