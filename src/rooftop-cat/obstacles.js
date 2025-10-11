import { pickWeighted, shade, clamp } from "./utils.js";
import { PALETTE } from "./palette.js";
import { roundRect, roundRectPath, neonStrokePath } from "./utils.js";

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
    ["skylight",     14],
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
    const bw=24+Math.random()*22, bh=34+Math.random()*40;
    state.obstacles.push({type:"chimney",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "antenna") {
    const bw=12+Math.random()*10, bh=64+Math.random()*52;
    state.obstacles.push({type:"antenna",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "hvac") {
    const bw=44+Math.random()*36, bh=22+Math.random()*12;
    state.obstacles.push({type:"hvac",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "skylight") {
    const bw=44+Math.random()*42, bh=16+Math.random()*10;
    state.obstacles.push({type:"skylight",x:w+40,y:gy-bh,w:bw,h:bh,slope:Math.random()<0.5?1:-1});
  } else if (pick === "vent_pipe") {
    const bw=16+Math.random()*8, bh=24+Math.random()*16;
    state.obstacles.push({type:"vent_pipe",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "access_shed") {
    const bw=36+Math.random()*24, bh=34+Math.random()*20;
    state.obstacles.push({type:"access_shed",x:w+40,y:gy-bh,w:bw,h:bh,roofDir:Math.random()<0.5?-1:1});
  } else if (pick === "water_tank") {
    const bw=28+Math.random()*10, bh=54+Math.random()*22;
    state.obstacles.push({type:"water_tank",x:w+40,y:gy-bh,w:bw,h:bh});
  } else if (pick === "billboard") {
    const bw=110+Math.random()*70, bh=56+Math.random()*28;
    state.obstacles.push({type:"billboard",x:w+40,y:gy-bh,w:bw,h:bh});
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
    const span=140+Math.random()*140 + extraSpan;
    const y=gy-(48+Math.random()*26);
    const sag=10+Math.random()*20, poleH=28+Math.random()*16;

    state.obstacles.push({
      type:"wire",
      x:w+40,
      y,
      w:span,
      h:4,
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
        const N = 8;           // increase for tighter fit
        const thickness = 8;   // hit thickness around the wire
        const halfT = thickness / 2;

        const evalQ = (t) => {
          const mt = 1 - t;
          const xt = mt*mt*x1 + 2*mt*t*cx + t*t*x2;
          const yt = mt*mt*y  + 2*mt*t*cy + t*t*y;
          return [xt, yt];
        };

        for (let i = 0; i < N; i++){
          const t0 = i / N, t1 = (i + 1) / N;
          const [xA, yA] = evalQ(t0);
          const [xB, yB] = evalQ(t1);
          const minX = Math.min(xA, xB);
          const maxX = Math.max(xA, xB);
          const minY = Math.min(yA, yB) - halfT;
          const maxY = Math.max(yA, yB) + halfT;
          rects.push({ x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) });
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
  // --- soft back shadow to lift from background
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = PALETTE.obstacleOutline;
  roundRect(ctx, o.x - 2, o.y - 2, o.w + 4, o.h + 4, 3, true);
  ctx.restore();

  // --- body fill (slight edge darkening so it feels blocky)
  const gx = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y);
  gx.addColorStop(0.00, shade(PALETTE.obstacleFill, -14));
  gx.addColorStop(0.20, shade(PALETTE.obstacleFill, -6));
  gx.addColorStop(0.80, PALETTE.obstacleFill);
  gx.addColorStop(1.00, shade(PALETTE.obstacleFill, -18));
  ctx.fillStyle = gx;
  roundRect(ctx, o.x, o.y, o.w, o.h, 3, true);

  // --- left bevel shadow / right highlight (subtle)
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -35);
  ctx.fillRect(o.x, o.y + 2, 3, o.h - 4);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = shade(PALETTE.obstacleFill, 22);
  ctx.fillRect(o.x + o.w - 3, o.y + 3, 3, o.h - 6);
  ctx.restore();

  // --- crown (cap slab) with small overhang & drip shadow
  const capOver = Math.min(6, Math.max(3, o.w * 0.16));
  const capH = 7;
  // drip shadow under cap
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
  roundRect(ctx, o.x - capOver + 1, o.y - 1, o.w + 2*capOver - 2, 3, 2, true);
  ctx.restore();
  // cap body
  const cg = ctx.createLinearGradient(o.x, o.y - capH, o.x, o.y);
  cg.addColorStop(0, shade(PALETTE.obstacleFill, 8));
  cg.addColorStop(1, shade(PALETTE.obstacleFill, -12));
  ctx.fillStyle = cg;
  roundRect(ctx, o.x - capOver, o.y - capH, o.w + capOver*2, capH, 3, true);

  // tiny top ridge line on cap
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = shade(PALETTE.obstacleFill, 20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x - capOver + 2, o.y - capH + 2);
  ctx.lineTo(o.x + o.w + capOver - 2, o.y - capH + 2);
  ctx.stroke();
  ctx.restore();

  // --- brick courses (staggered)
  // “Mortar” color a touch darker than fill so it reads but stays subtle
  const mortar = shade(PALETTE.obstacleFill, -35);
  const rowH = 6;                  // course height
  const brickW = 12;               // nominal brick width
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = mortar;
  ctx.lineWidth = 1;

  // horizontal mortar lines
  for (let y = o.y + 4; y < o.y + o.h - 4; y += rowH) {
    ctx.beginPath();
    ctx.moveTo(o.x + 3, y);
    ctx.lineTo(o.x + o.w - 3, y);
    ctx.stroke();

    // vertical mortar lines (stagger each row by half a brick)
    const rowIndex = Math.floor((y - (o.y + 4)) / rowH);
    const offset = (rowIndex % 2 === 0) ? 0 : brickW * 0.5;
    for (let x = o.x + 6 + offset; x < o.x + o.w - 6; x += brickW) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, Math.min(y + rowH, o.y + o.h - 4));
      ctx.stroke();
    }
  }
  ctx.restore();

  // --- soot streaks near the top (very subtle)
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -5);
  const sootTop = o.y + 4;
  const sootBot = o.y + Math.min(o.h * 0.55, o.h - 10);
  const stripe = (x, w) => { ctx.fillRect(x, sootTop, w, sootBot - sootTop); };
  stripe(o.x + Math.floor(o.w * 0.28), 2);
  stripe(o.x + Math.floor(o.w * 0.44), 1.5);
  stripe(o.x + Math.floor(o.w * 0.66), 2);
  ctx.restore();

  // --- base flashing (little metal lip into the roof)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -40);
  ctx.beginPath();
  ctx.moveTo(o.x - 4, o.y + o.h - 2);
  ctx.lineTo(o.x + 6, o.y + o.h + 4);
  ctx.lineTo(o.x + o.w - 6, o.y + o.h + 4);
  ctx.lineTo(o.x + o.w + 4, o.y + o.h - 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- neon-ish outline (matches your overall vibe)
  neonStrokePath(
    ctx,
    PALETTE.obstacleOutline,
    2,    // width
    6,    // glow
    0.55, // alpha
    () => roundRectPath(ctx, o.x, o.y, o.w, o.h, 3)
  );

  // optional: a faint cap outline too (kept subtle)
  neonStrokePath(
    ctx,
    shade(PALETTE.obstacleOutline, -12),
    1.4,
    4,
    0.35,
    () => roundRectPath(ctx, o.x - capOver, o.y - capH, o.w + capOver*2, capH, 3)
  );
}

function drawAntenna(ctx, o, t){
  const cx = o.x + o.w/2;
  const top = o.y;
  const bot = o.y + o.h;

  // mast tube width (kept slim, scales with obstacle width)
  const mW = Math.max(2, Math.min(4, Math.round(o.w * 0.45)));

  // --- soft back shadow to lift from background
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = PALETTE.obstacleOutline;
  roundRect(ctx, cx - (mW+4)/2, top - 3, mW + 4, o.h + 6, 3, true);
  ctx.restore();

  // --- base plate (mount)
  const plateW = Math.max(o.w + 10, 18);
  const plateH = 6;
  const plateX = cx - plateW/2;
  const plateY = bot - plateH;
  const pg = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
  pg.addColorStop(0, shade(PALETTE.obstacleFill, 12));
  pg.addColorStop(1, shade(PALETTE.obstacleFill, -18));
  ctx.fillStyle = pg;
  roundRect(ctx, plateX, plateY, plateW, plateH, 3, true);

  // tiny bolts on plate
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
  const boltY = plateY + plateH - 2;
  ctx.fillRect(plateX + 4,             boltY, 2, 2);
  ctx.fillRect(plateX + plateW - 6,    boltY, 2, 2);
  ctx.fillRect(plateX + Math.floor(plateW/2) - 1, boltY, 2, 2);
  ctx.restore();

  // --- mast tube (vertical)
  const mg = ctx.createLinearGradient(cx - mW/2, top, cx + mW/2, top);
  mg.addColorStop(0, shade(PALETTE.obstacleFill, -20));
  mg.addColorStop(0.5, PALETTE.obstacleFill);
  mg.addColorStop(1, shade(PALETTE.obstacleFill, -28));
  ctx.fillStyle = mg;
  roundRect(ctx, cx - mW/2, top, mW, o.h - plateH + 1, Math.min(2, mW*0.6), true);

  // --- segmented clamps around the mast
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -18);
  const clampH = 3;
  const startY = top + 10;
  const endY = bot - plateH - 6;
  for (let y = startY; y < endY; y += 16) {
    roundRect(ctx, cx - (mW+6)/2, y, mW + 6, clampH, 2, true);
  }
  ctx.restore();

  // --- diagonal braces (left/right stand-offs)
  ctx.save();
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -8);
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;

  const b1 = top + Math.max(8, o.h * 0.25);
  const b2 = top + Math.max(18, o.h * 0.45);

  ctx.beginPath();
  ctx.moveTo(cx, b1);
  ctx.lineTo(o.x + 2, b1 + Math.min(14, o.w * 0.8));
  ctx.moveTo(cx, b2);
  ctx.lineTo(o.x + o.w - 2, b2 + Math.min(14, o.w * 0.8));
  ctx.stroke();
  ctx.restore();

  // --- coax cable run (a slim curve down the mast to the plate)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + mW/2, top + 12);
  ctx.quadraticCurveTo(cx + 10, top + o.h * 0.35, plateX + plateW - 6, plateY + 2);
  ctx.stroke();
  ctx.restore();

  // --- beacon at the top with pulse halo
  const capR = Math.max(2.5, mW * 0.8);
  const pulse = 0.5 + 0.5 * Math.sin(t * 6); // 0..1
  const beaconX = cx;
  const beaconY = top + 2;

  // halo
  ctx.save();
  ctx.globalAlpha = 0.28 * (0.6 + 0.4 * pulse);
  ctx.strokeStyle = "#5bbcff";
  ctx.lineWidth = 2 + pulse * 2;
  ctx.beginPath();
  ctx.arc(beaconX, beaconY, 9 + pulse * 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // beacon dome
  ctx.save();
  const bg = ctx.createLinearGradient(beaconX - capR, beaconY - capR, beaconX + capR, beaconY + capR);
  bg.addColorStop(0, "rgba(255,120,120,0.95)");
  bg.addColorStop(1, "rgba(255,80,80,0.9)");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(beaconX, beaconY, capR, 0, Math.PI * 2);
  ctx.fill();

  // tiny specular highlight
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(beaconX - capR * 0.35, beaconY - capR * 0.35, capR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- subtle rim at the mast top (cap ring)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - mW/2 - 1, top + 6);
  ctx.lineTo(cx + mW/2 + 1, top + 6);
  ctx.stroke();
  ctx.restore();

  // --- neon-ish accents
  // mast glow
  neonStrokePath(
    ctx,
    PALETTE.obstacleOutline,
    2,
    6,
    0.55,
    () => { ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bot - plateH); }
  );

  // brace glow (lighter)
  neonStrokePath(
    ctx,
    shade(PALETTE.obstacleOutline, -6),
    1.6,
    4,
    0.45,
    () => {
      ctx.beginPath();
      ctx.moveTo(cx, b1); ctx.lineTo(o.x + 2, b1 + Math.min(14, o.w * 0.8));
      ctx.moveTo(cx, b2); ctx.lineTo(o.x + o.w - 2, b2 + Math.min(14, o.w * 0.8));
    }
  );
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

function drawVentPipe(ctx, o){
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const yBot = y + h;
  const cx = x + w/2;

  // --- 1) Tar patch (NYC roofs ❤️ tar blobs)
  const tarH = 6;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -40);
  roundRect(ctx, x - 6, yBot - Math.floor(tarH*0.6), w + 12, tarH, 3, true);
  ctx.restore();

  // --- 2) Sheet-metal flashing (under the boot)
  const flPad = Math.max(3, Math.min(6, Math.floor(w*0.25)));
  const fx = x - flPad, fw = w + flPad*2;
  const fh = Math.max(5, Math.min(8, Math.floor(h*0.22)));
  const fy = yBot - fh - 1;
  const flashGrad = ctx.createLinearGradient(fx, fy, fx, fy + fh);
  flashGrad.addColorStop(0, shade(PALETTE.obstacleFill, 14));
  flashGrad.addColorStop(1, shade(PALETTE.obstacleFill, -8));
  ctx.fillStyle = flashGrad;
  ctx.beginPath();
  ctx.moveTo(fx + 2,      fy);
  ctx.lineTo(fx + fw - 2, fy);
  ctx.lineTo(fx + fw,     fy + 2);
  ctx.lineTo(fx + fw - 2, fy + fh);
  ctx.lineTo(fx + 2,      fy + fh);
  ctx.lineTo(fx,          fy + 2);
  ctx.closePath();
  ctx.fill();

  // --- 3) Rubber/lead boot collar hugging the pipe
  const collarH = Math.max(4, Math.min(8, Math.floor(h * 0.18)));
  const collarY = yBot - fh - Math.floor(collarH * 0.7);
  ctx.fillStyle = shade(PALETTE.obstacleFill, -16);
  roundRect(ctx, x - 1, collarY, w + 2, collarH, 3, true);

  // --- 4) Pipe geometry (centerline path of a gooseneck)
  // vertical riser, then a smooth elbow turning downward
  const pipeW = Math.max(6, Math.min(9, Math.floor(w * 0.8))); // visual thickness
  const riseH = Math.max(12, Math.floor(h * 0.55));
  const elbowR = Math.max(8, Math.min(16, Math.floor(h * 0.33))); // elbow radius
  const baseY = yBot - fh - Math.floor(collarH * 0.6);

  // mouth (downward tip) offset
  const mouthDown = Math.max(6, Math.floor(elbowR * 0.75));
  const mouthX = cx + elbowR;              // curve to the right; flip if you want
  const mouthY = baseY - riseH + elbowR;   // bottom of the elbow arc

  // Helper to trace the gooseneck centerline
  const traceGooseneck = () => {
    ctx.beginPath();
    // straight up
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx, baseY - riseH);
    // quarter-curve to the right
    ctx.quadraticCurveTo(cx + elbowR, baseY - riseH, mouthX, baseY - riseH + elbowR);
    // short downturned tip
    ctx.lineTo(mouthX, mouthY + mouthDown);
  };

  // Outer soft “sheen” stroke (gives a rounded metal look)
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(190,210,255,0.45)";
  ctx.lineWidth = pipeW + 3;
  traceGooseneck(); ctx.stroke();
  ctx.restore();

  // Main pipe body (galvanized)
  const pipeGrad = ctx.createLinearGradient(x, y, x + w, y);
  pipeGrad.addColorStop(0.00, shade(PALETTE.obstacleFill, -12));
  pipeGrad.addColorStop(0.45, shade(PALETTE.obstacleFill, 8));
  pipeGrad.addColorStop(1.00, shade(PALETTE.obstacleFill, -18));
  ctx.save();
  ctx.strokeStyle = pipeGrad;
  ctx.lineWidth = pipeW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceGooseneck(); ctx.stroke();
  ctx.restore();

  // seam on the riser + a clamp band
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -24);
  ctx.lineWidth = 1;
  // vertical seam
  const seamTop = baseY - riseH + 4;
  ctx.beginPath();
  ctx.moveTo(cx + Math.floor(w*0.28), baseY - 3);
  ctx.lineTo(cx + Math.floor(w*0.28), seamTop);
  ctx.stroke();
  // clamp band around the riser
  const bandY = baseY - Math.floor(riseH * 0.55);
  ctx.beginPath();
  ctx.moveTo(cx - Math.floor(w*0.45), bandY);
  ctx.lineTo(cx + Math.floor(w*0.45), bandY);
  ctx.stroke();
  ctx.restore();

  // Downturned mouth opening (dark ellipse under the tip)
  ctx.save();
  ctx.fillStyle = "rgba(10,20,30,0.85)";
  ctx.beginPath();
  ctx.ellipse(mouthX, mouthY + mouthDown, Math.max(2.2, pipeW*0.35), 1.6, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Tiny drip lip highlight
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(220,240,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mouthX - pipeW*0.35, mouthY + mouthDown - 0.5);
  ctx.lineTo(mouthX + pipeW*0.35, mouthY + mouthDown - 0.5);
  ctx.stroke();
  ctx.restore();

  // --- Soft neon outline for readability (follows the pipe path)
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4, 0.55, traceGooseneck);

  // Optional: subtle outline around the flashing to match your style
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.2, 3, 0.45, () => {
    ctx.beginPath();
    ctx.moveTo(fx + 2,      fy);
    ctx.lineTo(fx + fw - 2, fy);
    ctx.lineTo(fx + fw,     fy + 2);
    ctx.lineTo(fx + fw - 2, fy + fh);
    ctx.lineTo(fx + 2,      fy + fh);
    ctx.lineTo(fx,          fy + 2);
    ctx.closePath();
  });
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
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const yBot = y + h;

  // proportions
  const bodyR = Math.min(8, Math.floor(w * 0.35));
  const bodyH = h - 14;                 // leave room for legs/feet
  const cx = x + w/2;

  // ---- 1) Deck contact: tar pads + feet/plates ----
  const legW = Math.max(3, Math.floor(w * 0.10));
  const legH = Math.max(12, Math.floor(h * 0.20));
  const footW = Math.max(8, Math.floor(w * 0.28));
  const footH = 3;

  const legLX = x + 5;
  const legRX = x + w - 5 - legW;
  const legTop = yBot - legH;

  // tar blobs
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = shade(PALETTE.obstacleOutline, -40);
  roundRect(ctx, legLX - 6, yBot - footH - 1, footW, footH, 2, true);
  roundRect(ctx, legRX - 2, yBot - footH - 1, footW, footH, 2, true);
  ctx.restore();

  // legs
  const lg = ctx.createLinearGradient(0, legTop, 0, yBot);
  lg.addColorStop(0, shade(PALETTE.obstacleFill, -22));
  lg.addColorStop(1, shade(PALETTE.obstacleFill, -34));
  ctx.fillStyle = lg;
  roundRect(ctx, legLX, legTop, legW, legH, 2, true);
  roundRect(ctx, legRX, legTop, legW, legH, 2, true);

  // foot plates
  ctx.save();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -18);
  roundRect(ctx, legLX - 2, yBot - footH - 2, legW + 4, footH, 2, true);
  roundRect(ctx, legRX - 2, yBot - footH - 2, legW + 4, footH, 2, true);
  ctx.restore();

  // light cross brace hint between legs
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -16);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(legLX + legW/2, yBot - 2 - footH);
  ctx.lineTo(legRX + legW/2, legTop + 4);
  ctx.moveTo(legRX + legW/2, yBot - 2 - footH);
  ctx.lineTo(legLX + legW/2, legTop + 4);
  ctx.stroke();
  ctx.restore();

  // ---- 2) Tank body (cylindrical feel) ----
  // curved side gradient (slightly brighter center)
  const gBody = ctx.createLinearGradient(x, y, x + w, y);
  gBody.addColorStop(0.0, shade(PALETTE.obstacleFill, -18));
  gBody.addColorStop(0.5, shade(PALETTE.obstacleFill,  6));
  gBody.addColorStop(1.0, shade(PALETTE.obstacleFill, -22));
  ctx.fillStyle = gBody;
  roundRect(ctx, x, y, w, bodyH, bodyR, true);

  // vertical wood staves (subtle)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -28);
  ctx.lineWidth = 1;
  for (let sx = x + 4; sx < x + w - 4; sx += 4.5){
    ctx.beginPath();
    ctx.moveTo(sx, y + 5);
    ctx.lineTo(sx, y + bodyH - 5);
    ctx.stroke();
  }
  ctx.restore();

  // steel hoops (bands)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -8);
  ctx.lineWidth = 2;
  const bands = 3;
  for (let i = 0; i < bands; i++){
    const yy = y + 10 + i * Math.max(10, Math.floor((bodyH - 22)/(bands-1 || 1)));
    ctx.beginPath();
    ctx.moveTo(x + 4, yy);
    ctx.lineTo(x + w - 4, yy);
    ctx.stroke();
  }
  ctx.restore();

  // base ring (just above legs)
  const ringY = y + bodyH - 5;
  const gRing = ctx.createLinearGradient(x, ringY, x, ringY + 6);
  gRing.addColorStop(0, shade(PALETTE.obstacleFill, 12));
  gRing.addColorStop(1, shade(PALETTE.obstacleFill, -14));
  ctx.fillStyle = gRing;
  roundRect(ctx, x + 2, ringY, w - 4, 6, 3, true);

  // ---- 3) Top: rim ellipse + conical cap + hatch/vent ----
  // top rim
  ctx.save();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -10);
  ctx.beginPath();
  ctx.ellipse(cx, y, w/2, Math.max(5, Math.floor(w/6)), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // conical cap
  const coneH = Math.min(18, Math.floor(w * 0.7));
  ctx.save();
  const gCone = ctx.createLinearGradient(cx, y - coneH, cx, y + 2);
  gCone.addColorStop(0, shade(PALETTE.obstacleFill,  8));
  gCone.addColorStop(1, shade(PALETTE.obstacleFill, -16));
  ctx.fillStyle = gCone;
  ctx.beginPath();
  ctx.moveTo(cx - w*0.34, y);
  ctx.lineTo(cx,           y - coneH);
  ctx.lineTo(cx + w*0.34, y);
  ctx.closePath();
  ctx.fill();
  // tiny spec
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(200,230,255,0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - w*0.18, y - coneH*0.45);
  ctx.lineTo(cx + w*0.18, y - coneH*0.45);
  ctx.stroke();
  ctx.restore();

  // hatch + vent on the cap
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -20);
  roundRect(ctx, cx - 4, y - coneH + 2, 8, 5, 2, true); // hatch
  ctx.beginPath();
  ctx.arc(cx + w*0.18, y - coneH*0.4, 2, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // ---- 4) Ladder on the side ----
  const ladderX = x + w - 6;
  const ladderTop = y + 8;
  const ladderBot = y + bodyH - 6;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -12);
  ctx.lineWidth = 1;
  // rails
  ctx.beginPath();
  ctx.moveTo(ladderX - 2, ladderTop);
  ctx.lineTo(ladderX - 2, ladderBot);
  ctx.moveTo(ladderX + 2, ladderTop);
  ctx.lineTo(ladderX + 2, ladderBot);
  ctx.stroke();
  // rungs
  for (let yy = ladderTop + 4; yy < ladderBot - 2; yy += 6){
    ctx.beginPath();
    ctx.moveTo(ladderX - 3, yy);
    ctx.lineTo(ladderX + 3, yy);
    ctx.stroke();
  }
  ctx.restore();

  // ---- 5) Overflow/conduit (left side) ----
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
  ctx.lineWidth = 1.6;
  const px1 = x + 2.5, py1 = y + Math.floor(bodyH * 0.60);
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.quadraticCurveTo(px1 - 10, py1 + 2, px1 - 8, py1 + 14);
  ctx.stroke();
  ctx.restore();

  // ---- 6) Soft highlights ----
  // front highlight column
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#cfe6ff";
  roundRect(ctx, x + Math.floor(w*0.22), y + 8, Math.max(8, Math.floor(w*0.30)), bodyH - 14, 3, true);
  ctx.restore();

  // ---- 7) Neon accents / hitbox readability ----
  // main body neon
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () =>
    roundRectPath(ctx, x, y, w, bodyH, bodyR)
  );

  // faint neon around top rim ellipse
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.4, 4, 0.45, () => {
    ctx.beginPath();
    ctx.ellipse(cx, y, w/2, Math.max(5, Math.floor(w/6)), 0, 0, Math.PI * 2);
  });

  // subtle neon on ladder rails (adds depth but doesn’t compete)
  neonStrokePath(ctx, shade(PALETTE.obstacleOutline, -8), 1.2, 3.0, 0.40, () => {
    ctx.beginPath();
    ctx.moveTo(ladderX - 2, ladderTop);
    ctx.lineTo(ladderX - 2, ladderBot);
    ctx.moveTo(ladderX + 2, ladderTop);
    ctx.lineTo(ladderX + 2, ladderBot);
  });
}

