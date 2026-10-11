import * as THREE from 'three';

// ============================================================
// WALLS OF RUIN: Titan Siege — original open-world squad game
// Single-file client. No copyrighted assets. All procedural.
// NetSim: simulated online squad + BroadcastChannel tab presence.
// Swap NetSim with WebSocket later without touching gameplay.
// ============================================================

const $ = (id) => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b)=>a+Math.random()*(b-a);
const randi = (a,b)=>Math.floor(rand(a,b+1));
const V3 = (x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

function toast(msg, ms=2600){
  const d=document.createElement('div'); d.className='toast-msg'; d.textContent=msg;
  $('toast').appendChild(d); setTimeout(()=>d.remove(), ms);
}
function feed(html){
  const d=document.createElement('div'); d.className='kill'; d.innerHTML=html;
  const kf=$('killfeed'); kf.prepend(d);
  while(kf.children.length>6) kf.lastChild.remove();
  setTimeout(()=>{d.style.opacity='0'; setTimeout(()=>d.remove(),400);}, 5200);
}
function chat(name, text, color='#9adcff'){
  const log=$('chat-log'); const d=document.createElement('div');
  d.innerHTML=`<b style="color:${color}">${name}:</b> ${text}`;
  log.appendChild(d); while(log.children.length>7) log.firstChild.remove();
}

// ---------------- Config / state ----------------
const HEROES = {
  Vanguard:{ hp:100, gas:100, blade:100, speed:1.0, dmg:1.0 },
  Skirmisher:{ hp:80, gas:140, blade:80, speed:1.25, dmg:0.9 },
  Bulwark:{ hp:160, gas:90, blade:120, speed:0.9, dmg:1.6 },
};
const SQUAD_NAMES = ['Kira','Dain','Mira','Soren','Yara','Petra','Otto','Lena','Cas','Rhea','Finn','Noa','Juno','Theo','Alba','Rook'];
const state = {
  mode:'menu', hero:'Vanguard', server:'EU-1 • Wall Rose Front',
  withSquad:true, horde:false,
  hp:100, maxHp:100, gas:100, maxGas:100, blade:100,
  kills:0, score:0, wave:1, waveLeft:0, mission:'Defend the Outer District',
  dead:false, lowSpec:false, time:0,
};

// ---------------- NetSim (online simulation) ----------------
const NetSim = {
  channel:null, tabs:1, id:'p'+Math.floor(Math.random()*1e9),
  online:12,
  init(){
    try{
      this.channel = new BroadcastChannel('walls-of-ruin-v1');
      this.channel.onmessage=(e)=>{
        if(e.data?.t==='hi'||e.data?.t==='hb'){ this.tabs=Math.max(this.tabs, (e.data.n||1)); }
        if(e.data?.t==='chat') chat(e.data.name, e.data.text, '#b6ff9a');
      };
      this.channel.postMessage({t:'hi', n:1});
      setInterval(()=>{ try{this.channel.postMessage({t:'hb', n:this.tabs});}catch{} },3000);
      setInterval(()=>{ this.tabs+=0; },5000);
      // count tabs crudely: each tab announces; assume +1 when receiving hi
      const orig=this.channel.onmessage;
      this.channel.onmessage=(e)=>{
        orig(e);
        if(e.data?.t==='hi'){ try{this.channel.postMessage({t:'hb', n:2});}catch{} this.tabs=Math.min(8,this.tabs+1); updateOnlineUI(); }
      };
    }catch{ /* private mode */ }
    setInterval(()=>{ this.online = clamp(this.online + randi(-1,1), 9, 23); updateOnlineUI(); }, 4000);
  }
};
function updateOnlineUI(){
  const extra = (NetSim.tabs>1)?` (+${NetSim.tabs-1} real tab${NetSim.tabs>2?'s':''})`:'';
  $('online-count').textContent = `${NetSim.online + (NetSim.tabs-1)} online${extra}`;
  $('server-name').textContent = state.server;
}

// ---------------- Three.js world ----------------
let renderer, scene, camera, clock;
let player, playerMesh, cloakMesh;
let anchorTargets = [];   // meshes rays can grapple to
let buildings=[], trees=[];
let titans=[], allies=[], depots=[], particles=[];
let hooks = { L:{active:false, point:V3(), line:null}, R:{active:false, point:V3(), line:null} };
let keys={}, yaw=0, pitch=-0.22, camDist=9;
let raycaster = new THREE.Raycaster();
let groundMesh;
const WORLD = { size:1200, wallHalf:400, wallH:46 };
const tmpV = V3(), tmpV2 = V3(), tmpV3 = V3();

function detectLowSpec(){
  try{
    const c=document.createElement('canvas');
    const gl=c.getContext('webgl');
    const dbg=gl?.getExtension('WEBGL_debug_renderer_info');
    const r=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'';
    if(/swiftshader|llvmpipe|software|angle\s*\(google/i.test(r)) return true;
  }catch{}
  return (navigator.hardwareConcurrency||8)<=4;
}

function initThree(){
  const canvas=$('game-canvas');
  renderer=new THREE.WebGLRenderer({canvas, antialias:!state.lowSpec, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, state.lowSpec?1:1.75));
  renderer.setSize(innerWidth, innerHeight);
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x87b5e0);
  scene.fog=new THREE.Fog(0x9fc3e2, 120, 900);
  camera=new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 2500);
  clock=new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 1.05));
  const sun=new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(300,500,150); scene.add(sun);

  buildTerrain();
  buildWalls();
  buildCity();
  buildForest();
  buildDepots();
  buildSkyDecor();
  buildPlayer();
  buildHooks();

  addEventListener('resize', ()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function buildTerrain(){
  const g=new THREE.PlaneGeometry(WORLD.size, WORLD.size, 32,32);
  // gentle hills outside walls
  const pos=g.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), y=pos.getY(i);
    const d=Math.max(Math.abs(x),Math.abs(y));
    let h=0;
    if(d>WORLD.wallHalf+40) h=Math.sin(x*0.01)*Math.cos(y*0.012)*10 + rand(-1,1);
    pos.setZ(i,h);
  }
  g.computeVertexNormals();
  const m=new THREE.MeshLambertMaterial({color:0x6da552});
  groundMesh=new THREE.Mesh(g,m);
  groundMesh.rotation.x=-Math.PI/2; scene.add(groundMesh);

  // plaza + roads
  const roadM=new THREE.MeshLambertMaterial({color:0x8a7f6a});
  const plaza=new THREE.Mesh(new THREE.CircleGeometry(60,24), new THREE.MeshLambertMaterial({color:0x9a917e}));
  plaza.rotation.x=-Math.PI/2; plaza.position.y=0.1; scene.add(plaza);
  for(let i=-2;i<=2;i++){
    const r1=new THREE.Mesh(new THREE.PlaneGeometry(24, WORLD.wallHalf*2), roadM);
    r1.rotation.x=-Math.PI/2; r1.position.set(i*90, 0.08, 0); scene.add(r1);
    const r2=new THREE.Mesh(new THREE.PlaneGeometry(WORLD.wallHalf*2, 24), roadM);
    r2.rotation.x=-Math.PI/2; r2.position.set(0, 0.08, i*90); scene.add(r2);
  }
  // river
  const river=new THREE.Mesh(new THREE.PlaneGeometry(40, WORLD.size), new THREE.MeshLambertMaterial({color:0x3f9fd8}));
  river.rotation.x=-Math.PI/2; river.position.set(-WORLD.wallHalf-120, 0.15, 0); scene.add(river);
}

