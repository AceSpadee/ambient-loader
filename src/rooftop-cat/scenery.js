// scenery.js
import { pick, shade } from "./utils.js";
import { PALETTE } from "./palette.js";
import { roundRect } from "./utils.js";

// ---- generation (positions & structure) ----
export function makeScenery(canvas, groundY, reduceMotion){
  return {
    stars: makeStars(canvas, reduceMotion),
    clouds: makeClouds(canvas, reduceMotion),
    skyline: makeSkyline(canvas),
    ...makeCityLayers(canvas, groundY),
  };
}

export function makeSkyline(canvas){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const baseY = h - 260;
  const polys = [];
  let x = -80;
  while (x < w + 200) {
    const bw = 60 + Math.random() * 120;
    const bh = 100 + Math.random() * 220;
    polys.push({ x, y: baseY - bh, w: bw, h: bh, roof: Math.random() < 0.5 ? "flat" : "spike" });
    x += bw + Math.random() * 40;
  }
  return polys;
}

export function makeCityLayers(canvas, gy) {
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const backTall = [], frontTall = [], backSmallBottom = [], frontSmallBottom = [];

  for (let i = 0; i < 18; i++) {
    const isFront = Math.random() < 0.4;
    const bw = 80 + Math.random() * 160;
    const bh = 220 + Math.random() * 240;
    const x = Math.random() * (w + 400) - 200;
    const yTop = gy - bh;
    const b = makeBuildingObj(x, yTop, bw, bh, /*scale=*/2, false);
    decorateTall(b, isFront);
    (isFront ? frontTall : backTall).push(b);
  }

  const bottomPad = 8;
  for (let i = 0; i < 24; i++) {
    const isFront = Math.random() < 0.5;
    const bw = 60 + Math.random() * 110;
    const bh = 80 + Math.random() * 140;
    const x = Math.random() * (w + 400) - 200;
    const yTop = h - bh - bottomPad;
    const b = makeBuildingObj(x, yTop, bw, bh, /*scale=*/1, true);
    (isFront ? frontSmallBottom : backSmallBottom).push(b);
  }

  return { backTall, frontTall, backSmallBottom, frontSmallBottom };
}

export function makeBuildingObj(x, y, w, h, scaleFlag, silhouette = false) {
  return {
    x, y, w, h,
    windows: silhouette ? null : makeWindows(w, h, scaleFlag),
    twinkleT: 0,
    twinkleRate: 1.2 + Math.random() * 2,
    hasBillboard: !silhouette && scaleFlag === 1 && Math.random() < 0.12,
    scaleFlag,
    silhouette,
    silDetail: silhouette ? makeBottomDetail(w, h) : null,
    panelStep: 0, panelAlpha: 0,
    roof: [],
    layer: silhouette ? "bottom" : "tall",
    baseColor: null,
    // stable per-building seed to avoid window flicker when extended below deck
    seed: (Math.random() * 0x7fffffff) | 0,
  };
}

export function decorateTall(b, isFront) {
  b.panelStep = 16 + Math.floor(Math.random() * 10);
  b.panelAlpha = isFront ? 0.12 : 0.08;
  b.baseColor = isFront ? pick(PALETTE.frontTallVariants) : pick(PALETTE.backTallVariants);
  b.layer = isFront ? "frontTall" : "backTall";

  b.roof = [];
  if (Math.random() < 0.40) b.roof.push({ kind: "tank", dx: 8 + Math.random() * (b.w - 40), dy: -12 });
  if (Math.random() < (isFront ? 0.28 : 0.18)) b.roof.push({ kind: "dishSmall", dx: 10 + Math.random() * (b.w - 20), dy: 6 });
  if (Math.random() < 0.25) b.roof.push({ kind: "pipe", dx: 8 + Math.random() * (b.w - 30), dy: 2, w: 24 + Math.random() * 24 });
  if (isFront && Math.random() < 0.18) b.roof.push({ kind: "waterTower", dx: 10 + Math.random() * (b.w - 38), dy: -6 });
  if (isFront && Math.random() < 0.26) b.roof.push({ kind: "hvac", dx: 8 + Math.random() * (b.w - 32), dy: 2, w: 18 + Math.random()*18 });
  if (isFront && Math.random() < 0.22) b.roof.push({ kind: "fan", dx: 8 + Math.random() * (b.w - 24), dy: 0, rot: Math.random()*Math.PI*2, rs: 0.8 + Math.random()*1.6 });
  if (isFront && Math.random() < 0.25) b.roof.push({ kind: "vent", dx: 12 + Math.random() * (b.w - 32), dy: 4, emit: 0 });
}

