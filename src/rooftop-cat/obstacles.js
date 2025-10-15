// obstacles.js (top section)

// imports
import { pickWeighted, shade, clamp } from "./utils.js";
import { roundRect, roundRectPath, neonStrokePath } from "./utils.js";
import { PALETTE } from "./palette.js";

// ---------------------------------------------------------------------------
// Skylight / gap helpers (kept in sync with drawDeck’s gap calculation)
// drawDeck turns a skylight’s width into a gap by subtracting a fixed pad
// on both sides. Keep this identical here so width ↔ gap mapping is exact.
export const SKYLIGHT_GAP_PAD = 8;

/**
 * Estimate a fair jumpable gap range as speed increases.
 * Tune these numbers to taste; they match current jump physics.
 */
export function jumpableGapRange(state){
  const v = Math.max(280, Math.min(1200, state.speed)); // clamp for stability
  // At baseSpeed≈340 → ~100..180px
  // At maxSpeed≈1200 → ~150..280px
  const min = 80 + 0.06 * v;
  const max = 130 + 0.15 * v;
  return { min, max };
}

/**
 * Pick a target gap width within the allowed range with a slight
 * “easier” bias (bias < 0.5). Increase bias for easier average gaps.
 */
export function pickGapWidth(state){
  const { min, max } = jumpableGapRange(state);
  const bias = 0.35;                 // 0.35 → skews mildly easier
  const t = Math.pow(Math.random(), bias);
  return min + t * (max - min);
}

// helper: where the last gap ended (so we keep enough runway between gaps)
export function lastSkylightRight(state){
  // Prefer the new gap list
  if (state.deckGaps && state.deckGaps.length){
    const last = state.deckGaps[state.deckGaps.length - 1];
    // deckGaps store the *actual* gap width; add the pad on both sides to
    // approximate the visual/deck footprint for spacing checks.
    return last.x + last.w + SKYLIGHT_GAP_PAD * 2;
  }
  // Fallback if any legacy skylight obstacles still exist
  let r = -Infinity;
  for (let i = state.obstacles.length - 1; i >= 0; i--){
    const o = state.obstacles[i];
    if (o.type !== "skylight") continue;
    r = o.x + o.w;
    break;
  }
  return r;
}