function buildWalls(){
  const H=WORLD.wallH, W=WORLD.wallHalf, T=14;
  const mat=new THREE.MeshLambertMaterial({color:0xcfc4a8});
  const mk=(w,h,d,x,y,z)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(x,y,z); scene.add(m); anchorTargets.push(m); return m;
  };
  mk(W*2+T*2,H,T, 0,H/2,-W); mk(W*2+T*2,H,T, 0,H/2,W);
  mk(T,H,W*2, -W,H/2,0); mk(T,H,W*2, W,H/2,0);
  // gate + towers
  const gateM=new THREE.MeshLambertMaterial({color:0x5a4a33});
  const gate=new THREE.Mesh(new THREE.BoxGeometry(40,30,16), gateM);
  gate.position.set(0,15,-W); scene.add(gate);
  for(const [x,z] of [[-W,-W],[W,-W],[-W,W],[W,W]]){
    const t=new THREE.Mesh(new THREE.CylinderGeometry(16,19,70,10), new THREE.MeshLambertMaterial({color:0xbfb294}));
    t.position.set(x,35,z); scene.add(t); anchorTargets.push(t);
  }
  // wall top walk lights
  for(let i=-3;i<=3;i++){
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(1.2,8,8), new THREE.MeshBasicMaterial({color:0xffe9a0}));
    lamp.position.set(i*100, H+3, -W); scene.add(lamp);
  }
}

const houseColors=[0xb08968,0x9c6644,0xe0ac69,0xc2b280,0xa08a7a,0x7f8ea3,0xd4a373];
function buildCity(){
  const geo=new THREE.BoxGeometry(1,1,1);
  const mat=new THREE.MeshLambertMaterial({color:0xffffff});
  const N=170;
  const inst=new THREE.InstancedMesh(geo, mat, N);
  const dummy=new THREE.Object3D(); const color=new THREE.Color();
  let placed=0, guard=0;
  while(placed<N && guard++<3000){
    const x=rand(-WORLD.wallHalf+40, WORLD.wallHalf-40);
    const z=rand(-WORLD.wallHalf+40, WORLD.wallHalf-40);
    if(Math.hypot(x,z)<75) continue;                       // plaza
    if(Math.abs(x)<20||Math.abs(z)<20) continue;            // roads
    if(Math.abs(x%90)<22||Math.abs(z%90)<22) continue;
    const w=rand(14,30), d=rand(14,30), h=rand(12,42);
    dummy.position.set(x,h/2,z); dummy.scale.set(w,h,d);
    dummy.rotation.y=(Math.random()<0.5?0:Math.PI/2);
    dummy.updateMatrix(); inst.setMatrixAt(placed, dummy.matrix);
    color.setHex(houseColors[placed%houseColors.length]).offsetHSL(0,0,rand(-0.05,0.05));
    inst.setColorAt(placed, color);
    // invisible anchor proxy (cheap raycast target)
    const proxy=new THREE.Mesh(new THREE.BoxGeometry(w,h,d));
    proxy.position.copy(dummy.position); proxy.visible=false;
    proxy.userData.anchor=true; scene.add(proxy); anchorTargets.push(proxy);
    buildings.push({x,z,w,d,h});
    placed++;
  }
  inst.instanceMatrix.needsUpdate=true;
  if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
  scene.add(inst);
  // roofs
  const roofG=new THREE.ConeGeometry(1,1,4);
  const roofM=new THREE.MeshLambertMaterial({color:0x7a3b2e});
  const roofs=new THREE.InstancedMesh(roofG, roofM, N);
  for(let i=0;i<placed;i++){
    const b=buildings[i];
    dummy.position.set(b.x, b.h + 3, b.z);
    dummy.scale.set(b.w*0.75, 6, b.d*0.75); dummy.rotation.y=Math.PI/4; dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
  }
  roofs.instanceMatrix.needsUpdate=true; scene.add(roofs);
  // HQ
  const hq=new THREE.Mesh(new THREE.BoxGeometry(60,50,40), new THREE.MeshLambertMaterial({color:0x3d4d6b}));
  hq.position.set(0,25,120); scene.add(hq); anchorTargets.push(hq);
  const flag=new THREE.Mesh(new THREE.BoxGeometry(2,18,2), new THREE.MeshBasicMaterial({color:0xffffff}));
  flag.position.set(0,60,120); scene.add(flag);
}

function buildForest(){
  const trunkG=new THREE.CylinderGeometry(1.2,1.8,10,6);
  const leafG=new THREE.ConeGeometry(7,20,7);
  const trunkM=new THREE.MeshLambertMaterial({color:0x6b4a2f});
  const leafM=new THREE.MeshLambertMaterial({color:0x2e6b2e});
  const N=380;
  const trunks=new THREE.InstancedMesh(trunkG,trunkM,N);
  const leaves=new THREE.InstancedMesh(leafG,leafM,N);
  const dummy=new THREE.Object3D();
  for(let i=0;i<N;i++){
    // giant forest west + scattered groves
    let x,z;
    if(i<260){ x=rand(-WORLD.wallHalf+30,-60); z=rand(-WORLD.wallHalf+30,WORLD.wallHalf-30); }
    else { const a=rand(0,Math.PI*2), r=rand(WORLD.wallHalf+60, 520); x=Math.cos(a)*r; z=Math.sin(a)*r; }
    const s=rand(1.2,2.4);
    dummy.position.set(x,5*s,z); dummy.scale.set(s,s,s); dummy.rotation.y=rand(0,6); dummy.updateMatrix();
    trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.set(x,(10+10)*s*0.85,z); dummy.updateMatrix();
    leaves.setMatrixAt(i,dummy.matrix);
    const proxy=new THREE.Mesh(new THREE.CylinderGeometry(3,3,26,5));
    proxy.position.set(x,13,z); proxy.visible=false; scene.add(proxy); anchorTargets.push(proxy);
    trees.push({x,z,s});
  }
  trunks.instanceMatrix.needsUpdate=true; leaves.instanceMatrix.needsUpdate=true;
  scene.add(trunks,leaves);
}