export function makeBottomDetail(bw, bh) {
  const roofSteps = [];
  let x = 4;
  const stepCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < stepCount; i++) {
    const w = 12 + Math.random() * Math.min(48, bw * 0.35);
    const h = 6 + Math.random() * 16;
    if (x + w > bw - 6) break;
    roofSteps.push({ x, w, h });
    x += w + 4 + Math.random() * 10;
  }

  const vents = [];
  const ventCount = Math.floor(Math.random() * 3);
  for (let i = 0; i < ventCount; i++) {
    vents.push({ x: 6 + Math.random() * (bw - 18), w: 6 + Math.random() * 8, h: 3 + Math.random() * 4 });
  }

  const slits = [];
  const cols = Math.max(2, Math.floor(bw / 14));
  for (let c = 0; c < cols; c++) {
    if (Math.random() < 0.18) {
      const sx = 6 + c * 14 + Math.random() * 4;
      const sy = 10 + Math.random() * Math.max(6, bh - 28);
      slits.push({ x: sx, y: sy, h: 6 + Math.random() * 12 });
    }
  }

  const pipe = Math.random() < 0.35 ? { y: bh - (8 + Math.random() * 18), w: 20 + Math.random() * (bw * 0.5), t: 3 } : null;
  const rail = Math.random() < 0.25 ? { x: 6, w: Math.max(0, bw - 12) } : null;

  return { roofSteps, vents, slits, pipe, rail };
}

export function makeWindows(bw, bh, scaleFlag) {
  const cellX = scaleFlag === 2 ? 14 : 12;
  const cellY = scaleFlag === 2 ? 18 : 16;
  const cols = Math.max(3, Math.floor(bw / cellX));
  const rows = Math.max(4, Math.floor(bh / cellY));
  const lit = new Set();
  const warm = new Set();
  const density = scaleFlag === 2 ? 0.24 : 0.18;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const id = r * 1000 + c;
      if (Math.random() < density) {
        lit.add(id);
        if (Math.random() < 0.8) warm.add(id);
      }
    }
  }
  return { cols, rows, cellX, cellY, lit, warm };
}

export function makeClouds(canvas, reduceMotion){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const list = [];
  const count = reduceMotion ? 3 : 6;
  for (let i=0;i<count;i++) list.push({ x: Math.random()*w, y: 40 + Math.random()*120, s: 0.8 + Math.random()*1.6, v: 12 + Math.random()*18, a: 0.2 + Math.random()*0.15 });
  return list;
}
export function makeStars(canvas, reduceMotion){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr, h = canvas.height / dpr;
  const list=[]; const n = reduceMotion ? 70 : 120;
  for(let i=0;i<n;i++) list.push({x:Math.random()*w,y:Math.random()*(h*0.5),a:0.4+Math.random()*0.6,p:Math.random()*Math.PI*2});
  return list;
}

// ---- drawing (background + buildings) ----
export function drawCloud(ctx, x, y, s=1, a=0.3){
  ctx.save(); ctx.translate(x,y); ctx.scale(s,s); ctx.globalAlpha=a; ctx.fillStyle="#e8edff";
  cloudBlob(ctx,0,0,30); cloudBlob(ctx,20,-6,24); cloudBlob(ctx,-22,-4,22); cloudBlob(ctx,6,4,26);
  ctx.globalAlpha=1; ctx.restore();
}
function cloudBlob(ctx,x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }

/* -------------------- deterministic noise helpers for stable extra rows ------------------- */
function __hash32(n){ n|=0; n^=n<<13; n^=n>>>17; n^=n<<5; return (n>>>0); }
function __rand01(seed){ return __hash32(seed) / 4294967295; } // 0..1
/* ------------------------------------------------------------------------------------------ */

export function drawBuilding(ctx, b){
  const baseColor = b.baseColor || (b.layer === "frontTall" ? PALETTE.frontTall : PALETTE.backTall);
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, baseColor); g.addColorStop(1, shade(baseColor, -10));
  ctx.fillStyle = g;
  roundRect(ctx, b.x, b.y, b.w, b.h, 2, true);

  // Panel lines (fill full current height)
  if (b.panelStep > 0) {
    ctx.save();
    for (let y = b.y + 6; y < b.y + b.h - 6; y += b.panelStep) {
      ctx.globalAlpha = b.panelAlpha; ctx.strokeStyle = PALETTE.panelLight; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x + 2, y); ctx.lineTo(b.x + b.w - 2, y); ctx.stroke();
      ctx.globalAlpha = b.panelAlpha * 0.7; ctx.strokeStyle = PALETTE.panelDark;
      ctx.beginPath(); ctx.moveTo(b.x + 2, y + 2); ctx.lineTo(b.x + b.w - 2, y + 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Roof props (stay at top)
  if (b.roof && b.roof.length) for (const rp of b.roof) drawRoofProp(ctx, b, rp);

  // Windows — extend pattern to the *current* height
  const win = b.windows;
  if (!win) return;

  const padX = 6, padY = 8;
  const startX = b.x + padX, startY = b.y + padY;
  const wW = 3, wH = 5;

  const cellX = win.cellX, cellY = win.cellY;
  const cols  = win.cols;
  const rowsFit = Math.max(4, Math.floor((b.h - padY * 2) / cellY)); // how many rows fit now

  const origRows = win.rows;
  const density  = (b.scaleFlag === 2 ? 0.24 : 0.18);
  const warmProb = 0.80;

  const windowAlpha = (b.layer === "backTall" ? 0.55 : 0.9);
  const seedBase = (b.seed >>> 0); // stable per building

  ctx.save();
  for (let r = 1; r < rowsFit - 1; r++){
    for (let c = 1; c < cols - 1; c++){
      const id = r * 1000 + c;

      let lit, warm;
      if (r < origRows - 1) {
        // within authored grid (above deckline): keep exactly as generated + twinkle
        lit  = win.lit.has(id);
        warm = win.warm.has(id);
      } else {
        // rows that didn't exist originally (below deck): deterministic extension
        const h1 = __rand01(seedBase ^ (r * 374761393) ^ (c * 668265263));
        lit = h1 < density;
        const h2 = __rand01(seedBase ^ 0x9e3779b9 ^ (r * 1274126177) ^ (c * 2246822519));
        warm = lit && (h2 < warmProb);
      }

      if (!lit) continue;
      const wx = startX + c * cellX;
      const wy = startY + r * cellY;
      ctx.fillStyle   = warm ? PALETTE.windowWarm : PALETTE.windowCool;
      ctx.globalAlpha = windowAlpha;
      ctx.fillRect(wx, wy, wW, wH);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawRoofProp(ctx, b, rp){
  const x = b.x + (rp.dx || 0);
  const y = b.y + (rp.dy || 0);
  const dim = b.layer === "backTall";

  if (rp.kind === "tank") {
    ctx.fillStyle = dim ? shade(PALETTE.roofProp, -10) : PALETTE.roofProp;
    roundRect(ctx, x, y, 22, 14, 3, true);
    ctx.fillStyle = dim ? shade(PALETTE.roofPropLight, -20) : PALETTE.roofPropLight;
    ctx.fillRect(x + 4, y + 10, 14, 2);
  } else if (rp.kind === "dishSmall") {
    ctx.strokeStyle = dim ? shade(PALETTE.roofPropLight, -20) : PALETTE.roofPropLight;
    ctx.globalAlpha = dim ? 0.7 : 1;
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, Math.PI * 0.2, Math.PI * 1.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 6); ctx.stroke(); ctx.globalAlpha = 1;
  } else if (rp.kind === "pipe") {
    ctx.fillStyle = dim ? shade(PALETTE.roofProp, -10) : PALETTE.roofProp;
    roundRect(ctx, x, y, rp.w || 28, 6, 3, true);
  } else if (rp.kind === "fan") {
    const rot = rp.rot || 0;
    ctx.save(); ctx.translate(x+10, y+4);
    ctx.globalAlpha = dim ? 0.6 : 0.9;
    ctx.fillStyle = dim ? shade(PALETTE.roofPropLight, -25) : PALETTE.roofPropLight;
    ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill();
    ctx.rotate(rot);
    for (let i=0;i<3;i++){ ctx.rotate((Math.PI*2)/3); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(12,2); ctx.lineTo(12,-2); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  } else if (rp.kind === "vent") {
    ctx.fillStyle = dim ? shade(PALETTE.roofProp, -10) : PALETTE.roofProp;
    roundRect(ctx, x, y, 10, 8, 2, true);
  } else if (rp.kind === "waterTower") {
    ctx.save(); ctx.translate(x+10, y-10);
    ctx.globalAlpha = dim ? 0.7 : 1;
    ctx.fillStyle = dim ? shade(PALETTE.roofPropLight, -25) : PALETTE.roofPropLight;
    roundRect(ctx, -10, 2, 20, 14, 4, true);
    ctx.beginPath(); ctx.moveTo(-10,2); ctx.lineTo(0,-4); ctx.lineTo(10,2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dim ? shade(PALETTE.roofProp, -20) : PALETTE.roofProp;
    ctx.fillRect(-8, 16, 3, 6); ctx.fillRect(5, 16, 3, 6);
    ctx.restore();
  } else if (rp.kind === "hvac") {
    ctx.fillStyle = dim ? shade(PALETTE.roofProp, -15) : PALETTE.roofProp;
    roundRect(ctx, x, y, rp.w || 24, 8, 2, true);
    ctx.fillStyle = dim ? shade(PALETTE.roofPropLight, -25) : PALETTE.roofPropLight;
    ctx.fillRect(x+4, y+2, (rp.w||24)-8, 2);
  }
}

export function drawSilhouette(ctx, b){
  roundRect(ctx, b.x, b.y, b.w, b.h, 3, true);
  const d = b.silDetail; if (!d) return;

  ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#ffffff"; ctx.fillRect(b.x + 1, b.y, b.w - 2, 1); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = "#000000"; for (const s of d.roofSteps) { roundRect(ctx, b.x + s.x, b.y - s.h, s.w, s.h, 2, true); } ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = "#ffffff"; for (const v of d.vents) { roundRect(ctx, b.x + v.x, b.y + 6, v.w, v.h, 1, true); } ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.08; ctx.fillStyle = "#ffffff"; for (const s of d.slits) { ctx.fillRect(b.x + s.x, b.y + s.y, 2, s.h); } ctx.restore();
  if (d.pipe) { ctx.save(); ctx.globalAlpha = 0.14; ctx.fillStyle = "#ffffff"; roundRect(ctx, b.x + 6, b.y + d.pipe.y, d.pipe.w, d.pipe.t, 2, true); ctx.restore(); }
  if (d.rail) { ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = "#ffffff"; ctx.fillRect(b.x + d.rail.x, b.y - 2, d.rail.w, 1); ctx.restore(); }
}