// -------- spawner --------
export function spawnObstacle(state, canvas){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const gy = state.groundY;

  const spawnX = w + 40;          // where new obstacles are born
  const speed  = Math.max(120, state.speed);
  const MARGIN = 160;              // small visual safety pad (px)

  // --- guard 1: if any existing WIRE still spans spawnX, wait until its right pole clears
  {
    let blockRight = -Infinity;
    for (const o of state.obstacles){
      if (o.type !== "wire") continue;
      const left = o.x;
      const right = o.x + o.w;
      if (spawnX >= left - MARGIN && spawnX <= right + MARGIN) {
        if (right > blockRight) blockRight = right;
      }
    }
    if (blockRight > -Infinity) {
      const remaining = (blockRight + MARGIN) - spawnX;   // pixels the right pole must travel
      if (remaining > 0) {
        const delay = Math.max(0.08, remaining / speed);  // seconds until safe
        return delay; // defer spawn; try again soon
      }
    }
  }

  const speedFactor = (state.speed - state.baseSpeed) / (state.speedMax - state.baseSpeed);
  const extraSpan = Math.max(0, speedFactor) * 160;

  const pick = pickWeighted([
    ["chimney",      22],
    ["antenna",      16],
    ["hvac",         14],
    ["skylight",     40],
    ["vent_pipe",    10],
    ["access_shed",  9],
    ["water_tank",    6],
    ["billboard",     4],
    ["water_tower_gate", 8],
    ["wire",         17],
  ]);

  // --- guard 2: if we picked a WIRE, avoid placing it above a current ground obstacle
  if (pick === "wire") {
    let blockRight = -Infinity;
    for (const o of state.obstacles){
      if (o.type === "wire") continue;     // already handled above
      const left = o.x, right = o.x + o.w;
      if (spawnX >= left - MARGIN && spawnX <= right + MARGIN) {
        if (right > blockRight) blockRight = right;
      }
    }
    if (blockRight > -Infinity) {
      const remaining = (blockRight + MARGIN) - spawnX;
      if (remaining > 0) {
        const delay = Math.max(0.08, remaining / speed);
        return delay; // defer the wire so it won't overlap the ground piece
      }
    }
  }

  // --- create the obstacle
  if (pick === "chimney") {
    // One consistent brick-stack chimney (taper + cap are handled in drawChimney)
    const bw = 26 + Math.random() * 20;  // ~26–46 px wide
    const bh = 44 + Math.random() * 34;  // ~44–78 px tall

    state.obstacles.push({
      type: "chimney",
      x: spawnX,          // use your computed spawnX (w + 40)
      y: gy - bh,
      w: bw,
      h: bh
    });
  } else if (pick === "antenna") {
    const sr = Math.max(0, Math.min(1,
      (state.speed - state.baseSpeed) / (state.speedMax - state.baseSpeed + 1e-6)
    ));
    const wantPylon = Math.random() < (0.45 + 0.25*sr);

    if (!wantPylon) {
      // classic mast
      const bw = 12 + Math.random()*10, bh = 64 + Math.random()*52;
      state.obstacles.push({ type:"antenna", variant:"mast", x:w+40, y:gy-bh, w:bw, h:bh });
    } else {
      // >>> 1.5x larger pylon <<<
      const SCALE = 1.5;
      const bw = (56 + Math.random()*32) * SCALE;
      const bh = (110 + Math.random()*46) * SCALE;

      const duckH = state.playerCtx ? state.playerCtx.duckH : 24;
      const clearance = Math.max(duckH + 10, 34);

      state.obstacles.push({
        type:"antenna",
        variant:"pylon",
        x:w+40, y:gy-bh, w:bw, h:bh,
        baseY: gy,
        clearance,
        colliders(){
          const yClear = this.baseY - this.clearance;
          const cx = this.x + this.w/2;
          const coreW = Math.max(12, this.w * 0.30);
          const spine = { x: cx - coreW/2, y: this.y, w: coreW, h: Math.max(1, yClear - this.y) };
          const armY  = this.y + Math.max(12, this.h * 0.26);
          const arm   = { x: cx - Math.max(16, this.w*0.40)/2, y: armY - 4, w: Math.max(16, this.w*0.40), h: 8 };
          return [spine, arm];
        }
      });
    }
  } else if (pick === "hvac") {
    const bw=44+Math.random()*36, bh=22+Math.random()*12;
    state.obstacles.push({type:"hvac",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "skylight") {
    // Treat skylight as a GAP ONLY (no obstacle pushed/drawn)

    // Ensure enough runway from the previous gap.
    const dpr = (window.devicePixelRatio || 1);
    const w   = canvas.width / dpr;
    const spawnX = w + 40;
    const speed  = Math.max(120, state.speed);

    const needRunway = 160 + (state.speed - state.baseSpeed) * 0.18; // tweakable
    const lastR = lastSkylightRight(state);
    if (lastR > -Infinity) {
      const runway = spawnX - lastR;
      if (runway < needRunway) {
        const remain = needRunway - runway;
        const delay  = Math.max(0.06, remain / speed);
        return delay; // try again soon
      }
    }

    // Pick a jumpable gap at current speed
    const gapW = Math.round(pickGapWidth(state));

    // Create the under-deck gap span (world-space).
    // We offset by the pad so the under-deck dark opening aligns with the
    // visual rails and the “former skylight footprint”.
    const gapLeft = spawnX + SKYLIGHT_GAP_PAD;

    if (!state.deckGaps) state.deckGaps = [];
    state.deckGaps.push({ x: gapLeft, w: gapW });

    // NOTE: We do NOT push an obstacle. drawObstacles() won’t render anything.
    // The under-deck renderer will show the gap and rails; collisions handled in update().
  } else if (pick === "vent_pipe") {
    // Thicker diameter (old was bh = 32)
    const bh = 44;

    // same length tiers as before
    const tier = pickWeighted([
      ["medium", 5],
      ["long",   4],
      ["xlong",  2],
    ]);

    // width (length) ranges per tier
    const MED_MIN = 84,  MED_MAX = 108;
    const LONG_MIN = 112, LONG_MAX = 148;
    const XL_MIN  = 156,  XL_MAX  = 220;

    let bw;
    if (tier === "medium")      bw = MED_MIN + Math.random() * (MED_MAX - MED_MIN);
    else if (tier === "long")   bw = LONG_MIN + Math.random() * (LONG_MAX - LONG_MIN);
    else                        bw = XL_MIN  + Math.random() * (XL_MAX  - XL_MIN);

    // keep thickness controlled by height, not width
    const minWidthForConstantR = Math.ceil(bh * (0.30 / 0.18)) + 4;
    bw = Math.max(bw, minWidthForConstantR, MED_MIN);

    // straight-run fraction (unchanged feel)
    const runFrac =
      tier === "medium" ? (0.80 + Math.random() * 0.10) :
      tier === "long"   ? (0.88 + Math.random() * 0.07) :
                          (0.90 + Math.random() * 0.05);

    // always draw brackets (your draw fn places the first near the grille)
    const brackets = true;

    state.obstacles.push({
      type: "vent_pipe",
      x: w + 40,
      y: gy - bh,
      w: bw,
      h: bh,
      runFrac,
      brackets
    });
  } else if (pick === "access_shed") {
    const bw=36+Math.random()*24, bh=34+Math.random()*20;
    state.obstacles.push({type:"access_shed",x:w+40,y:gy-bh,w:bw,h:bh,roofDir:Math.random()<0.5?-1:1});
  } else if (pick === "water_tank") {
    const bw = 96 + Math.random()*54;  // base width
    const bh = 46 + Math.random()*14;  // base height

    // Randomly choose between the two tank styles
    const variant = Math.random() < 0.5 ? "drum" : "poly_round";

    let ww = bw, hh = bh;

    if (variant === "poly_round") {
      // Tiny height bump (tweak 4–8px to taste)
      const polyExtraH = 6;
      hh = Math.round(bh + polyExtraH);

      // Keep the squat look: ~2× width relative to the (new) height
      const desiredW = Math.round((hh - 2) * 2.0 + 12);
      ww = Math.max(bw, desiredW);
    }

    state.obstacles.push({
      type: "water_tank",
      x: w + 40,
      y: gy - hh,
      w: ww,
      h: hh,
      variant
    });
  } else if (pick === "billboard") {
    const bw = 110 + Math.random()*70, bh = 56 + Math.random()*28;

    const variant = pickWeighted([
      ["classic", 3],
      ["slats",   4],
      ["led",     3],
      ["wood",    3],
    ]);

    state.obstacles.push({
      type: "billboard",
      x: w + 40, y: gy - bh, w: bw, h: bh,
      variant, // <- optional: forces a specific face look
    });
  } else if (pick === "water_tower_gate") {
    const bw = 84 + Math.random()*36;
    const clearance = 26 + Math.floor(Math.random()*4);
    const beamH = 12;
    const stem = 28 + Math.random()*22;
    const tankH = 56 + Math.random()*20;
    const y = gy - (clearance + beamH);

    state.obstacles.push({
      type: "water_tower_gate",
      x: w + 40,
      y,
      w: bw,
      h: beamH,
      clearance,
      stem,
      tankH,
      baseY: gy,

      // Split colliders: (1) narrow duck bar, (2) full tower above it
      colliders(){
        const inset = Math.max(10, this.w * 0.18);
        const legW  = Math.max(4, Math.min(7, this.w * 0.08));
        const innerL = this.x + inset + legW + 2;
        const innerR = this.x + this.w - inset - legW - 2;
        const barW   = Math.max(20, innerR - innerL);
        const duckBar = { x: innerL, y: this.y, w: barW, h: this.h };

        const legH      = this.clearance + this.h + this.stem;
        const platformY = this.baseY - legH;
        const tankPad   = 6;
        const tankTopY  = platformY - tankPad - this.tankH;
        const capExtra  = 12; // include tiny cap/vent you draw above
        const towerTopY = tankTopY - capExtra;
        const towerH    = this.y - towerTopY;

        const tower = { x: this.x, y: towerTopY, w: this.w, h: Math.max(0, towerH) };
        return [duckBar, tower];
      }
    });
  } else { // wire
    const span  = 140 + Math.random()*140 + extraSpan;
    const y     = gy - (48 + Math.random()*26);
    const sag   = 10 + Math.random()*20;
    const poleH = 28 + Math.random()*16;

    state.obstacles.push({
      type: "wire",
      x: w + 40,
      y,
      w: span,
      h: 4,
      sag,
      poleH,
      baseY: gy,

      // Poles + segmented AABBs along the sagging cable
      colliders(){
        const x1 = this.x, x2 = this.x + this.w;
        const y  = this.y;
        const sag = this.sag || 14;
        const poleH = this.poleH || 30;

        const cx = (x1 + x2) / 2;
        const cy = y + sag;

        const rects = [];
        // poles
        rects.push({ x: x1 - 3, y: y - poleH, w: 6, h: poleH });
        rects.push({ x: x2 - 3, y: y - poleH, w: 6, h: poleH });

        // cable segments
        const N = 8, halfT = 8/2;
        const evalQ = (t) => {
          const mt = 1 - t;
          return [
            mt*mt*x1 + 2*mt*t*cx + t*t*x2,
            mt*mt*y  + 2*mt*t*cy + t*t*y
          ];
        };
        for (let i = 0; i < N; i++){
          const t0 = i / N, t1 = (i + 1) / N;
          const [xA, yA] = evalQ(t0);
          const [xB, yB] = evalQ(t1);
          rects.push({
            x: Math.min(xA, xB),
            y: Math.min(yA, yB) - halfT,
            w: Math.max(1, Math.abs(xB - xA)),
            h: Math.max(1, Math.abs(yB - yA) + 2*halfT)
          });
        }
        return rects;
      }
    });
  }

  // No explicit delay returned → RooftopCat.jsx uses your existing fallback timing.
}

// -------- drawing --------
export function drawObstacles(ctx, state, t){
  for(const o of state.obstacles){
    if(o.type==="chimney")      drawChimney(ctx, o);
    else if(o.type==="antenna") drawAntenna(ctx, o, t);
    else if(o.type==="hvac")    drawHVAC(ctx, o);
    else if(o.type==="skylight")drawSkylight(ctx, o);
    else if(o.type==="vent_pipe")drawVentPipe(ctx, o);
    else if(o.type==="access_shed")drawAccessShed(ctx, o);
    else if(o.type==="water_tank") drawWaterTank(ctx, o);
    else if(o.type==="billboard")  drawBillboard(ctx, o, t);
    else if(o.type==="water_tower_gate"){ drawWaterTowerGate(ctx, o, PALETTE); }
    else if(o.type==="wire")       drawWire(ctx, o);
  }
}

function drawChimney(ctx, o){
  // --- geometry
  const R_TOP = 2;                      // small top corner radius
  const R_BOT = 3;                      // small bottom radius
  const TAPER = Math.max(3, Math.floor(o.w * 0.08)); // inward per side at top
  const topY = o.y, botY = o.y + o.h;
  const xTL = o.x + TAPER;              // tapered top-left x
  const xTR = o.x + o.w - TAPER;        // tapered top-right x

  // Build tapered-body path once
  function pathBody(){
    ctx.beginPath();
    // top edge
    ctx.moveTo(xTL + R_TOP, topY);
    ctx.lineTo(xTR - R_TOP, topY);
    ctx.quadraticCurveTo(xTR, topY, xTR, topY + R_TOP);
    // right side → bottom
    ctx.lineTo(o.x + o.w, botY - R_BOT);
    ctx.quadraticCurveTo(o.x + o.w, botY, o.x + o.w - R_BOT, botY);
    // bottom
    ctx.lineTo(o.x + R_BOT, botY);
    ctx.quadraticCurveTo(o.x, botY, o.x, botY - R_BOT);
    // left side → top
    ctx.lineTo(xTL, topY + R_TOP);
    ctx.quadraticCurveTo(xTL, topY, xTL + R_TOP, topY);
    ctx.closePath();
  }
  const fillBody = (style) => { ctx.save(); ctx.fillStyle = style; pathBody(); ctx.fill(); ctx.restore(); };
  const clipBody = (fn) => { ctx.save(); pathBody(); ctx.clip(); fn(); ctx.restore(); };

  // --- SOFT SHADOW (now conforms to tapered silhouette; won't stick out)
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = PALETTE.obstacleOutline;
  pathBody();
  ctx.fill();
  ctx.restore();

  // --- BODY FILL (slight side beveling)
  const gBody = ctx.createLinearGradient(o.x, topY, o.x + o.w, topY);
  gBody.addColorStop(0.00, shade(PALETTE.obstacleFill, -12));
  gBody.addColorStop(0.25, shade(PALETTE.obstacleFill, -4));
  gBody.addColorStop(0.75, PALETTE.obstacleFill);
  gBody.addColorStop(1.00, shade(PALETTE.obstacleFill, -18));
  fillBody(gBody);

  // side bevels (clipped just in case)
  clipBody(() => {
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = shade(PALETTE.obstacleFill, -34);
    ctx.fillRect(o.x, topY + 2, 3, o.h - 4);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = shade(PALETTE.obstacleFill, 18);
    ctx.fillRect(o.x + o.w - 3, topY + 3, 2, o.h - 6);
  });

  // --- BRICK COURSES (clipped to the tapered body)
  const mortar = shade(PALETTE.obstacleFill, -38);
  const rowH = 6, brickW = 12;
  clipBody(() => {
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = mortar;
    ctx.lineWidth = 1;

    for (let y = topY + 6; y < botY - 6; y += rowH) {
      // lerp left/right per-row to respect taper
      const t = (y - topY) / Math.max(1, o.h);
      const leftX  = o.x + TAPER * (1 - t) + 4;
      const rightX = o.x + o.w - TAPER * (1 - t) - 4;

      // horizontal joint
      ctx.beginPath(); ctx.moveTo(leftX, y); ctx.lineTo(rightX, y); ctx.stroke();

      // vertical (staggered)
      const rowIdx = Math.floor((y - (topY + 6)) / rowH);
      const offset = (rowIdx % 2 === 0) ? 0 : brickW * 0.5;
      for (let x = leftX + 6 + offset; x < rightX - 6; x += brickW) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, Math.min(y + rowH, botY - 6)); ctx.stroke();
      }
    }
  });

  // tiny brick tint jitter (texture), still clipped
  clipBody(() => {
    ctx.globalAlpha = 0.10;
    for (let y = topY + 6; y < botY - 6; y += rowH) {
      const t = (y - topY) / Math.max(1, o.h);
      const leftX  = o.x + TAPER * (1 - t) + 4;
      const rightX = o.x + o.w - TAPER * (1 - t) - 4;
      const rowIdx = Math.floor((y - (topY + 6)) / rowH);
      const offset = (rowIdx % 2 === 0) ? 0 : brickW * 0.5;

      for (let x = leftX + 6 + offset; x < rightX - 6; x += brickW) {
        const tint = (Math.random()*2 - 1) * 6; // -6..6
        ctx.fillStyle = shade(PALETTE.obstacleFill, tint);
        ctx.fillRect(x + 1, y + 1, brickW - 2, rowH - 2);
      }
    }
  });

  // --- SOOT FADE
  clipBody(() => {
    ctx.globalAlpha = 0.12;
    const hSoot = Math.min(0.50 * o.h, o.h - 10);
    const soot = ctx.createLinearGradient(0, topY, 0, topY + hSoot);
    soot.addColorStop(0, "rgba(0,0,0,0.35)");
    soot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = soot;
    ctx.fillRect(o.x + 2, topY + 2, o.w - 4, hSoot);
  });

  // --- CONCRETE CAP (now **inside** the neon boundary—no protrusion)
  const CAP_H = Math.max(6, Math.floor(o.h * 0.10));
  const capInset = 3;                       // pulls cap away from neon edge
  const capY = topY + 2;                    // BELOW the top edge (inside)
  const capW = (xTR - xTL) - capInset*2;
  const capX = xTL + capInset;

  clipBody(() => {
    const cg = ctx.createLinearGradient(0, capY, 0, capY + CAP_H);
    cg.addColorStop(0, shade(PALETTE.obstacleFill, 10));
    cg.addColorStop(1, shade(PALETTE.obstacleFill, -14));
    ctx.fillStyle = cg;
    roundRect(ctx, capX, capY, capW, CAP_H, 2, true);

    // thin top ridge
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = shade(PALETTE.obstacleFill, 22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(capX + 2, capY + 1.5);
    ctx.lineTo(capX + capW - 2, capY + 1.5);
    ctx.stroke();
  });

  // --- SOLDIER COURSE just under cap (vertical bricks), clipped
  clipBody(() => {
    const bandTop = capY + CAP_H + 1;
    const bandH   = 5;
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = shade(PALETTE.obstacleFill, -10);
    ctx.fillRect(xTL + 2, bandTop, (xTR - xTL) - 4, bandH);

    ctx.globalAlpha = 0.40;
    ctx.strokeStyle = shade(PALETTE.obstacleFill, -36);
    for (let x = xTL + 5; x < xTR - 5; x += 6) {
      ctx.beginPath(); ctx.moveTo(x, bandTop); ctx.lineTo(x, bandTop + bandH); ctx.stroke();
    }
  });

  // --- NEON outline (follows tapered silhouette precisely)
  neonStrokePath(
    ctx,
    PALETTE.obstacleOutline,
    2.0, 6, 0.55,
    () => pathBody()
  );
}

function drawAntenna(ctx, o, t){
  if (o.variant === "pylon") {
    // -------- Y-pylon (duckable base) --------
    const cx = o.x + o.w/2;
    const top = o.y;
    const baseY = o.baseY ?? (o.y + o.h);
    const yClear = baseY - (o.clearance ?? 30);  // top of pass-through

    // proportions (all relative → scale friendly)
    const footOut   = Math.max(8, 0.46 * o.w);
    const waistY    = top + Math.max(18, o.h * 0.52);
    const waistW    = Math.max(8,  0.20 * o.w);
    const shoulderY = top + Math.max(10, o.h * 0.28);
    const armSpan   = Math.max(28, 0.95 * o.w);
    const armW      = Math.max(12, 0.36 * o.w);
    const legW      = 3;

    // key points
    const Lf = { x: cx - footOut,  y: baseY };
    const Rf = { x: cx + footOut,  y: baseY };
    const Lw = { x: cx - waistW/2, y: waistY };
    const Rw = { x: cx + waistW/2, y: waistY };
    const Ls = { x: cx - armW/2,   y: shoulderY };
    const Rs = { x: cx + armW/2,   y: shoulderY };
    const La = { x: cx - armSpan/2, y: shoulderY - 2 };
    const Ra = { x: cx + armSpan/2, y: shoulderY - 2 };

    // REMOVED: the soft back shadow that looked like a blue square.

    // steel gradient
    const metal = ctx.createLinearGradient(o.x, top, o.x + o.w, top);
    metal.addColorStop(0, shade(PALETTE.obstacleFill, -22));
    metal.addColorStop(0.5, PALETTE.obstacleFill);
    metal.addColorStop(1, shade(PALETTE.obstacleFill, -26));
    ctx.strokeStyle = metal;
    ctx.lineWidth = legW;
    ctx.lineCap = "round";

    // silhouette
    ctx.beginPath();
    ctx.moveTo(Lf.x, Lf.y); ctx.lineTo(Lw.x, Lw.y);
    ctx.lineTo(Ls.x, Ls.y); ctx.lineTo(La.x, La.y);
    ctx.lineTo(Ra.x, Ra.y);
    ctx.lineTo(Rs.x, Rs.y); ctx.lineTo(Rw.x, Rw.y); ctx.lineTo(Rf.x, Rf.y);
    ctx.stroke();

    // lattice
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    // base → waist
    for (let i=0;i<4;i++){
      const t0=i/4, t1=(i+1)/4;
      const ly0 = baseY - (baseY - waistY)*t0;
      const ly1 = baseY - (baseY - waistY)*t1;
      const lx0 = Lf.x + (Lw.x - Lf.x)*t0;
      const lx1 = Lf.x + (Lw.x - Lf.x)*t1;
      const rx0 = Rf.x + (Rw.x - Rf.x)*t0;
      const rx1 = Rf.x + (Rw.x - Rf.x)*t1;
      ctx.beginPath();
      ctx.moveTo(lx0, ly0); ctx.lineTo(rx1, ly1);
      ctx.moveTo(rx0, ly0); ctx.lineTo(lx1, ly1);
      ctx.stroke();
    }
    // waist → shoulders
    for (let i=0;i<3;i++){
      const t0=i/3, t1=(i+1)/3;
      const uy0 = waistY - (waistY - shoulderY)*t0;
      const uy1 = waistY - (waistY - shoulderY)*t1;
      const lx0 = Lw.x + (Ls.x - Lw.x)*t0;
      const lx1 = Lw.x + (Ls.x - Lw.x)*t1;
      const rx0 = Rw.x + (Rs.x - Rw.x)*t0;
      const rx1 = Rw.x + (Rs.x - Rw.x)*t1;
      ctx.beginPath();
      ctx.moveTo(lx0, uy0); ctx.lineTo(rx1, uy1);
      ctx.moveTo(rx0, uy0); ctx.lineTo(lx1, uy1);
      ctx.stroke();
    }
    ctx.restore();

    // small droppers (insulators) from arm tips
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(La.x, La.y); ctx.lineTo(La.x, La.y + 8);
    ctx.moveTo(Ra.x, Ra.y); ctx.lineTo(Ra.x, Ra.y + 8);
    ctx.stroke();
    ctx.restore();

    // base feet
    ctx.save();
    ctx.fillStyle = shade(PALETTE.obstacleFill, -30);
    roundRect(ctx, Lf.x - 6, baseY - 3, 12, 6, 3, true);
    roundRect(ctx, Rf.x - 6, baseY - 3, 12, 6, 3, true);
    ctx.restore();

    // “duck line” (visual only, not neon)
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -14);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(Lw.x + 4, yClear); ctx.lineTo(Rw.x - 4, yClear); ctx.stroke();
    ctx.restore();

    // neon on blocking silhouette only
    neonStrokePath(ctx, PALETTE.obstacleOutline, 1.8, 5, 0.55, () => {
      ctx.beginPath();
      ctx.moveTo(Ls.x, Ls.y); ctx.lineTo(Lw.x, Lw.y); ctx.lineTo(cx, yClear);
      ctx.moveTo(Rs.x, Rs.y); ctx.lineTo(Rw.x, Rw.y); ctx.lineTo(cx, yClear);
      ctx.moveTo(La.x, La.y); ctx.lineTo(Ra.x, Ra.y); // cross-arm
    });

  } else {
    // -------- classic mast (unchanged) --------
    const cx = o.x + o.w/2;
    const top = o.y;
    const bot = o.y + o.h;
    const mW = Math.max(2, Math.min(4, Math.round(o.w * 0.45)));

    const plateW = Math.max(o.w + 10, 18);
    const plateH = 6, plateX = cx - plateW/2, plateY = bot - plateH;
    const pg = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    pg.addColorStop(0, shade(PALETTE.obstacleFill, 12));
    pg.addColorStop(1, shade(PALETTE.obstacleFill, -18));
    ctx.fillStyle = pg; roundRect(ctx, plateX, plateY, plateW, plateH, 3, true);

    const mg = ctx.createLinearGradient(cx - mW/2, top, cx + mW/2, top);
    mg.addColorStop(0, shade(PALETTE.obstacleFill, -20));
    mg.addColorStop(0.5, PALETTE.obstacleFill);
    mg.addColorStop(1, shade(PALETTE.obstacleFill, -28));
    ctx.fillStyle = mg;
    roundRect(ctx, cx - mW/2, top, mW, o.h - plateH + 1, Math.min(2, mW*0.6), true);

    ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = shade(PALETTE.obstacleOutline, -18);
    for (let y = top + 10; y < bot - plateH - 6; y += 16)
      roundRect(ctx, cx - (mW+6)/2, y, mW + 6, 3, 2, true);
    ctx.restore();

    const capR = Math.max(2.5, mW * 0.8);
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    const bx = cx, by = top + 2;
    ctx.save(); ctx.globalAlpha = 0.28 * (0.6 + 0.4*pulse);
    ctx.strokeStyle = "#5bbcff"; ctx.lineWidth = 2 + pulse*2;
    ctx.beginPath(); ctx.arc(bx, by, 9 + pulse*5, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    ctx.save();
    const bg = ctx.createLinearGradient(bx - capR, by - capR, bx + capR, by + capR);
    bg.addColorStop(0, "rgba(255,120,120,0.95)"); bg.addColorStop(1, "rgba(255,80,80,0.9)");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, capR, 0, Math.PI*2); ctx.fill(); ctx.restore();

    neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => {
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bot - plateH);
    });
  }
}