function buildDepots(){
  const spots=[[80,0,-80],[-80,0,80],[80,0,80],[-80,0,-80],[0,0,180]];
  for(const [x,,z] of spots){
    const g=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(10,12,3,12), new THREE.MeshLambertMaterial({color:0x223344}));
    base.position.y=1.5; g.add(base);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,60,8), new THREE.MeshBasicMaterial({color:0x3ec6ff, transparent:true, opacity:0.55}));
    beam.position.y=30; g.add(beam);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(9,0.7,8,24), new THREE.MeshBasicMaterial({color:0x3ec6ff}));
    ring.rotation.x=Math.PI/2; ring.position.y=3.2; g.add(ring);
    g.position.set(x,0,z); scene.add(g);
    depots.push({pos:V3(x,0,z), ring, beam});
  }
}

function buildSkyDecor(){
  // clouds
  const cm=new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.85});
  for(let i=0;i<14;i++){
    const c=new THREE.Mesh(new THREE.SphereGeometry(rand(18,40),8,6), cm);
    c.position.set(rand(-700,700), rand(160,260), rand(-700,700));
    c.scale.y=0.45; scene.add(c);
  }
  // distant mountains
  const mm=new THREE.MeshLambertMaterial({color:0x6a7f95});
  for(let i=0;i<10;i++){
    const a=(i/10)*Math.PI*2;
    const m=new THREE.Mesh(new THREE.ConeGeometry(rand(80,150),rand(120,240),5), mm);
    m.position.set(Math.cos(a)*950, 0, Math.sin(a)*950); scene.add(m);
  }
}

function buildPlayer(){
  player={ pos:V3(0,2,40), vel:V3(), grounded:true, radius:1 };
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.7,1.4,4,10), new THREE.MeshLambertMaterial({color:0x3a4a2f}));
  body.position.y=1.6; g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.5,10,8), new THREE.MeshLambertMaterial({color:0xe8b88a}));
  head.position.y=3.1; g.add(head);
  cloakMesh=new THREE.Mesh(new THREE.PlaneGeometry(1.6,2.2), new THREE.MeshLambertMaterial({color:0x5a1f1f, side:THREE.DoubleSide}));
  cloakMesh.position.set(0,2.2,-0.7); cloakMesh.rotation.x=0.35; g.add(cloakMesh);
  // blades
  const bm=new THREE.MeshBasicMaterial({color:0xdfe8ff});
  for(const s of [-1,1]){
    const b=new THREE.Mesh(new THREE.BoxGeometry(0.08,1.6,0.25), bm);
    b.position.set(s*0.9,1.6,0.4); b.rotation.x=0.5; g.add(b);
  }
  g.position.copy(player.pos); scene.add(g);
  playerMesh=g;
}

function buildHooks(){
  const mat=new THREE.LineBasicMaterial({color:0x222222});
  for(const k of ['L','R']){
    const geo=new THREE.BufferGeometry().setFromPoints([V3(),V3()]);
    const line=new THREE.Line(geo,mat); line.frustumCulled=false; scene.add(line);
    hooks[k].line=line; line.visible=false;
  }
}

// ---------------- Titans ----------------
const TITAN_CLASSES=[
  {name:'Scout', h:5, hp:1, speed:4, dmg:12, score:100, color:0xd9a583},
  {name:'Brute', h:8, hp:1, speed:5.5, dmg:20, score:200, color:0xc98a6a},
  {name:'Savage', h:11, hp:2, speed:6.5, dmg:32, score:350, color:0xb56b4a},
  {name:'Colossal', h:16, hp:3, speed:4.5, dmg:55, score:800, color:0x8a4a3a},
];
function spawnTitan(nearCenter=false){
  const cls = state.horde
    ? TITAN_CLASSES[randi(0,3)]
    : (Math.random()<0.06 ? TITAN_CLASSES[3] : TITAN_CLASSES[randi(0,2)]);
  const h=cls.h*rand(0.9,1.15);
  const g=new THREE.Group();
  const skin=new THREE.MeshLambertMaterial({color:cls.color});
  const s=h/8; // normalize to brute
  const torso=new THREE.Mesh(new THREE.BoxGeometry(2.4*s,3.4*s,1.4*s), skin); torso.position.y=5.2*s; g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.9*s,10,8), skin); head.position.y=7.6*s; g.add(head);
  const jaw=new THREE.Mesh(new THREE.BoxGeometry(1.1*s,0.4*s,0.6*s), new THREE.MeshLambertMaterial({color:0x5a1f1f}));
  jaw.position.set(0,7.1*s,0.7*s); g.add(jaw);
  const nape=new THREE.Mesh(new THREE.SphereGeometry(0.65*s,10,8), new THREE.MeshBasicMaterial({color:0xff3344}));
  nape.position.set(0,7.3*s,-0.85*s); g.add(nape);
  const limbs={};
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.8*s,3.6*s,0.8*s), skin);
    arm.position.set(side*1.7*s,5.4*s,0); g.add(arm); limbs[side<0?'armL':'armR']=arm;
    const leg=new THREE.Mesh(new THREE.BoxGeometry(1*s,3.6*s,1*s), skin);
    leg.position.set(side*0.7*s,1.8*s,0); g.add(leg); limbs[side<0?'legL':'legR']=leg;
  }
  // spawn on ring outside plaza
  let x,z;
  if(nearCenter){ x=rand(-150,150); z=rand(-150,150); }
  else { const a=rand(0,Math.PI*2), r=rand(220,360); x=Math.cos(a)*r; z=Math.sin(a)*r; }
  g.position.set(x,0,z); scene.add(g);
  const t={ cls, h, mesh:g, nape, limbs, hp:cls.hp, maxHp:cls.hp,
    pos:g.position, vel:V3(), state:'wander', target:V3(rand(-200,200),0,rand(-200,200)),
    atkCd:0, walkPh:rand(0,6), dead:false, deadT:0, grabbed:null };
  titans.push(t);
  return t;
}
function killTitan(t, byName='YOU'){
  if(t.dead) return;
  t.dead=true; t.deadT=0;
  const pts=t.cls.score;
  if(byName==='YOU'){ state.kills++; state.score+=pts; addScore(byName, pts); }
  else addScore(byName, pts);
  feed(`⚔️ <b>${byName}</b> slew a ${t.cls.name} Titan (+${pts})`);
  burst(t.pos.clone().add(V3(0,t.h*0.8,0)), 0xff5566, 26);
  burst(t.pos.clone().add(V3(0,2,0)), 0xffe08a, 18);
  hitmark(t.cls.name.toUpperCase()+' DOWN');
  state.waveLeft=Math.max(0,state.waveLeft-1);
  if(Math.random()<0.5) squadChatter('kill');
}

