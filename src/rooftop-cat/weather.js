// Weather init & fog texture
export function initWeather(mode, state, canvas, reduceMotion){
  state.rain = []; state.snow = []; state.fog = []; state.fogTex = null;

  // lightning / storm book-keeping (cleared on every init)
  state.lightning = [];
  state.storm = null;

  if (mode === "rain")      initRain(state, canvas, reduceMotion);
  else if (mode === "snow") initSnow(state, canvas, reduceMotion);
  else if (mode === "fog")  initFog(state, canvas, reduceMotion);
  else if (mode === "storm") initStorm(state, canvas, reduceMotion); // NEW
}

export function initRain(state, canvas, reduceMotion){
  state.rain = [];
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const count = reduceMotion ? 80 : 160;
  for (let i=0;i<count;i++){
    const z = Math.random();
    state.rain.push({ x: Math.random()*w, y: Math.random()*h, vx: -40 - 40*z, vy: 320 + 380*z, z });
  }
}

export function initSnow(state, canvas, reduceMotion){
  state.snow = [];
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const count = reduceMotion ? 80 : 140;
  for (let i=0;i<count;i++){
    const size = 1 + Math.random()*2.2;
    state.snow.push({ x: Math.random()*w, y: Math.random()*h, vx: -14 - Math.random()*10, vy: 18 + Math.random()*28, sway: Math.random()*Math.PI*2, swaySpeed: 0.6 + Math.random()*1.2, r: size });
  }
}

function makeFogTexture(){
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64,64,8, 64,64,64);
  grd.addColorStop(0.0, "rgba(210,220,240,0.32)");
  grd.addColorStop(0.4, "rgba(210,220,240,0.20)");
  grd.addColorStop(1.0, "rgba(210,220,240,0.0)");
  g.fillStyle = grd;
  g.fillRect(0,0,128,128);
  return c;
}
export function initFog(state, canvas, reduceMotion){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const gy = state.groundY;

  state.fogTex = makeFogTexture();
  state.fog = [];

  const count = reduceMotion ? 22 : 46;
  for (let i=0;i<count;i++){
    const layer = Math.random()<0.45 ? 0 : (Math.random()<0.7 ? 1 : 2);
    const baseR = layer===2 ? 140 : (layer===1 ? 110 : 90);
    const r = baseR + Math.random()*80;
    const yMin = gy - 170, yMax = gy + 36;
    const y = yMin + Math.random()*(yMax - yMin);
    const x = -120 + Math.random()*(w + 240);
    const vx = -(layer===2 ? 22 : layer===1 ? 16 : 10) - Math.random()*6;
    const a = (layer===2 ? 0.16 : layer===1 ? 0.12 : 0.08);
    const swayAmp = 8 + Math.random()*16;
    const swaySpeed = 0.3 + Math.random()*0.8;
    const phi = Math.random()*Math.PI*2;
    state.fog.push({x,y,r,a,vx,layer,swayAmp,swaySpeed,phi});
  }
}

export function initStorm(state, canvas, reduceMotion){
  // 1) Heavy, slanted rain
  state.rain = [];
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  const count = reduceMotion ? 180 : 320; // more than regular rain
  for (let i = 0; i < count; i++){
    const z = Math.random();              // depth
    state.rain.push({
      x: Math.random()*w,
      y: Math.random()*h,
      vx: -80 - 70*z,                     // stronger wind
      vy: 420 + 520*z,                    // faster drops
      z
    });
  }

  // 2) Lightning state
  state.lightning = [];                   // active bolts
  state.storm = {
    rm: !!reduceMotion,
    flash: 0,                             // screen flash alpha
    nextBolt: (reduceMotion ? 3.5 : 3.0) + Math.random()*(reduceMotion ? 4.5 : 3.5),
  };
}

// Update lightning timers + fade bolts/flash
export function advanceLightning(state, dt, canvas){
  if (!state.storm) return;

  // spawn schedule
  state.storm.nextBolt -= dt;
  if (state.storm.nextBolt <= 0){
    spawnLightning(state, canvas);
    const minGap = state.storm.rm ? 3.0 : 2.5;
    const maxGap = state.storm.rm ? 6.0 : 5.0;
    state.storm.nextBolt = minGap + Math.random()*(maxGap - minGap);
  }

  // fade flash
  if (state.storm.flash > 0){
    state.storm.flash = Math.max(0, state.storm.flash - dt*0.6);
  }

  // age bolts
  for (const b of state.lightning) b.age += dt;
  while (state.lightning.length && state.lightning[0].age > state.lightning[0].life) {
    state.lightning.shift();
  }
}

// Draw bolts + global flash (call from render)
export function renderLightning(ctx, state, canvas){
  if (!state.storm) return;

  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  // bolts
  if (state.lightning.length){
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const bolt of state.lightning){
      const k = 1 - (bolt.age / bolt.life);   // 1 → 0
      const jitter = 0.75 + Math.random()*0.25;

      // outer glow
      ctx.globalAlpha = 0.55 * k * jitter;
      ctx.strokeStyle = "#8bd3ff";
      ctx.lineWidth = 6;
      strokePath(ctx, bolt.pts);

      // core
      ctx.globalAlpha = 0.9 * k;
      ctx.strokeStyle = "#eef7ff";
      ctx.lineWidth = 2.4;
      strokePath(ctx, bolt.pts);

      // branches
      ctx.globalAlpha = 0.85 * k;
      ctx.lineWidth = 1.8;
      for (const br of bolt.branches) strokePath(ctx, br);
    }

    ctx.restore();
  }

  // screen flash
  if (state.storm.flash > 0){
    ctx.save();
    ctx.globalAlpha = Math.min(0.45, state.storm.flash);
    ctx.fillStyle = "rgba(180,205,245,0.90)";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// --- helpers ---
function strokePath(ctx, pts){
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function spawnLightning(state, canvas){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const gy = state.groundY;

  // path from high in the sky, down toward mid-sky (above buildings)
  const x0 = 40 + Math.random()*(w - 80);
  const y0 = 30 + Math.random()*120;
  const y1 = gy - (140 + Math.random()*100);
  const steps = 10 + Math.floor(Math.random()*5);

  const pts = [];
  let x = x0, y = y0;
  for (let i = 0; i <= steps; i++){
    const t = i/steps;
    const ny = y0 + (y1 - y0)*t + (Math.random()*8 - 4);
    const jitter = (1 - t) * 28;                   // bigger sideways near top
    x += (Math.random()*2 - 1) * jitter * 0.6;
    pts.push({ x, y: ny });
  }

  // small branches shooting off downward
  const branches = [];
  for (let i = 2; i < pts.length - 2; i++){
    if (Math.random() < 0.25){
      const b = [pts[i]];
      let bx = pts[i].x, by = pts[i].y;
      const len = 2 + Math.floor(Math.random()*3);
      for (let k = 0; k < len; k++){
        bx += (Math.random()*14 - 7);
        by += (Math.random()*20 + 10);
        b.push({ x: bx, y: by });
      }
      branches.push(b);
    }
  }

  state.lightning.push({ pts, branches, life: 0.22, age: 0 });
  state.storm.flash = Math.max(state.storm.flash, 0.35);   // pop the screen flash
}