function drawHVAC(ctx, o){
  const r = 4;                 // corner radius
  const inset = 4;             // inner padding for details
  const bodyX = o.x, bodyY = o.y, bodyW = o.w, bodyH = o.h;

  // --- soft outer shadow to lift from deck
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = PALETTE.obstacleOutline;
  roundRect(ctx, bodyX - 2, bodyY - 2, bodyW + 4, bodyH + 5, r, true);
  ctx.restore();

  // --- main body with subtle side-to-side metal gradient
  const gBody = ctx.createLinearGradient(bodyX, bodyY, bodyX + bodyW, bodyY);
  gBody.addColorStop(0.0, shade(PALETTE.obstacleFill, -18));
  gBody.addColorStop(0.5, PALETTE.obstacleFill);
  gBody.addColorStop(1.0, shade(PALETTE.obstacleFill, -24));
  ctx.fillStyle = gBody;
  roundRect(ctx, bodyX, bodyY, bodyW, bodyH, r, true);

  // --- top lid seam / beveled cap
  const lidH = Math.min(6, Math.max(4, Math.floor(bodyH * 0.14)));
  const gLid = ctx.createLinearGradient(bodyX, bodyY, bodyX, bodyY + lidH);
  gLid.addColorStop(0, shade(PALETTE.obstacleFill, 14));
  gLid.addColorStop(1, shade(PALETTE.obstacleFill, -8));
  ctx.fillStyle = gLid;
  roundRect(ctx, bodyX + 2, bodyY + 1, bodyW - 4, lidH, 3, true);

  // seam line under lid
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bodyX + 2, bodyY + lidH + 1.5);
  ctx.lineTo(bodyX + bodyW - 2, bodyY + lidH + 1.5);
  ctx.stroke();
  ctx.restore();

  // --- louver slats (horizontal)
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 1;
  const slatTop = bodyY + lidH + 5;
  const slatBot = bodyY + bodyH - 8;
  for (let y = slatTop; y < slatBot; y += 5) {
    ctx.beginPath();
    ctx.moveTo(bodyX + inset, y);
    ctx.lineTo(bodyX + bodyW - inset, y);
    ctx.stroke();
  }
  ctx.restore();

  // --- circular fan grille (left bay)
  const bayW = Math.max(20, Math.floor(bodyW * 0.42));
  const fanCX = bodyX + inset + Math.floor(bayW * 0.55);
  const fanCY = bodyY + Math.floor(bodyH * 0.52);
  const fanR  = Math.max(8, Math.min(14, Math.floor(Math.min(bodyW, bodyH) * 0.28)));

  // fan housing (subtle darker disk)
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -10);
  ctx.beginPath();
  ctx.arc(fanCX, fanCY, fanR + 2, 0, Math.PI * 2);
  ctx.fill();

  // grille rings
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -4);
  ctx.lineWidth = 1;
  for (let rr = fanR; rr > fanR - 5; rr -= 2) {
    ctx.beginPath();
    ctx.arc(fanCX, fanCY, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // grille cross
  ctx.beginPath();
  ctx.moveTo(fanCX - fanR + 1, fanCY);
  ctx.lineTo(fanCX + fanR - 1, fanCY);
  ctx.moveTo(fanCX, fanCY - fanR + 1);
  ctx.lineTo(fanCX, fanCY + fanR - 1);
  ctx.stroke();

  // fan hub
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
  ctx.beginPath();
  ctx.arc(fanCX, fanCY, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- access panel (right bay)
  const panelW = Math.max(18, Math.floor(bodyW * 0.34));
  const panelH = Math.max(14, Math.floor(bodyH * 0.38));
  const panelX = bodyX + bodyW - panelW - inset;
  const panelY = bodyY + Math.floor(bodyH * 0.35);

  const gp = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  gp.addColorStop(0, shade(PALETTE.obstacleFill, 6));
  gp.addColorStop(1, shade(PALETTE.obstacleFill, -12));
  ctx.fillStyle = gp;
  roundRect(ctx, panelX, panelY, panelW, panelH, 3, true);

  // panel screws
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -12);
  const s = 2;
  ctx.fillRect(panelX + 3,            panelY + 3,            s, s);
  ctx.fillRect(panelX + panelW - 5,   panelY + 3,            s, s);
  ctx.fillRect(panelX + 3,            panelY + panelH - 5,   s, s);
  ctx.fillRect(panelX + panelW - 5,   panelY + panelH - 5,   s, s);
  ctx.restore();

  // panel handle
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -6);
  ctx.lineWidth = 1.5;
  const hx = panelX + panelW - 8, hy = panelY + Math.floor(panelH / 2);
  ctx.beginPath();
  ctx.moveTo(hx - 4, hy);
  ctx.lineTo(hx + 2, hy);
  ctx.stroke();
  ctx.restore();

  // --- conduit stub on the right edge
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
  ctx.lineWidth = 2;
  const cx1 = bodyX + bodyW - 1.5;
  const cy1 = bodyY + bodyH - 10;
  ctx.beginPath();
  ctx.moveTo(cx1, cy1);
  ctx.quadraticCurveTo(cx1 + 10, cy1 + 2, cx1 + 8, cy1 + 10);
  ctx.stroke();
  ctx.restore();

  // --- rubber feet / skids
  ctx.save();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -26);
  const footW = 10, footH = 3, footY = bodyY + bodyH - footH;
  roundRect(ctx, bodyX + 6, footY, footW, footH, 2, true);
  roundRect(ctx, bodyX + bodyW - 6 - footW, footY, footW, footH, 2, true);
  ctx.restore();

  // --- subtle front highlight band
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#cfe6ff";
  roundRect(ctx, bodyX + 3, bodyY + 8, Math.max(10, Math.floor(bodyW * 0.35)), Math.floor(bodyH * 0.65), 3, true);
  ctx.restore();

  // --- neon/edge accent (matches your style)
  neonStrokePath(
    ctx,
    PALETTE.obstacleOutline,
    2,
    6,
    0.55,
    () => roundRectPath(ctx, bodyX, bodyY, bodyW, bodyH, r)
  );
}

function drawSkylight(ctx, o){
  const slope = o.slope || 1;
  const left  = o.x;
  const right = o.x + o.w;
  const yTop  = o.y;
  const yBot  = o.y + o.h;

  // where the “ridge” (high edge) lands inside the hitbox
  const ridge = yTop + (slope > 0 ? 5 : o.h - 5);

  // geometry knobs
  const inset   = Math.max(7, Math.min(10, o.w * 0.18)); // glass inset from sides
  const lipH    = 3;                                     // thin highlight strip near ridge
  const boltPad = 3;                                     // how far in from corners to place bolts

  // --- soft drop shadow on the deck (subtle)
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(left + 2, yBot, o.w - 4, 3);
  ctx.restore();

  // --- curb / outer frame (the trapezoid “box”)
  ctx.fillStyle = shade(PALETTE.obstacleFill, -10);
  _skylightPath(ctx, left, yBot, right, ridge);
  ctx.fill();

  // --- everything inside is clipped to the trapezoid
  ctx.save();
  _skylightPath(ctx, left, yBot, right, ridge);
  ctx.clip();

  // inner rim just under the ridge – little lip highlight
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "rgba(170,190,230,0.25)";
  const lipY = ridge - (slope > 0 ? lipH : 0);
  ctx.fillRect(left + inset - 1, lipY, Math.max(2, o.w - inset * 2 + 2), lipH);
  ctx.globalAlpha = 1;

  // --- glass panel
  const gx1 = left + inset;
  const gx2 = right - inset;
  const gy1 = ridge;         // top of glass (near ridge)
  const gy2 = yBot - 2;      // bottom, a hair above the curb bottom

  const gGlass = ctx.createLinearGradient(gx1, Math.min(gy1, gy2), gx1, Math.max(gy1, gy2));
  gGlass.addColorStop(0.00, "rgba(190,210,255,0.26)");
  gGlass.addColorStop(0.60, "rgba(190,210,255,0.12)");
  gGlass.addColorStop(1.00, "rgba(190,210,255,0.06)");
  ctx.fillStyle = gGlass;
  ctx.fillRect(gx1, Math.min(gy1, gy2), gx2 - gx1, Math.abs(gy2 - gy1));

  // specular sweep (very faint diagonal shine)
  ctx.save();
  const gSpec = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
  gSpec.addColorStop(0.00, "rgba(255,255,255,0.00)");
  gSpec.addColorStop(0.50, "rgba(255,255,255,0.08)");
  gSpec.addColorStop(1.00, "rgba(255,255,255,0.00)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gSpec;
  ctx.fillRect(gx1, Math.min(gy1, gy2), gx2 - gx1, Math.abs(gy2 - gy1));
  ctx.restore();

  // pane mullions (light grid – verticals and one mid horizontal)
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -20);
  ctx.lineWidth = 1;

  // verticals
  for (let x = gx1 + 10; x < gx2 - 1; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, gy1 + (slope > 0 ? 0 : -1));
    ctx.lineTo(x, gy2);
    ctx.stroke();
  }
  // one horizontal mid-bar
  const midY = (gy1 + gy2) * 0.5;
  ctx.beginPath();
  ctx.moveTo(gx1, midY);
  ctx.lineTo(gx2, midY);
  ctx.stroke();

  ctx.restore();
  ctx.restore(); // end clip

  // tiny bolts along the curb (bottom edge)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -18);
  const boltCount = Math.max(2, Math.floor((o.w - boltPad * 2) / 16));
  for (let i = 0; i < boltCount; i++) {
    const t = boltCount === 1 ? 0.5 : i / (boltCount - 1);
    const bx = left + boltPad + t * (o.w - boltPad * 2);
    ctx.fillRect(bx - 1, yBot - 2, 2, 2);
  }
  ctx.restore();

  // neon outline around the trapezoid (matches your style)
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => {
    _skylightPath(ctx, left, yBot, right, ridge);
  });
}