// ---------------- Particles ----------------
function burst(p, color, n=14){
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.4,0.4), new THREE.MeshBasicMaterial({color}));
    m.position.copy(p);
    const v=V3(rand(-9,9),rand(2,14),rand(-9,9));
    scene.add(m); particles.push({m, v, life:rand(0.5,1.1), t:0});
  }
  if(particles.length>400){ const p0=particles.splice(0,particles.length-400); p0.forEach(o=>scene.remove(o.m)); }
}

// ---------------- Squad allies (online sim) ----------------
function spawnAllies(){
  clearAllies();
  const n = state.withSquad ? 8 : 3;
  for(let i=0;i<n;i++){
    const name=SQUAD_NAMES[i%SQUAD_NAMES.length]+(i>=SQUAD_NAMES.length?' '+(Math.floor(i/SQUAD_NAMES.length)+1):'');
    const g=new THREE.Group();
    const b=new THREE.Mesh(new THREE.CapsuleGeometry(0.6,1.2,3,8), new THREE.MeshLambertMaterial({color:[0x2f4a7a,0x4a2f6b,0x2f6b4a][i%3]}));
    b.position.y=1.5; g.add(b);
    const h=new THREE.Mesh(new THREE.SphereGeometry(0.45,8,6), new THREE.MeshLambertMaterial({color:0xe8b88a}));
    h.position.y=2.9; g.add(h);
    const tag=makeTag(name);
    tag.position.y=4.2; g.add(tag);
    g.position.set(rand(-60,60),0,rand(-20,120));
    scene.add(g);
    allies.push({name, mesh:g, pos:g.position, vel:V3(), slashCd:rand(1,3), score:randi(0,300), target:null, swingPh:rand(0,6)});
  }
  refreshLeaderboard();
}
function clearAllies(){ for(const a of allies) scene.remove(a.mesh); allies=[]; }
function makeTag(text){
  const c=document.createElement('canvas'); c.width=256; c.height=64;
  const x=c.getContext('2d'); x.fillStyle='rgba(0,0,0,.55)'; x.fillRect(0,8,256,48);
  x.fillStyle='#8dff9d'; x.font='bold 30px sans-serif'; x.textAlign='center'; x.fillText(text,128,44);
  const t=new THREE.CanvasTexture(c);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(6,1.5), new THREE.MeshBasicMaterial({map:t, transparent:true}));
  return m;
}
const CHAT_LINES={
  kill:['Nape confirmed!','One less giant.','Who saw that swing?!','For the walls!','That one barely scratched me.'],
  spot:['Contact! Big one by the gate!','Movement in the forest!','Colossal signature — stay high!','Two savages near HQ!'],
  help:['Need gas — covering me?','Blades chipped, heading to depot!','Grabbed my cloak — keep moving!'],
  start:['Deploying! Hold the line!','Squad up. Watch the skies… I mean napes.','Remember: speed + napes. Go!'],
};
function squadChatter(kind){
  if(!allies.length) return;
  const a=allies[randi(0,allies.length-1)];
  const line=CHAT_LINES[kind][randi(0,CHAT_LINES[kind].length-1)];
  chat(a.name, line);
}

// ---------------- Score / leaderboard ----------------
let lb={};
function addScore(name, pts){
  lb[name]=(lb[name]||0)+pts;
  try{ localStorage.setItem('wor_lb', JSON.stringify(lb)); }catch{}
  refreshLeaderboard();
}
function refreshLeaderboard(){
  try{ lb={YOU:state.score, ...JSON.parse(localStorage.getItem('wor_lb')||'{}')}; }catch{ lb={YOU:state.score}; }
  lb.YOU=state.score;
  for(const a of allies) if(!(a.name in lb)) lb[a.name]=a.score;
  const rows=Object.entries(lb).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('lb-list').innerHTML=rows.map(([n,s],i)=>`<li><b>${i+1}. ${n}</b> — ${s} pts</li>`).join('');
}

