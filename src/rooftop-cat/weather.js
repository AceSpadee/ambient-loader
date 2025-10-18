/* weather.js — ambience & weather effects
   Modes: none | rain | snow | fog | storm
   Exports:
     - initWeather(mode, state, canvas, reduceMotion)
     - advanceLightning(state, dt, canvas)
     - renderLightning(ctx, state, canvas)
*/

function viewSize(canvas){
  // Map backing store size → CSS pixels using the effective DPR
  const cssW = canvas.clientWidth || Math.max(1, Math.round(canvas.width / (window.devicePixelRatio || 1)));
  const effDpr = Math.max(1, canvas.width / cssW);
  const w = Math.floor(canvas.width / effDpr);
  const h = Math.floor(canvas.height / effDpr);
  return { w, h, dpr: effDpr };
}

export function initWeather(mode, state, canvas, reduceMotion){
  state.rain = [];
  state.snow = [];
  state.fog  = [];
  state.fogTex = null;

  // lightning / storm state
  state.lightning = [];
  state.storm = null;

  if (mode === "rain")       initRain(state, canvas, reduceMotion);
  else if (mode === "snow")  initSnow(state, canvas, reduceMotion);
  else if (mode === "fog")   initFog(state, canvas, reduceMotion);
  else if (mode === "storm") initStorm(state, canvas, reduceMotion);
}

/* ---------------- Rain / Snow / Fog ---------------- */

function initRain(state, canvas, reduceMotion){
  const { w, h } = viewSize(canvas);
  const overscan = Math.floor(Math.max(80, w * 0.08));

  // Keep original feel: lighter rain with depth-scaled slant/speed
  // Count scales with area but tracks the original 80/160 around 1280x720.
  const baselineArea = 1280 * 720;
  const k = (w * h) / baselineArea;
  const baseCount = reduceMotion ? 80 : 160;
  const count = Math.max(30, Math.floor(baseCount * k));

  state.rain.length = 0;
  for (let i = 0; i < count; i++){
    const z = Math.random();
    state.rain.push({
      x: Math.random() * (w + overscan) - overscan,
      y: Math.random() * (h + 120) - 120,
      vx: -40 - 40 * z,
      vy: 320 + 380 * z,
      z
    });
  }
}

function initSnow(state, canvas, reduceMotion){
  const { w, h } = viewSize(canvas);
  const overscan = Math.floor(Math.max(80, w * 0.08));

  // Original drift/sway, count scales with area around 80/140 baseline.
  const baselineArea = 1280 * 720;
  const k = (w * h) / baselineArea;
  const baseCount = reduceMotion ? 80 : 140;
  const count = Math.max(20, Math.floor(baseCount * k));

  state.snow.length = 0;
  for (let i = 0; i < count; i++){
    const size = 1 + Math.random() * 2.2;
    state.snow.push({
      x: Math.random() * (w + overscan) - overscan,
      y: Math.random() * (h + 80) - 80,
      vx: -14 - Math.random() * 10,
      vy: 18 + Math.random() * 28,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.6 + Math.random() * 1.2,
      r: size
    });
  }
}

function makeFogTexture(){
  // Bigger, softer fog (your working version)
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128,128,20, 128,128,128);
  grad.addColorStop(0.00, "rgba(220,235,255,0.30)");
  grad.addColorStop(0.50, "rgba(220,235,255,0.20)");
  grad.addColorStop(1.00, "rgba(220,235,255,0.00)");
  g.fillStyle = grad;
  g.fillRect(0,0,256,256);
  return c;
}

function initFog(state, canvas, reduceMotion){
  const { w } = viewSize(canvas);
  const overscan = Math.floor(Math.max(120, w * 0.12));
  const yTop = Math.max(0, state.groundY - 170);
  const yBottom = state.groundY + 36;
  const fogBandH = Math.max(100, yBottom - yTop);

  const count = Math.max(6, Math.floor(w / 140)); // big, soft blobs
  state.fogTex = makeFogTexture();
  state.fog.length = 0;

  for (let i = 0; i < count; i++){
    const r = 80 + Math.random() * 160;
    state.fog.push({
      x: Math.random() * (w + overscan) - overscan * 0.5,
      y: yTop + Math.random() * fogBandH,
      r,
      vx: -20 - Math.random() * 25,
      a: 0.35 + Math.random() * 0.25,
      phi: Math.random() * Math.PI * 2,
      swaySpeed: 0.8 + Math.random() * 1.2
    });
  }
}