function _skylightPath(ctx, left, yBot, right, ridge, inset = 8){
  const w = Math.max(0, right - left);

  // Keep the inward offset sane even for narrow skylights
  const i = Math.max(2, Math.min(inset, Math.floor(w * 0.25)));

  // Make sure ridge isn't below the bottom edge
  const yR = Math.min(ridge, yBot - 1);

  ctx.beginPath();
  ctx.moveTo(left,       yBot);
  ctx.lineTo(left  + i,  yR);
  ctx.lineTo(right - i,  yR);
  ctx.lineTo(right,      yBot);
  ctx.closePath();
}

// ============
function drawVentPipe(ctx, o) {
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const deckY = y + h;

  // --- Sizing ---------------------------------------------------------------
  const pad = 6;
  const R   = Math.max(10, Math.min(20, Math.floor(Math.min(h * 0.30, w * 0.18))));
  const ReLayout = Math.round(R * 1.12);     // keep old layout “fatter” elbow for placement only
  const Re       = R;                        // draw with constant thickness
  const collarL  = Math.max(10, Math.floor(R * 1.2));

  const yMid = Math.min(deckY - Re - 8, y + Math.max(Re + 10, Math.floor(h * 0.52)));
  const leftC = x + pad + R;

  // Horizontal run (compute with ReLayout so spacing/length feeling stays identical)
  const elbowMaxC = x + w - pad - ReLayout;
  const maxRun = Math.max(8, Math.floor(elbowMaxC - (leftC + ReLayout + collarL)));
  const runLenRaw =
    (typeof o.runPx === "number" ? o.runPx :
    (typeof o.runFrac === "number" ? o.runFrac * maxRun : 0.90 * maxRun));
  const runLen = Math.max(8, Math.min(maxRun, Math.floor(runLenRaw)));

  // Keep rightmost tip position identical after switching to Re = R
  const extra = 2 * (ReLayout - Re);
  const stepStartX = leftC + runLen + extra;     // where it “steps” to collar before elbow
  const elbowC     = stepStartX + Re + collarL;
  const kneeInset  = Math.max(2, Math.floor(R * 0.15));

  // --- Silhouette -----------------------------------------------------------
  const P = new Path2D();
  P.moveTo(leftC, yMid - R);
  P.lineTo(stepStartX, yMid - R);
  P.lineTo(elbowC - Re - kneeInset, yMid - Re);
  P.lineTo(elbowC, yMid - Re);
  P.arc(elbowC, yMid, Re, -Math.PI/2, 0, false);
  P.lineTo(elbowC + Re, deckY);
  P.lineTo(elbowC - Re, deckY);
  P.lineTo(elbowC - Re, yMid);
  P.arc(elbowC, yMid, Re, Math.PI, Math.PI/2, true);
  P.lineTo(elbowC - Re - kneeInset, yMid + Re);
  P.lineTo(stepStartX, yMid + R);
  P.lineTo(leftC, yMid + R);
  P.arc(leftC, yMid, R, Math.PI/2, -Math.PI/2, false);
  P.closePath();

  // --- Fill (galvanized) ----------------------------------------------------
  const g = ctx.createLinearGradient(x, yMid - Re, x, yMid + Re);
  g.addColorStop(0.00, shade(PALETTE.obstacleFill, -20));
  g.addColorStop(0.42, shade(PALETTE.obstacleFill,  +8));
  g.addColorStop(0.58, shade(PALETTE.obstacleFill, +12));
  g.addColorStop(1.00, shade(PALETTE.obstacleFill, -24));
  ctx.fillStyle = g;
  ctx.fill(P);

  // Soft rim darkening
  ctx.save();
  ctx.clip(P);
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(1, Math.floor(R * 0.18));
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -28);
  ctx.beginPath(); ctx.moveTo(leftC - R, yMid - R + 1); ctx.lineTo(elbowC + Re, yMid - Re + 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(leftC - R, yMid + R - 1); ctx.lineTo(elbowC + Re, yMid + Re - 1); ctx.stroke();
  ctx.restore();

  // Rolled seams along run
  (function runSeams() {
    const startX = leftC + Math.max(8, R * 0.6);
    const endX   = stepStartX - Math.max(6, R * 0.4);
    const step   = Math.max(12, Math.floor(R * 1.05));
    ctx.save(); ctx.globalAlpha = 0.3;
    for (let xi = startX; xi <= endX; xi += step) {
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -22);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xi, yMid - (R - 0.5)); ctx.lineTo(xi, yMid + (R - 0.5)); ctx.stroke();
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +28);
      ctx.beginPath(); ctx.moveTo(xi + 1, yMid - (R - 2)); ctx.lineTo(xi + 1, yMid + (R - 2)); ctx.stroke();
    }
    ctx.restore();
  })();

  // Collar bands
  (function collarBands() {
    const xs = [stepStartX + 2, elbowC - Re - Math.max(2, R * 0.1)];
    ctx.save(); ctx.globalAlpha = 0.35;
    for (const xi of xs) {
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -25);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xi, yMid - Re); ctx.lineTo(xi, yMid + Re); ctx.stroke();
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +26);
      ctx.beginPath(); ctx.moveTo(xi + 1, yMid - (Re - 2)); ctx.lineTo(xi + 1, yMid + (Re - 2)); ctx.stroke();
    }
    ctx.restore();
  })();

  // Elbow gore seams
  (function elbowGores() {
    ctx.save(); ctx.globalAlpha = 0.32;
    const stepR = Math.max(3.5, Re * 0.18);
    for (let r = Re * 0.85; r >= Re * 0.40; r -= stepR) {
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -25);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(elbowC, yMid, r, -Math.PI/2 + 0.06, 0 - 0.06, false); ctx.stroke();
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +24);
      ctx.beginPath(); ctx.arc(elbowC, yMid, r - 1, -Math.PI/2 + 0.12, 0 - 0.12, false); ctx.stroke();
    }
    ctx.restore();
  })();

  // Leg seams
  (function legSeams() {
    const startY = yMid + Math.max(8, Re * 0.3);
    const endY   = deckY - Math.max(6, Re * 0.25);
    const step   = Math.max(12, Math.floor(Re * 1.05));
    ctx.save(); ctx.globalAlpha = 0.3;
    for (let yi = startY; yi <= endY; yi += step) {
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -22);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(elbowC - (Re - 0.5), yi); ctx.lineTo(elbowC + (Re - 0.5), yi); ctx.stroke();
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +28);
      ctx.beginPath(); ctx.moveTo(elbowC - (Re - 2), yi + 1); ctx.lineTo(elbowC + (Re - 2), yi + 1); ctx.stroke();
    }
    ctx.restore();
  })();

  // ---------- Flanged grille: THINNER & FEWER horizontal lines ---------------
  (function thinLineGrille(){
    const outerR = R - 1;                   // flange
    const openR  = Math.max(2, R - 3);      // circular opening

    // flange ring + inner sheen
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -22);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(leftC, yMid, outerR, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = shade(PALETTE.obstacleFill, +30);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(leftC, yMid, openR - 0.6, 0, Math.PI*2); ctx.stroke();
    ctx.restore();

    // clip to the circular opening
    ctx.save();
    const clip = new Path2D();
    clip.arc(leftC, yMid, openR - 0.6, 0, Math.PI*2);
    ctx.clip(clip);

    // recessed cavity
    const rg = ctx.createRadialGradient(leftC - R*0.15, yMid - R*0.15, 1, leftC, yMid, openR);
    rg.addColorStop(0, shade(PALETTE.obstacleFill, -12));
    rg.addColorStop(1, shade(PALETTE.obstacleOutline, -48));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(leftC, yMid, openR, 0, Math.PI*2); ctx.fill();

    // --- THIN HORIZONTAL LINES (fewer + more spread out) ---
    const sideGap = 1.2;                                   // tiny gap at ends
    const margin  = Math.max(3, Math.round(R * 0.22));     // keep away from rim a bit more
    const pitch   = Math.max(3, Math.round(R * (o.grillePitchMul || 0.34)));
    // ↑ was ~0.18; 0.34 ≈ half as many lines. Raise to 0.38 for even fewer.

    const top    = yMid - openR + margin;
    const bottom = yMid + openR - margin;

    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    for (let yy = top; yy <= bottom; yy += pitch) {
      const dy   = yy - yMid;
      const half = Math.sqrt(Math.max(0, (openR - sideGap)**2 - dy*dy));
      const L = leftC - half, Rr = leftC + half;

      // dark line (half-pixel for crispness)
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -36);
      ctx.beginPath();
      ctx.moveTo(L, Math.round(yy) + 0.5);
      ctx.lineTo(Rr, Math.round(yy) + 0.5);
      ctx.stroke();

      // faint highlight just above
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +22);
      ctx.beginPath();
      ctx.moveTo(L + 1, Math.round(yy) - 0.5);
      ctx.lineTo(Rr - 1, Math.round(yy) - 0.5);
      ctx.stroke();
    }

    ctx.restore(); // end circular clip
  })();

  // ---------- Optional: Rain hood over inlet --------------------------------
  (function inletHood() {
    if (o.startStyle !== "hood") return; // default: grille only
    const outer = new Path2D();
    const inner = new Path2D();
    outer.arc(leftC, yMid, R - 0.8, Math.PI * 0.60, Math.PI * 1.40);
    inner.arc(leftC, yMid, R - 4.8, Math.PI * 1.40, Math.PI * 0.60, true);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = shade(PALETTE.obstacleFill, -10);
    ctx.beginPath(); outer.addPath(inner); ctx.fill(outer);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.strokeStyle = shade(PALETTE.obstacleFill, +26);
    ctx.stroke(outer);
    ctx.restore();
  })();

  // ---------- Tiny brackets (v7: start at grille, step rightward) --------------
  (function brackets() {
    // Straight run just after the flange up to the collar step (no elbow/collar)
    const leftBound  = leftC + Math.max(R * 0.85, 6);          // just past the grille flange
    const rightBound = stepStartX - Math.max(R * 0.35, 6);     // stop before collar step
    const usable = rightBound - leftBound;
    if (usable <= 2) return;

    // Base sizes
    const legWBase   = Math.max(2, Math.floor(R * 0.22));
    const strapH     = Math.max(2, Math.floor(R * 0.26));
    const strapWBase = Math.max(9, Math.floor(R * 0.85));
    const topY       = yMid + R - 1;
    const legH       = Math.max(4, deckY - topY + 1);

    // Draw one bracket at xi; strap auto-shrinks if near the ends so it always fits
    function drawBracket(xi){
      const leftAvail  = Math.max(0, (xi - leftBound)  - 1);
      const rightAvail = Math.max(0, (rightBound - xi) - 1);
      const half = Math.max(4, Math.min(strapWBase * 0.5, leftAvail, rightAvail));
      const strapW = Math.max(6, Math.floor(half * 2));
      const legW   = legWBase;

      // vertical leg
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = shade(PALETTE.obstacleOutline, -42);
      roundRect(ctx, xi - legW / 2, topY, legW, legH, 2, true);

      // foot pad
      roundRect(ctx, xi - legW * 1.4, deckY - 3, legW * 2.8, 4, 2, true);

      // strap
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = shade(PALETTE.obstacleOutline, -36);
      roundRect(ctx, xi - strapW / 2, yMid + R - strapH - 1, strapW, strapH, strapH / 2, true);

      // tiny highlight
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +24);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xi - strapW * 0.45, yMid + R - 1.5);
      ctx.lineTo(xi + strapW * 0.45, yMid + R - 1.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.save();

    // 1) ALWAYS start with a bracket near the grille
    const startClear = Math.max(2, R * 0.18);                  // small offset from flange
    let firstX = leftBound + startClear;
    firstX = Math.max(leftBound + 3, Math.min(firstX, rightBound - 3));
    drawBracket(firstX);

    // 2) Then step rightward with the same (doubled) spacing you’re using now
    const baseSpacing = Math.max(20, Math.floor(R * 1.4));
    const spacing     = (o.bracketSpacingMul ?? 2) * baseSpacing; // “double” default

    for (let xi = firstX + spacing; xi <= rightBound - 3; xi += spacing) {
      drawBracket(xi);
    }

    ctx.restore();
  })();

  // Neon outline
  neonStrokePath(
    ctx,
    PALETTE.obstacleOutline,
    2.0,
    5.5,
    0.62,
    () => { ctx.stroke(P); }
  );
}