function drawBillboard(ctx, o, t){
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const contactY = y + h;                 // deck line at bottom of hitbox

  // geometry
  const faceR = 4;
  const legW = Math.max(4, Math.floor(w * 0.035));
  const legH = Math.max(10, Math.floor(h * 0.22));
  const faceH = h - legH - 6;             // leave room for legs + catwalk
  const faceY = y;
  const faceW = w;
  const faceX = x;

  // leg positions
  const legLX = Math.round(x + Math.max(8, w * 0.08));
  const legRX = Math.round(x + w - Math.max(8, w * 0.08) - legW);
  const legTop = y + faceH + 2;

  // -------------------- BASE / LEGS --------------------
  // tar pads under legs (NYC torch-down blobs)
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle   = shade(PALETTE.obstacleOutline, -40);
  roundRect(ctx, legLX - 6, contactY - 3, Math.max(18, legW + 12), 3, 2, true);
  roundRect(ctx, legRX - 6, contactY - 3, Math.max(18, legW + 12), 3, 2, true);
  ctx.restore();

  // legs (fake I-beam: side flanges brighter, web darker)
  const lg = ctx.createLinearGradient(0, legTop, 0, contactY);
  lg.addColorStop(0, shade(PALETTE.obstacleFill, -18));
  lg.addColorStop(1, shade(PALETTE.obstacleFill, -30));
  ctx.fillStyle = lg;
  roundRect(ctx, legLX, legTop, legW, legH, 2, true);
  roundRect(ctx, legRX, legTop, legW, legH, 2, true);
  // web lines
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -16);
  ctx.lineWidth = 1;
  const webX1 = legLX + Math.floor(legW/2) + 0.5;
  const webX2 = legRX + Math.floor(legW/2) + 0.5;
  ctx.beginPath(); ctx.moveTo(webX1, legTop + 1); ctx.lineTo(webX1, contactY - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(webX2, legTop + 1); ctx.lineTo(webX2, contactY - 4); ctx.stroke();
  ctx.restore();

  // cross braces between legs
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

  // platform slab
  const gWalk = ctx.createLinearGradient(x, walkY, x, walkY + walkH);
  gWalk.addColorStop(0, shade(PALETTE.obstacleFill,  6));
  gWalk.addColorStop(1, shade(PALETTE.obstacleFill, -14));
  ctx.fillStyle = gWalk;
  roundRect(ctx, x + 4, walkY, w - 8, walkH, 3, true);

  // grating lines
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -18);
  ctx.lineWidth = 1;
  for (let gx = x + 8; gx < x + w - 8; gx += 6){
    ctx.beginPath(); ctx.moveTo(gx, walkY + 1); ctx.lineTo(gx, walkY + walkH - 1); ctx.stroke();
  }
  ctx.restore();

  // railing posts + top rail
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

  // -------------------- FACE / SKIN --------------------
  // panel frame
  const frameInset = 2;
  const faceInnerX = faceX + frameInset;
  const faceInnerY = faceY + frameInset;
  const faceInnerW = faceW - frameInset*2;
  const faceInnerH = faceH - frameInset*2;

  // outer frame
  const gFrame = ctx.createLinearGradient(faceX, faceY, faceX, faceY + faceH);
  gFrame.addColorStop(0, shade(PALETTE.obstacleFill, -8));
  gFrame.addColorStop(1, shade(PALETTE.obstacleFill, -22));
  ctx.fillStyle = gFrame;
  roundRect(ctx, faceX, faceY, faceW, faceH, faceR, true);

  // inner panel (paper/mesh)
  const gFace = ctx.createLinearGradient(faceInnerX, faceInnerY, faceInnerX, faceInnerY + faceInnerH);
  gFace.addColorStop(0, "#16243f");
  gFace.addColorStop(0.55, "#0f1a33");
  gFace.addColorStop(1, "#0b1326");
  ctx.fillStyle = gFace;
  roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);

  // perimeter bolts
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

  // paper seams/tears (vertical)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#253a66";
  ctx.lineWidth = 1;
  for (let sx = faceInnerX + 12; sx < faceInnerX + faceInnerW - 12; sx += 16){
    ctx.beginPath(); ctx.moveTo(sx, faceInnerY + 6); ctx.lineTo(sx, faceInnerY + faceInnerH - 6); ctx.stroke();
  }
  ctx.restore();

  // vignette corners (helps depth)
  ctx.save();
  const vg = ctx.createRadialGradient(faceInnerX, faceInnerY, 0, faceInnerX, faceInnerY, Math.max(faceInnerW, faceInnerH));
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = vg;
  roundRect(ctx, faceInnerX, faceInnerY, faceInnerW, faceInnerH, Math.max(2, faceR-1), true);
  ctx.restore();

  // crossing brace shadow hint behind paper
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

  // animated scanline (kept from your original)
  const scan = (performance.now() * 0.12) % (faceInnerH - 2);
  ctx.fillStyle = "rgba(90,176,255,0.18)";
  ctx.fillRect(faceInnerX + 2, faceInnerY + 1 + scan, faceInnerW - 4, 3);

  // -------------------- TOP LAMPS --------------------
  const lampCount = Math.max(2, Math.floor(w / 60));
  for (let i = 0; i < lampCount; i++){
    const u = (i + 0.5) / lampCount;
    const lx = Math.floor(faceX + 10 + u * (faceW - 20));
    const ly = faceY - 4;
    // head
    ctx.save();
    ctx.fillStyle = shade(PALETTE.obstacleFill, -8);
    ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI*2); ctx.fill();
    // arm
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + 6); ctx.stroke();
    // cone of light
    const flicker = 0.7 + 0.3 * Math.sin((t || 0) * 6 + i*1.7);
    ctx.globalCompositeOperation = "lighter";
    const lg = ctx.createRadialGradient(lx, ly + 8, 0, lx, ly + 8, 40);
    lg.addColorStop(0, `rgba(160,210,255,${0.20 * flicker})`);
    lg.addColorStop(1, "rgba(160,210,255,0.00)");
    ctx.fillStyle = lg;
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
  // face neon (primary)
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () =>
    roundRectPath(ctx, faceX, faceY, faceW, faceH, faceR)
  );

  // post accents (subtle) – and ensure they "kiss" the deck
  const postLX = Math.round(legLX) + 0.5;
  const postRX = Math.round(legRX + legW) - 0.5;
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.4, 4, 0.45, () => {
    ctx.beginPath();
    ctx.moveTo(postLX, legTop);  ctx.lineTo(postLX, contactY + 2.5);
    ctx.moveTo(postRX, legTop);  ctx.lineTo(postRX, contactY + 2.5);
  });

  // tiny deck stitches at post feet (avoid micro-gaps on some DPRs)
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

  // 6) LOW “DUCK” BAR — the ONLY neon part
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

  // neon outline (duck!)
  neonStrokePath(ctx, P.obstacleOutline, 1.6, 4, 0.55,
    () => roundRectPath(ctx, barX, beamY, barW, beamH, 3)
  );
}