// ---------------- Input ----------------
let inputReady=false;
function initInput(){
  if(inputReady) return; inputReady=true;
  addEventListener('keydown',(e)=>{
    keys[e.code]=true;
    if(e.code==='Enter'&&state.mode==='play'){ fakeChatSend(); }
    if(e.code==='KeyM'&&state.mode==='play'){ toast('Full map: walls form a 800m square. Blue beams = supply. Red = titans.'); }
    if(e.code==='KeyF') trySlash();
    if(e.code==='KeyR'){ if(state.blade<40){ state.blade=HEROES[state.hero].blade; toast('Blades swapped!'); } }
    if(['Space','ArrowUp'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup',(e)=>keys[e.code]=false);

  const canvas=$('game-canvas');
  canvas.addEventListener('click',()=>{ if(state.mode==='play'&&!document.pointerLockElement) canvas.requestPointerLock?.(); });
  document.addEventListener('pointerlockchange',()=>{
    const locked=!!document.pointerLockElement;
    if(!locked&&state.mode==='play') showPause();
  });
  addEventListener('mousemove',(e)=>{
    if(document.pointerLockElement&&state.mode==='play'&&!state.dead){
      yaw-=e.movementX*0.0024; pitch=clamp(pitch-e.movementY*0.0022,-1.1,0.6);
    }
  });
  canvas.addEventListener('mousedown',(e)=>{
    if(state.mode!=='play'||state.dead) return;
    if(!document.pointerLockElement){ canvas.requestPointerLock?.(); return; }
    if(e.button===0) toggleHook('L');
    if(e.button===2) toggleHook('R');
  });
  addEventListener('contextmenu',(e)=>{ if(state.mode==='play') e.preventDefault(); });
  // wheel zoom
  addEventListener('wheel',(e)=>{ if(state.mode==='play') camDist=clamp(camDist+e.deltaY*0.005,3.5,14); },{passive:true});
}
function fakeChatSend(){
  const a='YOU';
  const lines=['On my way to the gate!','Swinging high — cover my six!','Nape in sight!'];
  const t=lines[randi(0,lines.length-1)];
  chat(a,t,'#ffd98a');
  try{NetSim.channel?.postMessage({t:'chat', name:a, text:t});}catch{}
}

// ---------------- Hooks / ODM ----------------
function toggleHook(side){
  const h=hooks[side];
  if(h.active){ h.active=false; h.line.visible=false; updateHookUI(); return; }
  // cast from camera forward
  const dir=V3(); camera.getWorldDirection(dir);
  raycaster.set(camera.position, dir); raycaster.far=110;
  const hits=raycaster.intersectObjects(anchorTargets, false);
  let p;
  if(hits.length) p=hits[0].point.clone();
  else {
    // sky-anchor: project forward-up so swinging still works in fields
    p=camera.position.clone().add(dir.clone().multiplyScalar(60)); p.y=Math.max(p.y+18, 30);
  }
  // offset L/R for dual feel
  const right=V3(1,0,0).applyQuaternion(camera.quaternion);
  p.add(right.clone().multiplyScalar(side==='L'?-3:3));
  h.active=true; h.point.copy(p); h.line.visible=true;
  if(state.gas>0){ state.gas=Math.max(0,state.gas-2); }
  updateHookUI();
  // click sound substitute: tiny particle
  burst(p, 0x3ec6ff, 4);
}
function updateHookUI(){
  $('hookL').textContent=hooks.L.active?'◉ L FIRED':'◉ L ready';
  $('hookR').textContent=hooks.R.active?'◉ R FIRED':'◉ R ready';
  $('hookL').classList.toggle('fired',hooks.L.active);
  $('hookR').classList.toggle('fired',hooks.R.active);
}

// ---------------- Combat ----------------
function trySlash(){
  if(state.mode!=='play'||state.dead) return;
  if(state.blade<=0){ toast('Blades broken! Press R or visit a depot.'); return; }
  state.blade=Math.max(0,state.blade-6);
  const speed=player.vel.length();
  let best=null, bestD=11;
  for(const t of titans){
    if(t.dead) continue;
    const nw=V3(); t.nape.getWorldPosition(nw);
    const d=nw.distanceTo(player.pos.clone().add(V3(0,2,0)));
    if(d<bestD){ bestD=d; best=t; }
  }
  // slash arc visual
  burst(player.pos.clone().add(V3(0,2.5,0)), 0xffffff, 8);
  if(best){
    const dmg=HEROES[state.hero].dmg*(speed>9?1.5:1);
    best.hp-=dmg;
    burst(V3(best.nape.getWorldPosition(tmpV).x,tmpV.y,tmpV.z), 0xffd23e, 16);
    if(best.hp<=0) killTitan(best,'YOU');
    else { feed(`🗡️ You wounded a ${best.cls.name} (${Math.max(0,best.hp).toFixed(1)} HP left)`); hitmark('HIT!'); }
  } else if(speed>4){
    // whiff
  }
}
function hitmark(t){
  const el=$('hitmarker'); el.textContent=t; el.classList.add('show');
  clearTimeout(hitmark._t); hitmark._t=setTimeout(()=>el.classList.remove('show'),350);
}

// ---------------- Waves / missions ----------------
const MISSIONS=['Defend the Outer District','Exterminate the Vanguard Horde','Hold the Forest Pass','Protect the Supply Convoy','Slay the Colossal'];
function startWave(n){
  state.wave=n;
  const count=Math.min(4+n*2+(state.horde?5:0), 16);
  for(let i=0;i<count;i++) spawnTitan(i<2);
  state.waveLeft=titans.filter(t=>!t.dead).length;
  state.mission=MISSIONS[(n-1)%MISSIONS.length];
  $('mission-text').textContent=`${state.mission} — Wave ${n}`;
  $('wave-num').textContent=n;
  feed(`🌊 <b>Wave ${n}</b>: ${count} titans breached the gate!`);
  chat('Command','Titans inside the walls! All squads engage!','#ffb42d');
}
function checkWave(){
  const alive=titans.filter(t=>!t.dead).length;
  state.waveLeft=alive;
  if(alive===0){
    state.score+=250*state.wave;
    addScore('YOU',250*state.wave);
    toast(`Wave ${state.wave} cleared! +${250*state.wave} pts — next wave incoming`);
    setTimeout(()=>{ if(state.mode==='play') startWave(state.wave+1); }, 3500);
    // cleanup corpses
    for(let i=titans.length-1;i>=0;i--) if(titans[i].dead){ scene.remove(titans[i].mesh); titans.splice(i,1); }
  }
}

// ---------------- Damage / respawn ----------------
function hurtPlayer(dmg, cause){
  if(state.dead||state.mode!=='play') return;
  state.hp-=dmg;
  const dv=$('damage-vignette'); dv.classList.add('hurt'); setTimeout(()=>dv.classList.remove('hurt'),220);
  if(state.hp<=0){
    state.hp=0; state.dead=true;
    hooks.L.active=hooks.R.active=false; hooks.L.line.visible=hooks.R.line.visible=false;
    $('respawn-overlay').classList.remove('hidden');
    feed(`💀 <b>YOU</b> were ${cause}!`);
    let s=3; $('respawn-timer').textContent=s;
    const iv=setInterval(()=>{
      s--; $('respawn-timer').textContent=s;
      if(s<=0){ clearInterval(iv); respawn(); }
    },1000);
  }
}
function respawn(){
  const d=depots[randi(0,depots.length-1)];
  player.pos.set(d.pos.x+rand(-6,6), 3, d.pos.z+rand(-6,6));
  player.vel.set(0,0,0);
  const c=HEROES[state.hero];
  state.hp=c.hp; state.maxHp=c.hp; state.gas=c.gas; state.maxGas=c.gas; state.blade=c.blade;
  state.dead=false;
  $('respawn-overlay').classList.add('hidden');
  toast('Redeployed at supply depot. Blades & gas restored.');
}

// ---------------- Update loops ----------------
function updatePlayer(dt){
  const c=HEROES[state.hero];
  const boosting=(keys.Space||keys.KeyW&&false);
  const gasUse=(hooks.L.active||hooks.R.active?6:0)+((keys.Space)?22:0);
  if(gasUse>0) state.gas=Math.max(0,state.gas-gasUse*dt);
  const outOfGas=state.gas<=0.5;

  // camera-relative move
  const f=V3(-Math.sin(yaw),0,-Math.cos(yaw));
  const r=V3(-f.z,0,f.x);
  const wish=V3();
  if(keys.KeyW) wish.add(f); if(keys.KeyS) wish.sub(f);
  if(keys.KeyD) wish.add(r); if(keys.KeyA) wish.sub(r);
  if(wish.lengthSq()>0) wish.normalize();
  const sprint=(keys.ShiftLeft||keys.ShiftRight)?1.5:1;
  const maxSp=(player.grounded?9:12)*c.speed*sprint;

  if(player.grounded){
    player.vel.x+=wish.x*46*dt; player.vel.z+=wish.z*46*dt;
    // friction
    player.vel.x*=Math.pow(0.02,dt); player.vel.z*=Math.pow(0.02,dt);
    if(wish.lengthSq()>0&&player.vel.length()<maxSp){
      player.vel.x=wish.x*maxSp*0.6+player.vel.x*0.4;
      player.vel.z=wish.z*maxSp*0.6+player.vel.z*0.4;
    }
    if(keys.Space&&!outOfGas){ player.vel.y=10; player.grounded=false; state.gas=Math.max(0,state.gas-4); }
  } else {
    player.vel.x+=wish.x*16*dt; player.vel.z+=wish.z*16*dt;
  }

  // ODM pull
  let anchored=false;
  for(const k of ['L','R']){
    const h=hooks[k];
    if(!h.active) continue;
    anchored=true;
    tmpV.copy(h.point).sub(player.pos);
    const dist=tmpV.length();
    if(dist>120||outOfGas){ h.active=false; h.line.visible=false; updateHookUI(); continue; }
    tmpV.normalize();
    const pull=outOfGas?8:52;
    player.vel.addScaledVector(tmpV, pull*dt*3);
    // reel: shorten feel by extra upward bias when boosting
    if(keys.Space&&!outOfGas){
      player.vel.addScaledVector(tmpV, 30*dt*2);
      player.vel.y+=8*dt;
      burst(player.pos.clone().add(V3(0,1,0)), 0x9adcff, 1);
    }
    // swing damping of gravity partially
    player.vel.y+=6*dt;
  }
  // Q/E as hook toggles too
  if(keys.KeyQ&&!hooks.L._held){ toggleHook('L'); hooks.L._held=true; } if(!keys.KeyQ) hooks.L._held=false;
  if(keys.KeyE&&!hooks.R._held){ toggleHook('R'); hooks.R._held=true; } if(!keys.KeyE) hooks.R._held=false;

  player.vel.y-=22*dt; // gravity
  player.vel.y=Math.max(player.vel.y,-55);
  // clamp horizontal
  const hs=Math.hypot(player.vel.x,player.vel.z);
  const hsMax=anchored?42:20;
  if(hs>hsMax){ player.vel.x*=hsMax/hs; player.vel.z*=hsMax/hs; }

  player.pos.addScaledVector(player.vel, dt);
  // ground
  const gy=groundHeight(player.pos.x,player.pos.z);
  if(player.pos.y<=gy+0.2){ player.pos.y=gy+0.2; if(player.vel.y<0)player.vel.y=0; player.grounded=true; }
  else if(player.pos.y>gy+0.5) player.grounded=false;
  // walls collision (simple pushback)
  const W=WORLD.wallHalf;
  // allow climbing walls with hooks: if anchored, permit y up wall
  // outer clamp
  player.pos.x=clamp(player.pos.x,-560,560); player.pos.z=clamp(player.pos.z,-560,560);
  player.pos.y=Math.min(player.pos.y, 160);

  // building tops stand
  // (cheap: if inside building footprint and below top, push up)
  for(const b of buildings){
    if(Math.abs(player.pos.x-b.x)<b.w/2&&Math.abs(player.pos.z-b.z)<b.d/2){
      if(player.pos.y<b.h&&player.pos.y>b.h-4&&player.vel.y<=0){ player.pos.y=b.h; player.vel.y=0; player.grounded=true; }
    }
  }

  // depots refill
  for(const d of depots){
    if(player.pos.distanceTo(V3(d.pos.x,player.pos.y,d.pos.z))<13){
      state.gas=Math.min(state.maxGas,state.gas+40*dt);
      state.blade=Math.min(120,state.blade+30*dt);
      if(player.grounded&&state.hp<state.maxHp) state.hp=Math.min(state.maxHp,state.hp+6*dt);
    }
  }
  // blade regen slowly? no — depots only
  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y=yaw+Math.PI;
  cloakMesh.rotation.x=0.35+clamp(player.vel.length()*0.03,0,1.1);

  // hook lines
  for(const k of ['L','R']){
    const h=hooks[k];
    if(h.active){
      const p=h.line.geometry.attributes.position;
      p.setXYZ(0,player.pos.x,player.pos.y+2.2,player.pos.z);
      p.setXYZ(1,h.point.x,h.point.y,h.point.z);
      p.needsUpdate=true;
    }
  }
  // camera
  const cd=camDist;
  tmpV2.set(player.pos.x+Math.sin(yaw)*Math.cos(pitch)*cd, player.pos.y+2.6-Math.sin(pitch)*cd, player.pos.z+Math.cos(yaw)*Math.cos(pitch)*cd);
  camera.position.lerp(tmpV2, 1-Math.pow(0.0001,dt));
  camera.lookAt(player.pos.x, player.pos.y+2.4, player.pos.z);
}
function groundHeight(x,z){
  const d=Math.max(Math.abs(x),Math.abs(z));
  if(d<WORLD.wallHalf+40) return 0;
  return Math.sin(x*0.01)*Math.cos(z*0.012)*10;
}

function updateTitans(dt){
  for(const t of titans){
    if(t.dead){
      t.deadT+=dt;
      t.mesh.rotation.x=Math.min(Math.PI/2, t.deadT*2);
      if(t.deadT>4) t.mesh.position.y-=dt*1.5;
      continue;
    }
    t.walkPh+=dt*(2+t.vel.length()*0.15);
    const sw=Math.sin(t.walkPh)*0.5;
    t.limbs.armL.rotation.x=sw; t.limbs.armR.rotation.x=-sw;
    t.limbs.legL.rotation.x=-sw; t.limbs.legR.rotation.x=sw;
    t.mesh.rotation.y+=Math.sin(t.walkPh*0.3)*0.002;
    t.nape.scale.setScalar(1+Math.sin(state.time*5)*0.12);
    t.atkCd-=dt;

    // target: nearest of player/allies
    let tp=player.pos, best=t.pos.distanceTo(player.pos);
    for(const a of allies){ const d=t.pos.distanceTo(a.pos); if(d<best){best=d; tp=a.pos;} }
    const dist=best;
    const dir=tmpV.copy(tp).sub(t.pos); dir.y=0; const dl=dir.length()||1; dir.normalize();

    if(dist<t.h*1.6){
      // attack
      t.mesh.rotation.y=Math.atan2(dir.x,dir.z);
      if(t.atkCd<=0){
        t.atkCd=2.2;
        // swipe anim
        t.limbs.armR.rotation.x=-2;
        burst(tp.clone().add(V3(0,2,0)), 0xff6644, 10);
        if(tp===player.pos){ hurtPlayer(t.cls.dmg*(dist<6?1.4:1), 'crushed by a '+t.cls.name); }
        else {
          // ally damage: teleport ally away (dodge) or kill score
          const al=allies.find(a=>a.pos===tp);
          if(al&&Math.random()<0.25){ chat(al.name,'Argh! It got me — respawning!','#ff9a9a'); al.pos.set(rand(-60,60),0,rand(0,100)); al.score=Math.max(0,al.score-50); }
        }
      }
      t.vel.multiplyScalar(Math.pow(0.05,dt));
    } else if(dist<220){
      t.state='chase';
      t.mesh.rotation.y=Math.atan2(dir.x,dir.z);
      t.vel.addScaledVector(dir, t.cls.speed*3*dt);
    } else {
      // wander
      if(t.pos.distanceTo(t.target)<12||Math.random()<0.002) t.target.set(rand(-300,300),0,rand(-300,300));
      tmpV2.copy(t.target).sub(t.pos); tmpV2.y=0; tmpV2.normalize();
      t.mesh.rotation.y=Math.atan2(tmpV2.x,tmpV2.z);
      t.vel.addScaledVector(tmpV2, t.cls.speed*1.2*dt);
    }
    // friction + integrate
    t.vel.multiplyScalar(Math.pow(0.1,dt));
    const sp=t.vel.length(), maxS=t.cls.speed*2.2;
    if(sp>maxS) t.vel.multiplyScalar(maxS/sp);
    t.pos.addScaledVector(t.vel,dt);
    // smash buildings in path (visual only: shake)
    t.pos.x=clamp(t.pos.x,-520,520); t.pos.z=clamp(t.pos.z,-520,520);
    // grab player if very close & airborne slow
    if(tp===player.pos&&dist<3.4&&t.atkCd<1.2&&player.pos.y<6){
      hurtPlayer(35,'grabbed by a '+t.cls.name);
      player.vel.set(rand(-15,15),14,rand(-15,15));
    }
  }
}

function updateAllies(dt){
  for(const a of allies){
    // pick nearest living titan
    let best=null,bd=1e9;
    for(const t of titans){ if(t.dead)continue; const d=a.pos.distanceTo(t.pos); if(d<bd){bd=d;best=t;} }
    a.target=best;
    a.slashCd-=dt;
    if(best){
      tmpV.copy(best.pos).sub(a.pos); tmpV.y=0; const d=tmpV.length()||1; tmpV.normalize();
      // hop-fly toward titan: fast arc movement
      const want=clamp(d*0.6,4,26);
      a.vel.addScaledVector(tmpV, 30*dt);
      a.vel.y+=((6+Math.sin(state.time*2+a.swingPh)*4)-a.pos.y)*2*dt;
      const sp=a.vel.length();
      if(sp>want) a.vel.multiplyScalar(want/sp);
      a.pos.addScaledVector(a.vel,dt);
      a.pos.y=Math.max(0.5,a.pos.y);
      a.mesh.rotation.y=Math.atan2(tmpV.x,tmpV.z);
      if(d<best.h*1.4&&a.slashCd<=0){
        a.slashCd=rand(2,4.5);
        burst(best.pos.clone().add(V3(0,best.h*0.85,0)),0xfff2a0,8);
        best.hp-=0.7;
        if(best.hp<=0) killTitan(best,a.name);
      }
    } else {
      // patrol back to plaza
      tmpV.set(rand(-1,1),0,rand(-1,1));
      a.pos.addScaledVector(tmpV,4*dt);
      a.pos.y+=((2)-a.pos.y)*dt;
    }
    a.mesh.position.copy(a.pos);
    a.mesh.position.y+=Math.abs(Math.sin(state.time*6+a.swingPh))*0.4;
  }
}

function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.t+=dt;
    p.v.y-=18*dt; p.m.position.addScaledVector(p.v,dt);
    p.m.rotation.x+=dt*5;
    if(p.t>p.life){ scene.remove(p.m); particles.splice(i,1); }
  }
  for(const d of depots){ d.ring.rotation.z+=dt; d.beam.material.opacity=0.4+Math.sin(state.time*3)*0.15; }
}

// ---------------- HUD / minimap ----------------
const mm=$('minimap');
function updateHUD(){
  $('hp-fill').style.width=(100*state.hp/state.maxHp)+'%';
  $('gas-fill').style.width=(100*state.gas/state.maxGas)+'%';
  $('blade-fill').style.width=(100*clamp(state.blade,0,100)/100)+'%';
  $('stat-alt').textContent=Math.max(0,Math.round(player.pos.y))+'m';
  $('stat-speed').textContent=Math.round(player.vel.length()*3.6)+'km/h';
  $('stat-kills').textContent=state.kills;
  $('stat-score').textContent=state.score;
  $('titans-left').textContent=state.waveLeft;
  $('wave-num').textContent=state.wave;
  drawMinimap();
}
function drawMinimap(){
  const x=mm.getContext('2d');
  x.clearRect(0,0,150,150);
  x.fillStyle='#0a1420'; x.beginPath(); x.arc(75,75,73,0,7); x.fill();
  const s=(p)=>[75+p.x/560*70, 75+p.z/560*70];
  // walls
  x.strokeStyle='#cbbf9a'; x.lineWidth=3; x.strokeRect(75-400/560*70,75-400/560*70,800/560*70,800/560*70);
  // depots
  x.fillStyle='#3ec6ff';
  for(const d of depots){ const [a,b]=s(d.pos); x.fillRect(a-2,b-2,4,4); }
  // titans
  x.fillStyle='#ff4d5e';
  for(const t of titans){ if(t.dead)continue; const [a,b]=s(t.pos); x.beginPath(); x.arc(a,b,t.cls.name==='Colossal'?5:3,0,7); x.fill(); }
  // allies
  x.fillStyle='#2bff9a';
  for(const a of allies){ const [ax,az]=s(a.pos); x.fillRect(ax-1.5,az-1.5,3,3); }
  // player arrow
  const [px,pz]=s(player.pos);
  x.save(); x.translate(px,pz); x.rotate(Math.atan2(Math.sin(yaw),Math.cos(yaw))+Math.PI);
  x.fillStyle='#ffb42d'; x.beginPath(); x.moveTo(0,-7); x.lineTo(5,5); x.lineTo(-5,5); x.closePath(); x.fill(); x.restore();
}

// ---------------- Game flow ----------------
function showPause(){ if(state.mode!=='play')return; state.mode='pause'; refreshLeaderboard(); $('pause-screen').classList.remove('hidden'); document.exitPointerLock?.(); }
function hidePause(){ state.mode='play'; $('pause-screen').classList.add('hidden'); }

async function deploy(){
  state.hero=document.querySelector('.hero.selected')?.dataset.hero||'Vanguard';
  state.server=document.querySelector('.server.selected')?.dataset.server||state.server;
  state.withSquad=$('opt-squad').checked;
  state.horde=$('opt-horde').checked;
  const c=HEROES[state.hero];
  state.maxHp=state.hp=c.hp; state.maxGas=state.gas=c.gas; state.blade=c.blade;
  state.kills=0; state.score=0; state.wave=0; state.dead=false; state.time=0;
  $('menu-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('loading').style.display='flex';
  updateOnlineUI();
  // init three lazily (faster first paint)
  await new Promise(r=>setTimeout(r,60));
  try{
    if(!renderer){ state.lowSpec=detectLowSpec(); initThree(); initInput(); NetSim.init(); }
    // reset world
    for(const t of titans) scene.remove(t.mesh); titans=[];
    player.pos.set(0,2,40); player.vel.set(0,0,0); yaw=Math.PI; pitch=-0.15;
    hooks.L.active=hooks.R.active=false; hooks.L.line.visible=hooks.R.line.visible=false; updateHookUI();
    spawnAllies();
    try{ lb=JSON.parse(localStorage.getItem('wor_lb')||'{}'); }catch{ lb={}; }
    $('loading').style.display='none';
    state.mode='play';
    startWave(1);
    toast(`${state.hero} deployed on ${state.server}${state.lowSpec?' • low-spec mode':''}`);
    chat('Command',`${state.hero} joined ${state.server}. Good hunting!`,'#ffb42d');
    if(state.withSquad) setTimeout(()=>squadChatter('start'),800);
    $('game-canvas').requestPointerLock?.();
    requestAnimationFrame(loop);
  }catch(err){
    $('loading').innerHTML=`<p style="max-width:420px;text-align:center">Failed to start 3D: ${err.message}<br>Check WebGL + internet for CDN.</p>`;
    console.error(err);
  }
}

let lastT=0;
function loop(){
  if(state.mode!=='play') return;
  requestAnimationFrame(loop);
  const dt=Math.min(clock.getDelta(),0.05);
  state.time+=dt;
  updatePlayer(dt); updateTitans(dt); updateAllies(dt); updateParticles(dt); updateHUD();
  checkWave();
  // ambient chatter
  if(Math.random()<dt*0.06) squadChatter(Math.random()<0.4?'spot':'help');
  renderer.render(scene,camera);
}

// ---------------- Menu wiring ----------------
function initMenu(){
  document.querySelectorAll('.hero').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.hero').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
  });
  document.querySelectorAll('.server').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.server').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected'); state.server=b.dataset.server;
    $('ping').textContent=b.dataset.ping+'ms';
    updateOnlineUI();
  });
  $('btn-deploy').onclick=deploy;
  $('btn-how').onclick=()=>$('how-panel').classList.toggle('hidden');
  $('btn-resume').onclick=()=>{ hidePause(); $('game-canvas').requestPointerLock?.(); requestAnimationFrame(loop); };
  $('btn-quit').onclick=()=>{ $('pause-screen').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu-screen').classList.remove('hidden'); state.mode='menu'; };
  $('ping').textContent='42ms';
  updateOnlineUI();
  // fake live pings
  setInterval(()=>{ if(state.mode==='menu'){ const p=randi(35,130); } },3000);
  // auto demo render behind menu? start minimal scene for screenshot even before deploy
  state.lowSpec=detectLowSpec();
  try{
    initThree();
    initInput();
    // pre-spawn showcase titans + allies for a lively menu backdrop
    for(let i=0;i<4;i++) spawnTitan(true);
    spawnAllies();
    NetSim.init();
    camera.position.set(40,30,90); camera.lookAt(0,10,0);
    clock=new THREE.Clock();
    (function menuLoop(){
      if(state.mode!=='menu') return;
      requestAnimationFrame(menuLoop);
      const dt=Math.min(clock.getDelta(),0.05); state.time+=dt;
      // slow orbit
      const a=state.time*0.08;
      camera.position.set(Math.sin(a)*120, 42, Math.cos(a)*120);
      camera.lookAt(0,12,0);
      updateTitans(dt); updateAllies(dt); updateParticles(dt);
      renderer.render(scene,camera);
    })();
  }catch(e){ console.warn('menu 3d failed', e); }
  $('loading').style.display='none';
}

initMenu();

// Debug / verification hook (read-only-ish): window.__wor.pos(), .state, .slash(), .hook()
window.__wor = {
  state,
  pos: () => player?.pos.toArray(),
  titans: () => titans.filter(t=>!t.dead).length,
  slash: () => trySlash(),
  hook: (s) => toggleHook(s),
};