function drawAccessShed(ctx, o){
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const dir = o.roofDir || 1;             // 1 = rises to right, -1 = rises to left
  const yBot = y + h;                      // bottom of obstacle (deck line)

  // ---- front body geometry
  const bodyY  = y + 6;
  const bodyH  = h - 6;
  const bodyR  = 3;

  // Top coping cap
  const capH = 5;
  const capOver = Math.max(2, Math.min(4, Math.floor(w * 0.06)));
  const roofTopY = y;
  const roofBotY = y + capH;

  // ridge overhang (we keep it small so neon ≈ hitbox)
  const rawOver = Math.max(6, Math.min(10, Math.floor(w * 0.18)));
  const EPS = 0.5;
  const ridgeL = Math.max(x + EPS,     x     + (dir === -1 ? -rawOver : 0));
  const ridgeR = Math.min(x + w - EPS, x + w + (dir ===  1 ?  rawOver : 0));

  // ---- simple 3D side extrude (behind the front)
  const d  = Math.max(6, Math.min(12, Math.floor(w * 0.22)));
  const px = (dir === 1 ?  d : -d);
  const py = -Math.floor(d * 0.35);

  const sideRoofTopY = Math.max(roofTopY, roofTopY + py);
  const sideRoofBotY = Math.max(roofBotY, roofBotY + py);
  const sideWallTopY = Math.max(bodyY,    bodyY    + py);

  const sideXFront = (dir === 1) ? (x + w) : x;
  const sideXBack  = sideXFront + px;

  const edgeBotX = (dir === 1) ? (x + w) : x;
  const edgeTopX = (dir === 1) ? ridgeR   : ridgeL;

  // -------------------- SIDE/BACK (behind) --------------------
  // Thin side tar strip (kept above deck)
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -40);
  const sideTarTop = yBot - 3;
  ctx.beginPath();
  ctx.moveTo(sideXFront, sideTarTop);
  ctx.lineTo(sideXBack,  sideTarTop + (sideRoofBotY - roofBotY));
  ctx.lineTo(sideXBack,  sideTarTop + 3 + (sideRoofBotY - roofBotY));
  ctx.lineTo(sideXFront, sideTarTop + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Side wall quad
  const sideShade = ctx.createLinearGradient(sideXFront, bodyY, sideXBack, sideWallTopY);
  sideShade.addColorStop(0.00, shade(PALETTE.obstacleFill, -8));
  sideShade.addColorStop(1.00, shade(PALETTE.obstacleFill, -22));
  ctx.fillStyle = sideShade;
  ctx.beginPath();
  ctx.moveTo(sideXFront, bodyY);
  ctx.lineTo(sideXBack,  sideWallTopY);
  ctx.lineTo(sideXBack,  bodyY + bodyH + (sideWallTopY - bodyY));
  ctx.lineTo(sideXFront, bodyY + bodyH);
  ctx.closePath();
  ctx.fill();

  // Side "roof" strip (under coping return)
  const sideRoofGrad = ctx.createLinearGradient(sideXFront, roofBotY, sideXBack, sideRoofBotY);
  sideRoofGrad.addColorStop(0.00, shade(PALETTE.obstacleFill, -2));
  sideRoofGrad.addColorStop(1.00, shade(PALETTE.obstacleFill, -18));
  ctx.fillStyle = sideRoofGrad;
  ctx.beginPath();
  ctx.moveTo(edgeBotX,          roofBotY);
  ctx.lineTo(edgeTopX,          roofTopY);
  ctx.lineTo(edgeTopX + px,     sideRoofTopY);
  ctx.lineTo(edgeBotX + px,     sideRoofBotY);
  ctx.closePath();
  ctx.fill();

  // Subtle back-edge hints
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "rgba(170,210,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sideXBack, sideWallTopY);
  ctx.lineTo(sideXBack, bodyY + bodyH + (sideWallTopY - bodyY));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(edgeBotX + 0.5,          roofBotY + 0.5);
  ctx.lineTo(edgeTopX + 0.5,          roofTopY + 0.5);
  ctx.lineTo(edgeTopX + px + 0.5,     sideRoofTopY + 0.5);
  ctx.lineTo(edgeBotX + px + 0.5,     sideRoofBotY + 0.5);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // -------------------- FRONT (in front) --------------------
  // Tar/torch-down base
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -38);
  roundRect(ctx, x - 6, yBot - 3, w + 12, 3, 3, true);
  ctx.restore();

  // Coping cap with tiny overhang + drip shadow
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
  roundRect(ctx, x - capOver + 1, roofTopY - 1, w + capOver*2 - 2, 2, 2, true);
  ctx.restore();

  const capG = ctx.createLinearGradient(x, roofTopY, x, roofBotY);
  capG.addColorStop(0, shade(PALETTE.obstacleFill, 10));
  capG.addColorStop(1, shade(PALETTE.obstacleFill, -12));
  ctx.fillStyle = capG;
  roundRect(ctx, x - capOver, roofTopY, w + capOver*2, capH, 3, true);

  // Front wall (painted CMU)
  const wallGrad = ctx.createLinearGradient(x, bodyY, x, bodyY + bodyH);
  wallGrad.addColorStop(0.00, shade(PALETTE.obstacleFill,  6));
  wallGrad.addColorStop(1.00, shade(PALETTE.obstacleFill, -12));
  ctx.fillStyle = wallGrad;
  roundRect(ctx, x, bodyY, w, bodyH, bodyR, true);

  // Mortar hints (very subtle)
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -24);
  ctx.lineWidth = 1;
  const rowH = 7;
  for (let yy = bodyY + 9; yy < bodyY + bodyH - 6; yy += rowH) {
    ctx.beginPath(); ctx.moveTo(x + 6, yy); ctx.lineTo(x + w - 6, yy); ctx.stroke();
  }
  ctx.restore();

  // Door + hardware (NYC steel door feel)
  const dw = Math.max(18, Math.floor(w * 0.38));
  const dh = Math.max(26, Math.floor(bodyH * 0.60));
  const dx = Math.floor(x + w * 0.16);
  const dy = Math.floor(bodyY + bodyH - dh - 6);

  // Door frame (jamb)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 2;
  roundRect(ctx, dx - 2, dy - 2, dw + 4, dh + 4, 3, false);
  ctx.restore();

  const doorGrad = ctx.createLinearGradient(dx, dy, dx, dy + dh);
  doorGrad.addColorStop(0.00, shade(PALETTE.obstacleFill, -8));
  doorGrad.addColorStop(1.00, shade(PALETTE.obstacleFill, -22));
  ctx.fillStyle = doorGrad;
  roundRect(ctx, dx, dy, dw, dh, 3, true);

  // Hinges (right side)
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -8);
  const hingeY1 = dy + Math.floor(dh * 0.28);
  const hingeY2 = dy + Math.floor(dh * 0.62);
  ctx.fillRect(dx + dw + 1, hingeY1, 3, 5);
  ctx.fillRect(dx + dw + 1, hingeY2, 3, 5);
  ctx.restore();

  // Lever handle
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -6);
  ctx.lineWidth = 1.6;
  const hx = dx + dw - 8, hy = dy + Math.floor(dh * 0.52);
  ctx.beginPath(); ctx.moveTo(hx - 6, hy); ctx.lineTo(hx + 2, hy); ctx.stroke();
  ctx.restore();

  // Louver slats on door
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 1;
  const lvX = dx + 5, lvY = dy + 8, lvW = dw - 10, rows = 5;
  for (let i = 0; i < rows; i++){
    const yy = lvY + i * 4;
    ctx.beginPath(); ctx.moveTo(lvX, yy); ctx.lineTo(lvX + lvW, yy); ctx.stroke();
  }
  ctx.restore();

  // Little cage light above door (soft glow)
  const lx = dx + Math.floor(dw * 0.5), ly = dy - 6;
  ctx.save();
  ctx.fillStyle = "#a9e6ff";
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(lx, ly, 1.6, 0, Math.PI*2); ctx.fill();
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 10);
  lg.addColorStop(0, "rgba(150,210,255,0.35)");
  lg.addColorStop(1, "rgba(150,210,255,0.00)");
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 10, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // -------------------- NEON (3D) --------------------
  const contactY = yBot;

  // OUTER silhouette extents (include side extrude) — for hitbox/clip
  const outerL = (dir === -1) ? Math.min(x, sideXBack) : x;
  const outerR = (dir ===  1) ? Math.max(x + w, sideXBack) : x + w;

  ctx.save();
  ctx.beginPath();
  // keep your “21” headroom so the drop leg kisses the deck
  ctx.rect(outerL - 14, y - 24, (outerR - outerL) + 28, (yBot - y) + 21);
  ctx.clip();

  // --- (A) Back/side neon (dim) for depth
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.2, 3.6, 0.32, () => {
    ctx.beginPath();
    ctx.moveTo(sideXBack, sideWallTopY);
    ctx.lineTo(sideXBack, yBot + 2);
  });
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.2, 3.4, 0.30, () => {
    ctx.beginPath();
    ctx.moveTo(edgeTopX + px, sideRoofTopY);
    ctx.lineTo(edgeBotX + px, sideRoofBotY);
  });
  // tiny ridge thickness
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.1, 3.0, 0.28, () => {
    ctx.beginPath();
    ctx.moveTo(edgeTopX,     roofTopY);
    ctx.lineTo(edgeTopX+px,  sideRoofTopY);
  });

  // --- (B) Front face neon (bright)
  const frontL = Math.round(x) + 0.5;
  const frontR = Math.round(x + w) - 0.5;
  const topYLine = Math.round(y) + 0.5;
  const baseYLine = contactY + 0.5;

  // Coping front lip
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.5, 4.2, 0.55, () => {
    ctx.beginPath();
    ctx.moveTo(x - capOver + 1, roofTopY + 0.5);
    ctx.lineTo(x + w + capOver - 1, roofTopY + 0.5);
  });

  // Front rectangle (U) down the sides
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.9, 5.4, 0.62, () => {
    ctx.beginPath();
    ctx.moveTo(frontL,  baseYLine + 3);
    ctx.lineTo(frontL,  topYLine);
    ctx.lineTo(frontR,  topYLine);
    ctx.lineTo(frontR,  baseYLine + 3);
  });

  // --- (C) Subtle outer U (hitbox guide)
  const outerLeft  = Math.round(outerL) + 0.5;
  const outerRight = Math.round(outerR) - 0.5;
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4.5, 0.38, () => {
    ctx.beginPath();
    ctx.moveTo(outerLeft,  baseYLine + 3);
    ctx.lineTo(outerLeft,  topYLine);
    ctx.lineTo(outerRight, topYLine);
    ctx.lineTo(outerRight, baseYLine + 3);
  });

  // --- (D) Deck stitch + hotspot at attach side
  const legX = (dir === 1) ? outerRight : outerLeft;
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.8, 5.2, 0.60, () => {
    ctx.beginPath();
    ctx.moveTo(legX, bodyY + bodyH - 0.25);
    ctx.lineTo(legX, contactY + 4.0);
  });
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = PALETTE.obstacleOutline;
  ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(legX - 3, contactY + 0.5); ctx.lineTo(legX + 3, contactY + 0.5); ctx.stroke();
  // hotspot
  const rg = ctx.createRadialGradient(legX, contactY + 1, 0, legX, contactY + 1, 6);
  rg.addColorStop(0, "rgba(160,220,255,0.55)"); rg.addColorStop(1, "rgba(160,220,255,0.00)");
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(legX, contactY + 1, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.restore(); // end neon clip
}