/* ---------------- Storm (heavier rain + original lightning) ---------------- */

function initStorm(state, canvas, reduceMotion){
  const { w, h } = viewSize(canvas);
  const overscan = Math.floor(Math.max(80, w * 0.08));

  // Heavier rain than initRain, with original storm speeds.
  const baselineArea = 1280 * 720;
  const k = (w * h) / baselineArea;
  const baseCount = reduceMotion ? 180 : 320; // > rain
  const count = Math.max(60, Math.floor(baseCount * k));

  state.rain.length = 0;
  for (let i = 0; i < count; i++){
    const z = Math.random();
    state.rain.push({
      x: Math.random() * (w + overscan) - overscan,
      y: Math.random() * (h + 120) - 120,
      vx: -80 - 70 * z,      // stronger wind
      vy: 420 + 520 * z,     // faster drops
      z
    });
  }

  // Lightning state (original schedule/flash)
  state.lightning = [];
  state.storm = {
    rm: !!reduceMotion,
    flash: 0,
    nextBolt: (reduceMotion ? 3.5 : 3.0) + Math.random() * (reduceMotion ? 4.5 : 3.5),
  };
}

/* ---------------- Lightning (original look & timing) ---------------- */

export function advanceLightning(state, dt, canvas){
  if (!state.storm) return;

  // spawn schedule
  state.storm.nextBolt -= dt;
  if (state.storm.nextBolt <= 0){
    spawnLightning(state, canvas);
    const minGap = state.storm.rm ? 3.0 : 2.5;
    const maxGap = state.storm.rm ? 6.0 : 5.0;
    state.storm.nextBolt = minGap + Math.random() * (maxGap - minGap);
  }

  // fade flash
  if (state.storm.flash > 0){
    state.storm.flash = Math.max(0, state.storm.flash - dt * 0.6);
  }

  // age + cull
  for (const b of state.lightning) b.age += dt;
  while (state.lightning.length && state.lightning[0].age > state.lightning[0].life){
    state.lightning.shift();
  }
}

export function renderLightning(ctx, state, canvas){
  if (!state.storm) return;

  const { w, h } = viewSize(canvas);

  // bolts
  if (state.lightning.length){
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const bolt of state.lightning){
      const k = 1 - (bolt.age / bolt.life);
      const jitter = 0.75 + Math.random() * 0.25;

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

function strokePath(ctx, pts){
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function spawnLightning(state, canvas){
  const { w } = viewSize(canvas);
  const gy = state.groundY;

  // Original path: from high sky down toward mid-sky above buildings
  const x0 = 40 + Math.random() * (w - 80);
  const y0 = 30 + Math.random() * 120;
  const y1 = gy - (140 + Math.random() * 100);
  const steps = 10 + Math.floor(Math.random() * 5);

  const pts = [];
  let x = x0;
  for (let i = 0; i <= steps; i++){
    const t = i / steps;
    const ny = y0 + (y1 - y0) * t + (Math.random() * 8 - 4);
    const jitter = (1 - t) * 28; // bigger sideways near top
    x += (Math.random() * 2 - 1) * jitter * 0.6;
    pts.push({ x, y: ny });
  }

  // small downward branches
  const branches = [];
  for (let i = 2; i < pts.length - 2; i++){
    if (Math.random() < 0.25){
      const b = [pts[i]];
      let bx = pts[i].x, by = pts[i].y;
      const len = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < len; k++){
        bx += (Math.random() * 14 - 7);
        by += (Math.random() * 20 + 10);
        b.push({ x: bx, y: by });
      }
      branches.push(b);
    }
  }

  state.lightning.push({ pts, branches, life: 0.22, age: 0 });
  state.storm.flash = Math.max(state.storm.flash, 0.35);
}
