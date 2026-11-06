/* Map Reveal: soft-edged geographic fog. No external services required. */
const REVEAL_COST_MI = 200;
let revealLevel = 0;
let revealCanvas = null;
let revealCtx = null;
let revealResizeObserver = null;
let revealCurrent = null;
let revealPenaltiesKm = 0;
let revealMuted = false;
let revealAnimationStart = 0;
let revealAnimationFrame = 0;
let revealAudioContext = null;
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
  const soundButton=document.createElement('button');
  soundButton.id='revealSound';
  soundButton.type='button';
  soundButton.textContent='Sound: On';
  soundButton.setAttribute('aria-label','Toggle reveal sound');
  Object.assign(soundButton.style,{background:'rgba(2,6,23,.88)',color:'#e5e7eb',border:'1px solid rgba(141,198,63,.4)',borderRadius:'8px',padding:'10px 12px',cursor:'pointer',fontSize:'12px'});
  controls.appendChild(soundButton);
  soundButton.addEventListener('click',()=>{
    revealMuted=!revealMuted;
    soundButton.textContent=revealMuted?'Sound: Off':'Sound: On';
  });
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
  cancelAnimationFrame(revealAnimationFrame);
  revealAnimationStart=0;
  revealCurrent=r;
  revealRegions=null;
  revealLevel=0;
  revealPenaltiesKm=0;
  document.getElementById('revealControls').style.display='flex';
  revealCanvas.style.display='none';
  revealUpdate();
}
function revealHide(){
  cancelAnimationFrame(revealAnimationFrame);
  revealAnimationStart=0;
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
  // Rotate successive centres by the golden angle; adjacent FNV hashes alone
  // produced almost identical directions for levels 0, 1 and 2.
  const baseAngle=(revealHash(r.file+":bearing")%6283)/1000;
  const angle=baseAngle+level*2.399963229728653;
  const nominal=[Math.sqrt(2500000/Math.PI),Math.sqrt(700000/Math.PI),Math.sqrt(180000/Math.PI)][level];
  // Independent centres. The true position is offset from each geometric centre.
  const offset=[.50,.48,.44][level]*nominal;
  const cx=Math.cos(angle)*offset,cy=Math.sin(angle)*offset;
  const phase=((revealHash(r.file+":phase:"+level)%6283)/1000)+level*1.7;
  const phase2=((revealHash(r.file+":phase2:"+level)%6283)/1000)+level*2.1;
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
  const extent=2400;
  const polys=[];
  const regions=[];
  for(let level=0;level<3;level++){
    // Binary search the independent polygon size to hit the intersection
    // area, rather than shrinking it until it happens to fit the parent.
    let low=.05,high=5;
    for(let iteration=0;iteration<18;iteration++){
      const mid=(low+high)/2;
      const candidate=revealShape(level,mid);
      const area=level===0?revealArea(candidate):
        revealIntersectionArea([...polys,candidate],extent,90);
      if(area<targets[level])low=mid;
      else high=mid;
    }
    const polygon=revealShape(level,(low+high)/2);
    const measured=level===0?revealArea(polygon):revealIntersectionArea([...polys,polygon],extent,180);
    console.debug("Map reveal level",level+1,"area sq mi",Math.round(measured),"target",targets[level],
      "contains target",revealInside([0,0],polygon));
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
  revealPlaySound();
  revealAnimationStart=performance.now();
  cancelAnimationFrame(revealAnimationFrame);
  revealAnimate();
}
// A short, synthesized wind sweep; no audio assets or network requests.
function revealPlaySound(){
  if(revealMuted)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return;
    revealAudioContext=revealAudioContext||new AC();
    if(revealAudioContext.state==='suspended')revealAudioContext.resume();
    const ac=revealAudioContext,now=ac.currentTime,duration=.72;
    const buffer=ac.createBuffer(1,Math.ceil(ac.sampleRate*duration),ac.sampleRate);
    const data=buffer.getChannelData(0);
    let smooth=0;
    for(let i=0;i<data.length;i++){
      smooth=smooth*.965+(Math.random()*2-1)*.035;
      data[i]=smooth*2.8;
    }
    const source=ac.createBufferSource();source.buffer=buffer;
    const filter=ac.createBiquadFilter();filter.type='lowpass';
    filter.frequency.setValueAtTime(380,now);
    filter.frequency.exponentialRampToValueAtTime(1250,now+.22);
    filter.frequency.exponentialRampToValueAtTime(270,now+duration);
    const gain=ac.createGain();
    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.13,now+.12);
    gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(filter);filter.connect(gain);gain.connect(ac.destination);
    source.start(now);source.stop(now+duration);
  }catch(e){console.debug('Reveal audio unavailable',e);}
}
function revealAnimate(){
  if(!revealCanvas||revealCanvas.style.display==='none')return;
  revealDraw();
  if(performance.now()-revealAnimationStart<850){
    revealAnimationFrame=requestAnimationFrame(revealAnimate);
  }
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
  // Shared midnight-blue cloud veil for both dark streets and satellite.
  ctx.fillStyle='rgba(8,17,33,.54)';
  ctx.fillRect(0,0,w,h);
  // Broad translucent cloud banks give the fog an atmospheric texture.
  const seed=revealHash(revealCurrent.file);
  for(let i=0;i<8;i++){
    const x=w*((((seed>>>((i%4)*7))+i*37)%997)/997);
    const y=h*((((seed>>>((i%3)*9))+i*71)%991)/991);
    const radius=Math.max(w,h)*(.17+(i%3)*.075);
    const g=ctx.createRadialGradient(x,y,0,x,y,radius);
    g.addColorStop(0,'rgba(120,155,186,.07)');
    g.addColorStop(.55,'rgba(82,113,148,.035)');
    g.addColorStop(1,'rgba(82,113,148,0)');
    ctx.fillStyle=g;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  const region=revealRegion();
  // Preserve the intersection of independent polygons at all hint levels.
  const mask=document.createElement('canvas');
  mask.width=revealCanvas.width;mask.height=revealCanvas.height;
  const m=mask.getContext('2d');
  m.setTransform(dpr,0,0,dpr,0,0);
  for(const poly of region.polys){
    m.beginPath();
    poly.forEach(([x,y],i)=>{
      const p=map.project([revealCurrent.lng+x*region.longitudeMiles,
                           revealCurrent.lat+y*region.latitudeMiles]);
      i?m.lineTo(p.x,p.y):m.moveTo(p.x,p.y);
    });
    m.closePath();m.clip();
  }
  m.fillStyle='#fff';m.fillRect(0,0,w,h);
  // Opening expands smoothly from a small clearing to the actual hint geometry.
  const elapsed=revealAnimationStart?performance.now()-revealAnimationStart:850;
  const t=Math.min(1,Math.max(0,elapsed/850));
  const ease=1-Math.pow(1-t,3);
  ctx.save();
  ctx.globalCompositeOperation='destination-out';
  if(t<1){
    const center=map.project([revealCurrent.lng,revealCurrent.lat]);
    const radius=Math.hypot(w,h)*(0.08+1.25*ease);
    const sweep=ctx.createRadialGradient(center.x,center.y,Math.max(0,radius-110),
                                         center.x,center.y,radius);
    sweep.addColorStop(0,'rgba(0,0,0,1)');
    sweep.addColorStop(1,'rgba(0,0,0,0)');
    const animated=document.createElement('canvas');
    animated.width=mask.width;animated.height=mask.height;
    const a=animated.getContext('2d');
    a.setTransform(dpr,0,0,dpr,0,0);
    a.drawImage(mask,0,0,w,h);
    a.globalCompositeOperation='destination-in';
    a.fillStyle=sweep;a.fillRect(0,0,w,h);
    ctx.filter='blur(24px)';
    ctx.drawImage(animated,0,0,w,h);
  }else{
    ctx.filter='blur(24px)';
    ctx.drawImage(mask,0,0,w,h);
  }
  ctx.restore();
  // Add a subtle daylight glow ONLY inside the opening. This keeps dark-streets
  // legible and satellite imagery vibrant without exposing the target point.
  const light=document.createElement('canvas');
  light.width=mask.width;light.height=mask.height;
  const lc=light.getContext('2d');
  lc.setTransform(dpr,0,0,dpr,0,0);
  lc.drawImage(mask,0,0,w,h);
  lc.globalCompositeOperation='source-in';
  lc.fillStyle='rgba(205,225,242,.24)';
  lc.fillRect(0,0,w,h);
  ctx.save();
  ctx.filter='blur(12px)';
  ctx.drawImage(light,0,0,w,h);
  ctx.restore();
  // Soft luminous rim follows the TRUE intersection mask, including its
  // irregular outline, rather than drawing any of the individual polygons.
  const rim=document.createElement('canvas');
  rim.width=mask.width;rim.height=mask.height;
  const rc=rim.getContext('2d');
  rc.setTransform(dpr,0,0,dpr,0,0);
  rc.filter='blur(9px)';
  rc.drawImage(mask,0,0,w,h);
  rc.filter='none';
  rc.globalCompositeOperation='destination-out';
  rc.drawImage(mask,0,0,w,h);
  rc.globalCompositeOperation='source-in';
  rc.fillStyle='rgba(220,244,255,.82)';
  rc.fillRect(0,0,w,h);
  ctx.save();
  ctx.globalAlpha=.85;
  ctx.drawImage(rim,0,0,w,h);
  ctx.restore();
  // The rim is a feathered cloud edge, not a hard polygon stroke.
}