function drawWaterTank(ctx, o){
  const x=o.x, y=o.y, w=o.w, h=o.h;
  const deckY = y + h;

  // If you set o.variant = "poly_round" in the spawner, you get the vertical poly tank.
  if (o.variant === "poly_round") {
    // ---------- POLY ROUND (vertical, domed top, full-width base contact) ----------
    const padX   = 6;                                  // small side inset
    const tankW  = Math.max(42, w - padX*2);           // overall width of the tank
    const tankH  = Math.max(36, h - 2);                // make it “thick” and seated on deck
    const left   = x + (w - tankW)/2;
    const right  = left + tankW;
    const topY   = deckY - tankH;
    const cx     = (left + right) / 2;

    // Dome height (rounded top); tweak for more/less bulge
    const domeH  = Math.max(10, Math.floor(tankH * 0.28));

    // Silhouette (flat base → vertical sides → elliptical dome)
    const P = new Path2D();
    P.moveTo(left,  deckY);
    P.lineTo(right, deckY);
    P.lineTo(right, topY + domeH);
    P.ellipse(cx, topY + domeH, tankW/2, domeH, 0, 0, Math.PI, true); // top dome (right→left)
    P.lineTo(left, deckY);
    P.closePath();

    // Fill (poly-tank plastic feel)
    const g = ctx.createLinearGradient(left, topY, left, deckY);
    g.addColorStop(0.00, shade(PALETTE.obstacleFill, -18));
    g.addColorStop(0.55, shade(PALETTE.obstacleFill,   8));
    g.addColorStop(1.00, shade(PALETTE.obstacleFill, -22));
    ctx.fillStyle = g;
    ctx.fill(P);

    // Panel/ring ribs (wide, evenly spaced)
    (function ribs(){
      const gap = Math.max(8, Math.floor(tankH * 0.16));
      const start = topY + domeH + gap * 0.7;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
      ctx.lineWidth = 2;
      for (let yy = start; yy <= deckY - 6; yy += gap) {
        ctx.beginPath();
        // follow curvature near the dome by shortening slightly as we go up
        const shrink = Math.max(0, (topY + domeH + gap - yy) * 0.10);
        ctx.moveTo(left  + 4 + shrink, yy);
        ctx.lineTo(right - 4 - shrink, yy);
        ctx.stroke();
      }
      ctx.restore();
    })();

    // Central roof rib (that ridge on top of many round poly tanks)
    (function roofRidge(){
      const ridgeW = Math.max(6, Math.floor(tankW * 0.08));
      const ridgeH = Math.max(6, Math.floor(domeH * 0.55));
      ctx.save();
      ctx.fillStyle = shade(PALETTE.obstacleFill, -14);
      roundRect(ctx, cx - ridgeW/2, (topY + domeH) - ridgeH, ridgeW, ridgeH, Math.min(3, ridgeW/2), true);
      // tiny highlight
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = shade(PALETTE.obstacleFill, +24);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - ridgeW*0.35, (topY + domeH) - ridgeH*0.65);
      ctx.lineTo(cx + ridgeW*0.35, (topY + domeH) - ridgeH*0.65);
      ctx.stroke();
      ctx.restore();
    })();

    // Base pad/shadow so it clearly “touches” all along the ground
    (function basePad(){
      const padH = 4;
      const padInset = 8;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = shade(PALETTE.obstacleOutline, -42);
      roundRect(ctx, left + padInset, deckY - padH, tankW - padInset*2, padH, 2, true);
      ctx.restore();
    })();

    // Soft vertical highlight
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#cfe6ff";
    const hiW = Math.max(10, Math.floor(tankW * 0.22));
    const hiX = left + Math.floor(tankW * 0.30);
    roundRect(ctx, hiX, topY + domeH + 6, hiW, tankH - domeH - 12, 6, true);
    ctx.restore();

    // Neon outline for readability
    neonStrokePath(ctx, PALETTE.obstacleOutline, 2.0, 6.0, 0.55, () => ctx.stroke(P));
    return; // done with poly_round
  }

  // ---------- DRUM (horizontal on saddles) – unchanged from your version ----------
  const sidePad = 6;
  const standH  = Math.max(10, Math.floor(h * 0.30));
  const bodyW   = Math.max(52, w - sidePad * 2);
  const dia     = Math.max(26, Math.min(h - standH - 3, Math.floor(w * 0.56)));
  const r       = dia / 2;

  const bodyX = x + (w - bodyW) / 2;
  const bodyY = deckY - standH - dia;

  const saddleXs = (bodyW >= 110)
    ? [bodyX + bodyW * 0.20, bodyX + bodyW * 0.50, bodyX + bodyW * 0.80]
    : [bodyX + bodyW * 0.30, bodyX + bodyW * 0.70];

  // Saddles/pads
  (function saddles(){
    const padCol   = shade(PALETTE.obstacleOutline, -42);
    const legCol   = shade(PALETTE.obstacleOutline, -34);
    const strapCol = shade(PALETTE.obstacleOutline, -30);

    const padW   = Math.max(16, Math.floor(w * 0.18));
    const legW   = Math.max(6, Math.floor(r * 0.60));
    const wallW  = Math.max(3, Math.floor(legW * 0.28));
    const strapH = Math.max(4, Math.floor(r * 0.35));
    const seatY  = bodyY + dia - strapH - 1;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = padCol;
    for (const sx of saddleXs) roundRect(ctx, sx - padW/2, deckY - 4, padW, 4, 2, true);
    ctx.restore();

    ctx.save();
    for (const sx of saddleXs){
      ctx.fillStyle = legCol;
      roundRect(ctx, sx - legW/2,        deckY - standH, wallW, standH, 2, true);
      roundRect(ctx, sx + legW/2 - wallW,deckY - standH, wallW, standH, 2, true);
      roundRect(ctx, sx - legW/2 + wallW, deckY - Math.max(6, Math.floor(standH*0.24)),
                legW - wallW*2, Math.max(3, Math.floor(standH*0.16)), 2, true);

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = shade(PALETTE.obstacleOutline, -46);
      ctx.beginPath();
      const holeTop = deckY - Math.floor(standH*0.55);
      ctx.moveTo(sx - legW*0.26, deckY - Math.floor(standH*0.28));
      ctx.lineTo(sx,               holeTop);
      ctx.lineTo(sx + legW*0.26, deckY - Math.floor(standH*0.28));
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = strapCol;
      roundRect(ctx, sx - Math.floor(legW*0.75)/2, seatY, Math.floor(legW*0.75), strapH, strapH/2, true);
    }
    ctx.restore();
  })();

  // Drum body
  const gBody = ctx.createLinearGradient(bodyX, bodyY, bodyX + bodyW, bodyY);
  gBody.addColorStop(0.00, shade(PALETTE.obstacleFill, -16));
  gBody.addColorStop(0.50, shade(PALETTE.obstacleFill,  +8));
  gBody.addColorStop(1.00, shade(PALETTE.obstacleFill, -20));
  ctx.fillStyle = gBody;
  roundRect(ctx, bodyX, bodyY, bodyW, dia, r, true);

  // Bands along length
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.lineWidth = 2;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
  const ringStep = Math.max(18, Math.floor(r * 1.1));
  for (let xi = bodyX + r + ringStep; xi <= bodyX + bodyW - r - 6; xi += ringStep){
    ctx.beginPath(); ctx.moveTo(xi, bodyY + 3); ctx.lineTo(xi, bodyY + dia - 3); ctx.stroke();
  }
  ctx.restore();

  // Highlight band
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#cfe6ff";
  roundRect(ctx, bodyX + Math.floor(bodyW*0.25), bodyY + 6,
            Math.max(10, Math.floor(bodyW*0.30)), dia - 12, 6, true);
  ctx.restore();

  // Manway on top
  const manX = bodyX + bodyW * 0.56;
  const manW = Math.max(10, Math.floor((dia/2) * 0.9));
  const manH = Math.max(6,  Math.floor((dia/2) * 0.55));
  const riserH = Math.max(4, Math.floor((dia/2) * 0.40));
  ctx.save();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -14);
  roundRect(ctx, manX - manW * 0.14, bodyY - riserH + 1, manW * 0.28, riserH, 2, true);
  const gLid = ctx.createLinearGradient(0, bodyY - riserH - manH, 0, bodyY - riserH + 2);
  gLid.addColorStop(0, shade(PALETTE.obstacleFill,  8));
  gLid.addColorStop(1, shade(PALETTE.obstacleFill, -12));
  ctx.fillStyle = gLid;
  roundRect(ctx, manX - manW/2, bodyY - riserH - manH, manW, manH, Math.min(6, manH/2), true);
  ctx.restore();

  // End ladder (nudged right, down to deck)
  (function endLadder(){
    const r = dia/2, railGap = Math.max(6, Math.floor(r * 0.32));
    const margin  = Math.max(2, Math.floor(r * 0.10));
    const nudge   = 4;
    const railL = bodyX + margin + 1 + nudge, railR = railL + railGap;
    const top = bodyY + Math.max(4, Math.floor(r * 0.10)), bot = deckY - 3;

    ctx.save();
    ctx.globalAlpha = 0.70;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(railL, top); ctx.lineTo(railL, bot);
    ctx.moveTo(railR, top); ctx.lineTo(railR, bot); ctx.stroke();
    for (let yy = top + 5; yy <= bot - 6; yy += 6){
      ctx.beginPath(); ctx.moveTo(railL + 1, yy); ctx.lineTo(railR - 1, yy); ctx.stroke();
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = shade(PALETTE.obstacleOutline, -42);
    roundRect(ctx, railL - 3, deckY - 4, 6, 4, 2, true);
    roundRect(ctx, railR - 3, deckY - 4, 6, 4, 2, true);
    ctx.restore();
  })();

  // Neon outline
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2.0, 6.0, 0.55, () => {
    roundRectPath(ctx, bodyX, bodyY, bodyW, dia, r);
  });
}