function drawWire(ctx, o){
  const x1 = o.x, x2 = o.x + o.w;
  const y  = o.y;                        // wire anchor height (highest point of the span)
  const sag = o.sag || 14;
  const deckY = (o.baseY ?? (y + 44));   // roof line fallback if baseY not provided

  const cx = (x1 + x2) / 2;
  const cy = y + sag;

  // ----- helper: visual (non-colliding, non-neon) drop-leg pole -----
  const drawDropPole = (px, side /* -1 left, +1 right */) => {
    const padH  = 3;
    const poleW = 8;

    // Make the pole just a hair taller than the wire’s highest point (y).
    // Scale a touch with span width but clamp to a sensible range.
    const overTop = Math.max(14, Math.min(6, Math.round(o.w * 0.02))); // 3–6 px above the wire
    const topY = y - overTop;            // smaller Y = visually higher
    const armW = 18, armH = 4;
    const armY = topY + 2;               // crossarm just under the top
    const armX = px - armW/2;

    // tar pad on deck
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = shade(PALETTE.obstacleOutline, -40);
    roundRect(ctx, px - 10, deckY - padH, 20, padH, 2, true);
    ctx.restore();

    // pole shaft (matte, non-neon)
    const gPole = ctx.createLinearGradient(px, topY, px, deckY);
    gPole.addColorStop(0, shade(PALETTE.obstacleFill, -10));
    gPole.addColorStop(0.5, PALETTE.obstacleFill);
    gPole.addColorStop(1, shade(PALETTE.obstacleFill, -26));
    ctx.fillStyle = gPole;
    roundRect(ctx, px - poleW/2, topY, poleW, deckY - topY, 3, true);

    // bands + tiny bolts
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -14);
    ctx.lineWidth = 1;
    const b1 = armY + 6, b2 = deckY - 10;
    [b1, b2].forEach(by => {
      ctx.beginPath(); ctx.moveTo(px - poleW/2 + 1.5, by); ctx.lineTo(px + poleW/2 - 1.5, by); ctx.stroke();
    });
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = shade(PALETTE.obstacleOutline, -10);
    ctx.fillRect(px - 1, b1 - 1, 2, 2);
    ctx.fillRect(px - 1, b2 - 1, 2, 2);
    ctx.restore();

    // crossarm (no neon)
    const gArm = ctx.createLinearGradient(armX, armY, armX, armY + armH);
    gArm.addColorStop(0, shade(PALETTE.obstacleFill, 10));
    gArm.addColorStop(1, shade(PALETTE.obstacleFill, -16));
    ctx.fillStyle = gArm;
    roundRect(ctx, armX, armY, armW, armH, 2, true);

    // diagonal brace
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = shade(PALETTE.obstacleOutline, -10);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, armY + armH);
    ctx.lineTo(px + side * (armW * 0.35), armY + armH + 6);
    ctx.stroke();
    ctx.restore();

    // insulator puck on outer half + matte jumper into the wire anchor
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

    // soft highlight on pole (still non-neon)
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#cfe6ff";
    roundRect(ctx, px - poleW/2 + 1, topY + 6, 3, Math.max(12, deckY - topY - 12), 2, true);
    ctx.restore();
  };

  // place drop-legs slightly outside the span so silhouettes read
  const offset = Math.max(8, Math.min(14, Math.floor(o.w * 0.035)));
  drawDropPole(x1 - offset, -1);
  drawDropPole(x2 + offset,  1);

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