function drawBillboard(ctx, o, t){
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const contactY = y + h;

  // geometry
  const faceR = 4;
  const legW = Math.max(4, Math.floor(w * 0.035));
  const legH = Math.max(10, Math.floor(h * 0.22));
  const faceH = h - legH - 6;
  const faceY = y;
  const faceW = w;
  const faceX = x;

  // leg positions
  const legLX = Math.round(x + Math.max(8, w * 0.08));
  const legRX = Math.round(x + w - Math.max(8, w * 0.08) - legW);
  const legTop = y + faceH + 2;

  // -------------------- BASE / LEGS --------------------
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle   = shade(PALETTE.obstacleOutline, -40);
  roundRect(ctx, legLX - 6, contactY - 3, Math.max(18, legW + 12), 3, 2, true);
  roundRect(ctx, legRX - 6, contactY - 3, Math.max(18, legW + 12), 3, 2, true);
  ctx.restore();

  const lg = ctx.createLinearGradient(0, legTop, 0, contactY);
  lg.addColorStop(0, shade(PALETTE.obstacleFill, -18));
  lg.addColorStop(1, shade(PALETTE.obstacleFill, -30));
  ctx.fillStyle = lg;
  roundRect(ctx, legLX, legTop, legW, legH, 2, true);
  roundRect(ctx, legRX, legTop, legW, legH, 2, true);

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -16);
  ctx.lineWidth = 1;
  const webX1 = legLX + Math.floor(legW/2) + 0.5;
  const webX2 = legRX + Math.floor(legW/2) + 0.5;
  ctx.beginPath(); ctx.moveTo(webX1, legTop + 1); ctx.lineTo(webX1, contactY - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(webX2, legTop + 1); ctx.lineTo(webX2, contactY - 4); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -12);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(legLX + legW/2, contactY - 3);
  ctx.lineTo(legRX + legW/2, legTop + 2);
  ctx.moveTo(legRX + legW/2, contactY - 3);
  ctx.lineTo(legLX + legW/2, legTop + 2);
  ctx.stroke();
  ctx.restore();

  // -------------------- CATWALK + RAIL --------------------
  const walkY = y + faceH + 0.5;
  const walkH = 6;
  const railH = 8;

  const gWalk = ctx.createLinearGradient(x, walkY, x, walkY + walkH);
  gWalk.addColorStop(0, shade(PALETTE.obstacleFill,  6));
  gWalk.addColorStop(1, shade(PALETTE.obstacleFill, -14));
  ctx.fillStyle = gWalk;
  roundRect(ctx, x + 4, walkY, w - 8, walkH, 3, true);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 1;
  for (let gx = x + 8; gx < x + w - 8; gx += 6){
    ctx.beginPath(); ctx.moveTo(gx, walkY + 1); ctx.lineTo(gx, walkY + walkH - 1); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let rx = x + 10; rx <= x + w - 10; rx += 14){
    ctx.moveTo(rx, walkY);
    ctx.lineTo(rx, walkY - railH);
  }
  ctx.moveTo(x + 8, walkY - railH);
  ctx.lineTo(x + w - 8, walkY - railH);
  ctx.stroke();
  ctx.restore();

  // -------------------- FACE / SKIN (variants) --------------------
  const frameInset = 2;
  const faceInnerX = faceX + frameInset;
  const faceInnerY = faceY + frameInset;
  const faceInnerW = faceW - frameInset*2;
  const faceInnerH = faceH - frameInset*2;

  // outer frame (unchanged)
  const gFrame = ctx.createLinearGradient(faceX, faceY, faceX, faceY + faceH);
  gFrame.addColorStop(0, shade(PALETTE.obstacleFill, -8));
  gFrame.addColorStop(1, shade(PALETTE.obstacleFill, -22));
  ctx.fillStyle = gFrame;
  roundRect(ctx, faceX, faceY, faceW, faceH, faceR, true);

  // pick once & remember
  const variant = o.variant || (o.variant = pickWeighted([
    ["classic", 5],
    ["slats",   4],
    ["led",     3],
    ["wood",    3],
  ]));

  // helper to round-rect clip to inner panel
  function clipInner(){
    const p = new Path2D();
    p.roundRect(faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1));
    ctx.clip(p);
  }

  if (variant === "slats"){
    // Tri-vision style: vertical slats with light/dark faces
    const bg = ctx.createLinearGradient(faceInnerX, faceInnerY, faceInnerX, faceInnerY + faceInnerH);
    bg.addColorStop(0, "#0f1a32");
    bg.addColorStop(1, "#0b1224");
    ctx.fillStyle = bg;
    roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);

    const slatW = Math.max(8, Math.floor(faceInnerW / 10));
    ctx.save(); clipInner();
    for (let sx = faceInnerX + 4; sx < faceInnerX + faceInnerW - 4; sx += slatW){
      const g = ctx.createLinearGradient(sx, 0, sx + slatW, 0);
      g.addColorStop(0.00, shade(PALETTE.obstacleFill, -26));
      g.addColorStop(0.45, shade(PALETTE.obstacleFill, +4));
      g.addColorStop(0.55, shade(PALETTE.obstacleFill, +6));
      g.addColorStop(1.00, shade(PALETTE.obstacleFill, -24));
      ctx.fillStyle = g;
      roundRect(ctx, sx + 1, faceInnerY + 3, slatW - 3, faceInnerH - 6, 2, true);

      // thin side bevel lines
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx + 1.5, faceInnerY + 4);
      ctx.lineTo(sx + 1.5, faceInnerY + faceInnerH - 4);
      ctx.moveTo(sx + slatW - 2.5, faceInnerY + 4);
      ctx.lineTo(sx + slatW - 2.5, faceInnerY + faceInnerH - 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

  } else if (variant === "led"){
    // LED matrix look
    ctx.fillStyle = "#0b1326";
    roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);

    // pixel grid
    ctx.save(); clipInner();
    const step = 6;
    const rad = 1.2;
    for (let yy = faceInnerY + 3; yy <= faceInnerY + faceInnerH - 3; yy += step){
      for (let xx = faceInnerX + 3; xx <= faceInnerX + faceInnerW - 3; xx += step){
        const flick = 0.75 + 0.25 * Math.sin(((t||0)*3) + xx*0.04 + yy*0.03);
        ctx.fillStyle = `rgba(160,210,255,${0.08 * flick})`;
        ctx.beginPath(); ctx.arc(xx, yy, rad, 0, Math.PI*2); ctx.fill();
      }
    }
    // scanline
    const scan = (performance.now() * 0.12) % (faceInnerH - 2);
    ctx.fillStyle = "rgba(90,176,255,0.20)";
    ctx.fillRect(faceInnerX + 2, faceInnerY + 1 + scan, faceInnerW - 4, 3);
    ctx.restore();

    // subtle bezel inside
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
    ctx.lineWidth = 1;
    roundRect(ctx, faceInnerX + 1, faceInnerY + 1, faceInnerW - 2, faceInnerH - 2, Math.max(1, faceR-2), false);
    ctx.globalAlpha = 1;

  } else if (variant === "wood"){
    // Weathered planks
    const plankH = Math.max(10, Math.floor(faceInnerH / 6));
    ctx.save();
    clipInner();
    for (let py = faceInnerY; py < faceInnerY + faceInnerH; py += plankH){
      const g = ctx.createLinearGradient(0, py, 0, py + plankH);
      g.addColorStop(0, shade(PALETTE.obstacleFill, -14));
      g.addColorStop(1, shade(PALETTE.obstacleFill, -24));
      ctx.fillStyle = g;
      ctx.fillRect(faceInnerX, py, faceInnerW, plankH - 1);

      // grain and nails
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(faceInnerX + 8, py + plankH*0.4);
      ctx.lineTo(faceInnerX + faceInnerW - 8, py + plankH*0.6);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      for (let bx = faceInnerX + 10; bx < faceInnerX + faceInnerW - 8; bx += 38){
        ctx.fillStyle = shade(PALETTE.obstacleOutline, -16);
        ctx.fillRect(bx, py + 3, 1, 1);
        ctx.fillRect(bx + 14, py + plankH - 5, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    // one missing plank (rare)
    if (Math.random() < 0.25){
      const row = Math.floor((faceInnerH / plankH) * 0.5) * plankH;
      ctx.clearRect(faceInnerX + 12, faceInnerY + row + 2, faceInnerW - 24, plankH - 4);
    }
    ctx.restore();

    // inner shadow/vignette
    ctx.save();
    const vg = ctx.createRadialGradient(faceInnerX, faceInnerY, 0, faceInnerX, faceInnerY, Math.max(faceInnerW, faceInnerH));
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = vg;
    roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);
    ctx.restore();

  } else {
    // ------- classic (your original face) -------
    const gFace = ctx.createLinearGradient(faceInnerX, faceInnerY, faceInnerX, faceInnerY + faceInnerH);
    gFace.addColorStop(0, "#16243f");
    gFace.addColorStop(0.55, "#0f1a33");
    gFace.addColorStop(1, "#0b1326");
    ctx.fillStyle = gFace;
    roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = shade(PALETTE.obstacleOutline, -14);
    const boltPad = 6, boltStep = Math.max(18, Math.floor(faceW / 6));
    for (let bx = faceX + boltPad; bx <= faceX + faceW - boltPad; bx += boltStep){
      ctx.fillRect(bx - 1, faceY + 2, 2, 2);
      ctx.fillRect(bx - 1, faceY + faceH - 4, 2, 2);
    }
    for (let by = faceY + boltPad; by <= faceY + faceH - boltPad; by += 16){
      ctx.fillRect(faceX + 2,                 by - 1, 2, 2);
      ctx.fillRect(faceX + faceW - 4,         by - 1, 2, 2);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#253a66";
    ctx.lineWidth = 1;
    for (let sx = faceInnerX + 12; sx < faceInnerX + faceInnerW - 12; sx += 16){
      ctx.beginPath(); ctx.moveTo(sx, faceInnerY + 6); ctx.lineTo(sx, faceInnerY + faceInnerH - 6); ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    const vg = ctx.createRadialGradient(faceInnerX, faceInnerY, 0, faceInnerX, faceInnerY, Math.max(faceInnerW, faceInnerH));
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = vg;
    roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "#2a3a60";
    ctx.beginPath();
    ctx.moveTo(faceInnerX + 6, faceInnerY + 6);
    ctx.lineTo(faceInnerX + faceInnerW - 6, faceInnerY + faceInnerH - 6);
    ctx.moveTo(faceInnerX + faceInnerW - 6, faceInnerY + 6);
    ctx.lineTo(faceInnerX + 6, faceInnerY + faceInnerH - 6);
    ctx.stroke();
    ctx.restore();

    // subtle scanline like before
    const scan = (performance.now() * 0.12) % (faceInnerH - 2);
    ctx.fillStyle = "rgba(90,176,255,0.18)";
    ctx.fillRect(faceInnerX + 2, faceInnerY + 1 + scan, faceInnerW - 4, 3);
  }

  // -------------------- TOP LAMPS --------------------
  const lampCount = Math.max(2, Math.floor(w / 60));
  for (let i = 0; i < lampCount; i++){
    const u = (i + 0.5) / lampCount;
    const lx = Math.floor(faceX + 10 + u * (faceW - 20));
    const ly = faceY - 4;
    ctx.save();
    ctx.fillStyle = shade(PALETTE.obstacleFill, -8);
    ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI*2); ctx.fill();

    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + 6); ctx.stroke();

    const flicker = 0.7 + 0.3 * Math.sin((t || 0) * 6 + i*1.7);
    ctx.globalCompositeOperation = "lighter";
    const lg2 = ctx.createRadialGradient(lx, ly + 8, 0, lx, ly + 8, 40);
    lg2.addColorStop(0, `rgba(160,210,255,${0.20 * flicker})`);
    lg2.addColorStop(1, "rgba(160,210,255,0.00)");
    ctx.fillStyle = lg2;
    ctx.beginPath();
    ctx.moveTo(lx - 20, ly + 6);
    ctx.lineTo(lx + 20, ly + 6);
    ctx.lineTo(lx + 32, ly + 38);
    ctx.lineTo(lx - 32, ly + 38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // -------------------- NEON / READABILITY --------------------
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () =>
    roundRectPath(ctx, faceX, faceY, faceW, faceH, faceR)
  );

  const postLX = Math.round(legLX) + 0.5;
  const postRX = Math.round(legRX + legW) - 0.5;
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.4, 4, 0.45, () => {
    ctx.beginPath();
    ctx.moveTo(postLX, legTop);  ctx.lineTo(postLX, contactY + 2.5);
    ctx.moveTo(postRX, legTop);  ctx.lineTo(postRX, contactY + 2.5);
  });

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = PALETTE.obstacleOutline;
  ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(postLX - 3, contactY + 0.5); ctx.lineTo(postLX + 3, contactY + 0.5);
  ctx.moveTo(postRX - 3, contactY + 0.5); ctx.lineTo(postRX + 3, contactY + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawWaterTowerGate(ctx, o, P){
  const baseY   = o.baseY;      // deck line
  const beamY   = o.y;          // duck bar top-left Y
  const beamH   = o.h;          // duck bar height

  // geometry
  const inset = Math.max(10, o.w * 0.18);
  const legW  = Math.max(4, Math.min(7, o.w * 0.08));
  const xL    = o.x + inset;
  const xR    = o.x + o.w - inset - legW;

  const legH      = o.clearance + beamH + o.stem;  // ground → platform underside
  const platformY = baseY - legH;                  // top of legs / under tank
  const tankPad   = 6;                             // platform thickness
  const tx        = o.x + 8;                       // tank box
  const tw        = o.w - 16;
  const tankY     = platformY - tankPad - o.tankH;

  // 0) Soft contact shadow
  ctx.save();
  const contactG = ctx.createLinearGradient(0, baseY - 8, 0, baseY + 6);
  contactG.addColorStop(0.0, "rgba(0,0,0,0.0)");
  contactG.addColorStop(1.0, "rgba(0,0,0,0.25)");
  ctx.fillStyle = contactG;
  ctx.fillRect(o.x, baseY - 8, o.w, 14);
  ctx.restore();

  // 1) Feet: tar pads + base plates + bolts
  const footH = 3;
  const padW  = Math.max(18, legW + 12);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = shade(P.obstacleOutline, -40);
  roundRect(ctx, xL - 6, baseY - footH, padW, footH, 2, true);
  roundRect(ctx, xR - 6, baseY - footH, padW, footH, 2, true);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = shade(P.obstacleFill, -20);
  roundRect(ctx, xL - 2, baseY - (footH + 2), legW + 4, 3, 2, true);
  roundRect(ctx, xR - 2, baseY - (footH + 2), legW + 4, 3, 2, true);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = shade(P.obstacleOutline, -12);
  ctx.fillRect(xL - 1, baseY - (footH + 1), 2, 2);
  ctx.fillRect(xL + legW - 1, baseY - (footH + 1), 2, 2);
  ctx.fillRect(xR - 1, baseY - (footH + 1), 2, 2);
  ctx.fillRect(xR + legW - 1, baseY - (footH + 1), 2, 2);
  ctx.restore();

  // 2) Legs (I-beam-ish) + gussets + bracing
  const gLeg = ctx.createLinearGradient(0, baseY - legH, 0, baseY);
  gLeg.addColorStop(0, shade(P.obstacleFill, -16));
  gLeg.addColorStop(0.5, P.obstacleFill);
  gLeg.addColorStop(1, shade(P.obstacleFill, -28));
  ctx.fillStyle = gLeg;
  roundRect(ctx, xL, baseY - legH, legW, legH, 2, true);
  roundRect(ctx, xR, baseY - legH, legW, legH, 2, true);

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(P.obstacleOutline, -14);
  ctx.lineWidth = 1;
  const webL = xL + Math.floor(legW/2) + 0.5;
  const webR = xR + Math.floor(legW/2) + 0.5;
  ctx.beginPath(); ctx.moveTo(webL, baseY - legH + 2); ctx.lineTo(webL, baseY - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(webR, baseY - legH + 2); ctx.lineTo(webR, baseY - 2); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = shade(P.obstacleOutline, -22);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xL + legW/2, baseY - legH);
  ctx.lineTo(xR + legW/2, baseY);
  ctx.moveTo(xR + legW/2, baseY - legH);
  ctx.lineTo(xL + legW/2, baseY);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = shade(P.obstacleFill, -22);
  roundRect(ctx, xL + legW, platformY - 4, (xR - xL - legW), 3, 2, true);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = shade(P.obstacleFill, -24);
  // left gusset
  ctx.beginPath();
  ctx.moveTo(xL + legW, platformY);
  ctx.lineTo(xL + legW + 10, platformY);
  ctx.lineTo(xL + legW, platformY + 10);
  ctx.closePath(); ctx.fill();
  // right gusset
  ctx.beginPath();
  ctx.moveTo(xR, platformY);
  ctx.lineTo(xR - 10, platformY);
  ctx.lineTo(xR, platformY + 10);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // 3) Platform slab / planks
  const slabX = o.x + 6;
  const slabW = o.w - 12;
  ctx.save();
  const gSlab = ctx.createLinearGradient(slabX, platformY - tankPad, slabX, platformY);
  gSlab.addColorStop(0, shade(P.obstacleFill, 8));
  gSlab.addColorStop(1, shade(P.obstacleFill, -14));
  ctx.fillStyle = gSlab;
  roundRect(ctx, slabX, platformY - tankPad, slabW, tankPad, 3, true);
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = shade(P.obstacleOutline, -18);
  ctx.lineWidth = 1;
  for (let px = slabX + 6; px < slabX + slabW - 6; px += 6){
    ctx.beginPath(); ctx.moveTo(px, platformY - tankPad + 1); ctx.lineTo(px, platformY - 1); ctx.stroke();
  }
  ctx.restore();

  // 4) Tank box with vertical slats + hoops + vent
  ctx.fillStyle = shade(P.obstacleFill, -4);
  roundRect(ctx, tx, tankY, tw, o.tankH, 6, true);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = shade(P.obstacleOutline, -28);
  ctx.lineWidth = 1;
  for (let xx = tx + 4; xx < tx + tw - 4; xx += 5) {
    ctx.beginPath(); ctx.moveTo(xx, tankY + 4); ctx.lineTo(xx, tankY + o.tankH - 4); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(P.obstacleOutline, -10);
  ctx.lineWidth = 2;
  const bandTop = tankY + 10;
  const bandMid = tankY + Math.max(16, Math.floor(o.tankH * 0.52));
  const bandBot = tankY + o.tankH - 12;
  [bandTop, bandMid, bandBot].forEach(yy => {
    ctx.beginPath(); ctx.moveTo(tx + 6, yy); ctx.lineTo(tx + tw - 6, yy); ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  ctx.fillStyle = shade(P.obstacleFill, -12);
  ctx.beginPath(); ctx.ellipse(tx + tw/2, tankY, tw/2, 6, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = shade(P.obstacleFill, -26);
  ctx.beginPath();
  ctx.moveTo(tx + tw*0.5 - tw*0.15, tankY - 6);
  ctx.lineTo(tx + tw*0.5,           tankY - 12);
  ctx.lineTo(tx + tw*0.5 + tw*0.15, tankY - 6);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(190,210,255,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx + tw*0.35, tankY - 8); ctx.lineTo(tx + tw*0.65, tankY - 8); ctx.stroke();
  ctx.restore();

  // 5) Ladder on right leg
  const lx = xR + Math.max(4, legW - 2);
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = shade(P.obstacleOutline, -12);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx - 2, tankY + 6); ctx.lineTo(lx - 2, platformY - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(lx + 2, tankY + 6); ctx.lineTo(lx + 2, platformY - 2); ctx.stroke();
  for (let yy = tankY + 10; yy < platformY - 2; yy += 5) {
    ctx.beginPath(); ctx.moveTo(lx - 3, yy); ctx.lineTo(lx + 3, yy); ctx.stroke();
  }
  ctx.restore();

  // 6) LOW “DUCK” BAR — unchanged (with neon)
  const innerL = xL + legW + 2;
  const innerR = xR - 2;
  const barW   = Math.max(20, innerR - innerL);
  const barX   = innerL;

  const gBar = ctx.createLinearGradient(barX, beamY, barX + barW, beamY);
  gBar.addColorStop(0,   shade(P.obstacleFill, -8));
  gBar.addColorStop(0.5, P.obstacleFill);
  gBar.addColorStop(1,   shade(P.obstacleFill, -18));
  ctx.fillStyle = gBar;
  roundRect(ctx, barX, beamY, barW, beamH, 3, true);

  // subtle hazard ticks
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shade(P.obstacleOutline, -8);
  ctx.lineWidth = 1;
  for (let sx = barX + 4; sx < barX + barW - 4; sx += 6){
    ctx.beginPath();
    ctx.moveTo(sx, beamY + 2);
    ctx.lineTo(sx, beamY + beamH - 2);
    ctx.stroke();
  }
  ctx.restore();

  neonStrokePath(ctx, P.obstacleOutline, 1.6, 4, 0.55,
    () => roundRectPath(ctx, barX, beamY, barW, beamH, 3)
  );

  // 7) Tower silhouette neon (ABOVE duck bar only; no big rectangle)
  (function towerSilhouetteNeon(){
    const glowW = 4.5, glowA = 0.50, thick = 1.6;

    ctx.save();
    // Clip to area above the duck bar so the lower “duckable” look stays untouched
    ctx.beginPath();
    ctx.rect(o.x - 4, -9999, o.w + 8, Math.max(0, beamY + 2 + 9999));
    ctx.clip();

    // left leg
    neonStrokePath(ctx, P.obstacleOutline, thick, glowW, glowA, () =>
      roundRectPath(ctx, xL, baseY - legH, legW, legH, 2)
    );

    // right leg
    neonStrokePath(ctx, P.obstacleOutline, thick, glowW, glowA, () =>
      roundRectPath(ctx, xR, baseY - legH, legW, legH, 2)
    );

    // platform slab edge
    neonStrokePath(ctx, P.obstacleOutline, thick, glowW, glowA, () =>
      roundRectPath(ctx, slabX, platformY - tankPad, slabW, tankPad, 3)
    );

    // tank box (rounded)
    neonStrokePath(ctx, P.obstacleOutline, thick, glowW, glowA, () =>
      roundRectPath(ctx, tx, tankY, tw, o.tankH, 6)
    );

    ctx.restore();
  })();
}

function drawWire(ctx, o){
  const x1 = o.x, x2 = o.x + o.w;
  const y  = o.y;                        // wire anchor (highest point of span)
  const sag = o.sag || 14;
  const deckY = (o.baseY ?? (y + 44));
  const cx = (x1 + x2) / 2;
  const cy = y + sag;

  // ---- pick/capture a pole look once (no A_frame) ----
  if (o.poleVariant == null) {
    o.poleVariant = pickWeighted([
      ["pipe_arm",    4],  // baseline
      ["cantilever",  3],  // angled arm, compact (visibility+)
      ["stub_gantry", 3],  // short post with U-yoke (visibility+)
    ]);
  }
  const poleVariant = o.poleVariant;

  // ----- helper: visual (non-colliding) drop-leg pole variants -----
  const drawDropPole = (px, side /* -1 left, +1 right */, variant) => {
    // shared numbers
    const padH  = 3;
    const overTop = 14;               // how much higher than wire the pole top sits
    const topY = y - overTop;         // smaller Y = visually higher

    // tar pad (common)
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = shade(PALETTE.obstacleOutline, -40);
    roundRect(ctx, px - 10, deckY - padH, 20, padH, 2, true);
    ctx.restore();

    if (variant === "pipe_arm") {
      // ========== Baseline pipe post w/ short crossarm ==========
      const poleW = 8;
      const armW = 18, armH = 4;
      const armY = topY + 2, armX = px - armW/2;

      // pole shaft
      const gPole = ctx.createLinearGradient(px, topY, px, deckY);
      gPole.addColorStop(0, shade(PALETTE.obstacleFill, -10));
      gPole.addColorStop(0.5, PALETTE.obstacleFill);
      gPole.addColorStop(1, shade(PALETTE.obstacleFill, -26));
      ctx.fillStyle = gPole;
      roundRect(ctx, px - poleW/2, topY, poleW, deckY - topY, 3, true);

      // bands
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -14);
      ctx.lineWidth = 1;
      [armY + 6, deckY - 10].forEach(by => {
        ctx.beginPath(); ctx.moveTo(px - poleW/2 + 1.5, by); ctx.lineTo(px + poleW/2 - 1.5, by); ctx.stroke();
      });
      ctx.restore();

      // crossarm
      const gArm = ctx.createLinearGradient(armX, armY, armX, armY + armH);
      gArm.addColorStop(0, shade(PALETTE.obstacleFill, 10));
      gArm.addColorStop(1, shade(PALETTE.obstacleFill, -16));
      ctx.fillStyle = gArm;
      roundRect(ctx, armX, armY, armW, armH, 2, true);

      // brace
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, armY + armH);
      ctx.lineTo(px + side * (armW * 0.35), armY + armH + 6);
      ctx.stroke();
      ctx.restore();

      // insulator puck
      const insX = px + side * (armW * 0.38);
      const insY = armY + armH/2;
      ctx.save();
      const g = ctx.createLinearGradient(insX - 4, insY - 3, insX + 4, insY + 3);
      g.addColorStop(0, shade(PALETTE.obstacleFill, 14));
      g.addColorStop(1, shade(PALETTE.obstacleFill, -8));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(insX, insY, 3.6, 2.4, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
      ctx.fillRect(insX - 0.6, insY - 1.6, 1.2, 3.2);
      ctx.restore();

      // jumper to the wire
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = PALETTE.wireCore;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(insX, insY);
      const jcx = insX + side * 10;
      const targetX = side < 0 ? (x1 + 1) : (x2 - 1);
      ctx.quadraticCurveTo(jcx, insY + 8, targetX, y + 1);
      ctx.stroke();
      ctx.restore();

      // subtle highlight
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#cfe6ff";
      roundRect(ctx, px - poleW/2 + 1, topY + 6, 3, Math.max(12, deckY - topY - 12), 2, true);
      ctx.restore();

    } else if (variant === "cantilever") {
      // ========== Compact cantilever bracket on a slim post ==========
      const poleW = 6;
      const postH = deckY - topY;
      const armLen = 16, armTh = 3;

      // slim post
      const gp = ctx.createLinearGradient(px, topY, px, deckY);
      gp.addColorStop(0, shade(PALETTE.obstacleFill, -8));
      gp.addColorStop(1, shade(PALETTE.obstacleFill, -24));
      ctx.fillStyle = gp;
      roundRect(ctx, px - poleW/2, topY, poleW, postH, 2, true);

      // angled cantilever arm
      const ax0 = px, ay0 = topY + 3;
      const ax1 = px + side * armLen, ay1 = ay0 + 6;
      ctx.save();
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -12);
      ctx.lineWidth = armTh;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1); ctx.stroke();
      ctx.restore();

      // small clamp/insulator at the tip
      const insX = ax1, insY = ay1;
      ctx.save();
      ctx.fillStyle = shade(PALETTE.obstacleFill, -6);
      ctx.beginPath(); ctx.arc(insX, insY, 2.6, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // jumper
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = PALETTE.wireCore;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(insX, insY);
      const jcx = insX + side * 10;
      const targetX = side < 0 ? (x1 + 1) : (x2 - 1);
      ctx.quadraticCurveTo(jcx, insY + 8, targetX, y + 1);
      ctx.stroke();
      ctx.restore();

    } else { // "stub_gantry"
      // ========== Short post with U-yoke (twin insulators) ==========
      const postW = 7;
      const postH = Math.max(18, deckY - topY - 4);
      const yokeW = 16, yokeH = 8;

      // post
      const gPost = ctx.createLinearGradient(px, topY, px, deckY);
      gPost.addColorStop(0, shade(PALETTE.obstacleFill, -8));
      gPost.addColorStop(1, shade(PALETTE.obstacleFill, -24));
      ctx.fillStyle = gPost;
      roundRect(ctx, px - postW/2, topY + 4, postW, postH, 2, true);

      // U-yoke on the outer side
      const ux = px + side * (postW/2 + 1.5);
      const uy = topY + 6;
      ctx.save();
      ctx.strokeStyle = shade(PALETTE.obstacleOutline, -12);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(ux + side * (yokeW * 0.6), uy + yokeH/2);
      ctx.lineTo(ux, uy + yokeH);
      ctx.stroke();
      ctx.restore();

      // two small insulators along the yoke
      const ins1X = ux + side * (yokeW * 0.32), ins1Y = uy + yokeH*0.28;
      const ins2X = ux + side * (yokeW * 0.52), ins2Y = uy + yokeH*0.58;
      ctx.save();
      ctx.fillStyle = shade(PALETTE.obstacleFill, -6);
      ctx.beginPath(); ctx.arc(ins1X, ins1Y, 2.4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ins2X, ins2Y, 2.4, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // jumper from the outer insulator
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = PALETTE.wireCore;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ins2X, ins2Y);
      const jcx = ins2X + side * 10;
      const targetX = side < 0 ? (x1 + 1) : (x2 - 1);
      ctx.quadraticCurveTo(jcx, ins2Y + 8, targetX, y + 1);
      ctx.stroke();
      ctx.restore();
    }
  };

  // place drop-legs slightly outside the span so silhouettes read
  const offset = Math.max(8, Math.min(14, Math.floor(o.w * 0.035)));
  drawDropPole(x1 - offset, -1, poleVariant);
  drawDropPole(x2 + offset,  1, poleVariant);

  // ----- wire (shadow + glow + core) -----
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x1, y + 1.5); ctx.quadraticCurveTo(cx, cy + 1.5, x2, y + 1.5); ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = PALETTE.wireGlow;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); ctx.stroke();

  ctx.strokeStyle = PALETTE.wireCore;
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); ctx.stroke();

  // neon accent only on the wire
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4, 0.35, () => {
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y);
  });
}
