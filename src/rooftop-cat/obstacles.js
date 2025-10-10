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
    ["access_shed",   9],
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

  // --- create the obstacle (unchanged)
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
      baseY: gy
    });
  } else {
    const span=140+Math.random()*140 + extraSpan;
    const y=gy-(48+Math.random()*26);
    const sag=10+Math.random()*20, poleH=28+Math.random()*16;
    state.obstacles.push({type:"wire",x:w+40,y,w:span,h:4,sag,poleH});
  }

  // No explicit delay returned → RooftopCat.jsx uses your existing fallback timing.
  // (That timing stays exactly as-is.)
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
  ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = PALETTE.obstacleOutline;
  roundRect(ctx, o.x-2, o.y-2, o.w+4, o.h+4, 3, true); ctx.restore();
  const g = ctx.createLinearGradient(o.x, o.y, o.x+o.w, o.y);
  g.addColorStop(0, shade(PALETTE.obstacleFill, -8));
  g.addColorStop(0.5, PALETTE.obstacleFill);
  g.addColorStop(1, shade(PALETTE.obstacleFill, -18));
  ctx.fillStyle = g;
  roundRect(ctx, o.x, o.y, o.w, o.h, 3, true);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shade(PALETTE.obstacleFill, -35);
  ctx.lineWidth = 1;
  const rowH = 6;
  for (let y = o.y + 4; y < o.y + o.h - 4; y += rowH) {
    ctx.beginPath(); ctx.moveTo(o.x+3, y); ctx.lineTo(o.x+o.w-3, y); ctx.stroke();
    let startX = (Math.floor((y - o.y)/rowH) % 2 === 0) ? o.x + 6 : o.x + 12;
    for (let x = startX; x < o.x + o.w - 6; x += 12) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.fillStyle = "#2a3760"; roundRect(ctx, o.x-3, o.y-4, o.w+6, 7, 3, true);
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => roundRectPath(ctx, o.x, o.y, o.w, o.h, 3));
}

function drawAntenna(ctx, o, t){
  ctx.strokeStyle = PALETTE.obstacleOutline; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(o.x + o.w/2, o.y); ctx.lineTo(o.x + o.w/2, o.y + o.h); ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(o.x + o.w/2, o.y + o.h*0.25); ctx.lineTo(o.x + 2, o.y + o.h*0.45);
  ctx.moveTo(o.x + o.w/2, o.y + o.h*0.40); ctx.lineTo(o.x + o.w - 2, o.y + o.h*0.60);
  ctx.stroke(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(o.x + o.w/2, o.y + 8, 10, 0, Math.PI*2); ctx.strokeStyle = "#5bbcff"; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
  const blink = 0.55 + 0.45 * Math.sin(t * 4);
  ctx.beginPath(); ctx.arc(o.x + o.w/2, o.y, 3, 0, Math.PI*2); ctx.fillStyle = `rgba(255,107,107,${blink})`; ctx.fill();
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => { ctx.beginPath(); ctx.moveTo(o.x + o.w/2, o.y); ctx.lineTo(o.x + o.w/2, o.y + o.h); });
}

function drawHVAC(ctx, o){
  const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y+o.h);
  g.addColorStop(0, shade(PALETTE.obstacleFill, 10));
  g.addColorStop(1, shade(PALETTE.obstacleFill, -10));
  ctx.fillStyle = g;
  roundRect(ctx, o.x, o.y, o.w, o.h, 3, true);
  ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = shade(PALETTE.obstacleOutline, -20); ctx.lineWidth = 1;
  for (let x = o.x + 4; x < o.x + o.w - 4; x += 4) { ctx.beginPath(); ctx.moveTo(x, o.y+4); ctx.lineTo(x, o.y + o.h - 4); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -25);
  ctx.fillRect(o.x+4, o.y+o.h-3, 12, 3);
  ctx.fillRect(o.x+o.w-16, o.y+o.h-3, 12, 3);
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => roundRectPath(ctx, o.x, o.y, o.w, o.h, 3));
}

function drawSkylight(ctx, o){
  const slope = o.slope || 1;
  const yTop = o.y, yBot = o.y + o.h;
  const left = o.x, right = o.x + o.w;
  const ridge = yTop + (slope>0 ? 4 : o.h-4);
  ctx.fillStyle = shade(PALETTE.obstacleFill, 8);
  ctx.beginPath(); ctx.moveTo(left, yBot); ctx.lineTo(left+8, ridge); ctx.lineTo(right-8, ridge); ctx.lineTo(right, yBot); ctx.closePath(); ctx.fill();
  const gg = ctx.createLinearGradient(left, ridge, left, yBot);
  gg.addColorStop(0, "rgba(190,210,255,0.22)"); gg.addColorStop(1, "rgba(190,210,255,0.05)");
  ctx.fillStyle = gg; ctx.fillRect(left+8, ridge, o.w-16, Math.max(3, yBot - ridge));
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => { ctx.beginPath(); ctx.moveTo(left, yBot); ctx.lineTo(left+8, ridge); ctx.lineTo(right-8, ridge); ctx.lineTo(right, yBot); ctx.closePath(); });
}

function drawVentPipe(ctx, o){
  const g = ctx.createLinearGradient(o.x, o.y, o.x+o.w, o.y);
  g.addColorStop(0, shade(PALETTE.obstacleFill, -12));
  g.addColorStop(0.5, PALETTE.obstacleFill);
  g.addColorStop(1, shade(PALETTE.obstacleFill, -18));
  ctx.fillStyle = g;
  roundRect(ctx, o.x, o.y, o.w, o.h, Math.min(6, o.w*0.4), true);
  ctx.fillStyle = shade(PALETTE.obstacleFill, -20);
  roundRect(ctx, o.x-2, o.y-6, o.w+4, 6, 3, true);
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => roundRectPath(ctx, o.x, o.y, o.w, o.h, Math.min(6, o.w*0.4)));
}

function drawAccessShed(ctx, o){
  ctx.fillStyle = shade(PALETTE.obstacleFill, -4);
  roundRect(ctx, o.x, o.y+6, o.w, o.h-6, 2, true);
  const dir = o.roofDir || 1;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -18);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y+6); ctx.lineTo(o.x + o.w, o.y+6);
  ctx.lineTo(o.x + o.w + 8*dir, o.y); ctx.lineTo(o.x + 8*dir, o.y);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(PALETTE.obstacleFill, 10);
  const dw = Math.min(16, o.w-12);
  roundRect(ctx, o.x + (o.w - dw)/2, o.y + o.h - 16, dw, 14, 2, true);
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => {
    ctx.beginPath();
    ctx.moveTo(o.x, o.y+o.h);
    ctx.lineTo(o.x, o.y+6);
    ctx.lineTo(o.x + 8*dir, o.y);
    ctx.lineTo(o.x + o.w + 8*dir, o.y);
    ctx.lineTo(o.x + o.w, o.y+6);
    ctx.lineTo(o.x + o.w, o.y+o.h);
    ctx.closePath();
  });
}

function drawWaterTank(ctx, o){
  ctx.fillStyle = shade(PALETTE.obstacleFill, -30);
  const legW = 3, legH = 14;
  ctx.fillRect(o.x+4, o.y+o.h-legH, legW, legH);
  ctx.fillRect(o.x+o.w-7, o.y+o.h-legH, legW, legH);
  ctx.fillStyle = shade(PALETTE.obstacleFill, -4);
  roundRect(ctx, o.x, o.y, o.w, o.h-12, 6, true);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shade(PALETTE.obstacleOutline, -30);
  ctx.lineWidth = 1;
  for (let x = o.x + 4; x < o.x + o.w - 4; x += 5) { ctx.beginPath(); ctx.moveTo(x, o.y+4); ctx.lineTo(x, o.y + o.h - 18); ctx.stroke(); }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = shade(PALETTE.obstacleFill, -12);
  ctx.beginPath(); ctx.ellipse(o.x + o.w/2, o.y, o.w/2, 6, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => roundRectPath(ctx, o.x, o.y, o.w, o.h-12, 6));
}

function drawBillboard(ctx, o, t){
  ctx.fillStyle = shade(PALETTE.obstacleFill, -28);
  ctx.fillRect(o.x+10, o.y+o.h-8, 4, 8);
  ctx.fillRect(o.x+o.w-14, o.y+o.h-8, 4, 8);
  const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y+o.h);
  g.addColorStop(0, "#17223c"); g.addColorStop(1, "#0f1830");
  ctx.fillStyle = g; roundRect(ctx, o.x, o.y, o.w, o.h-6, 4, true);
  ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = "#2a3a60";
  ctx.beginPath();
  ctx.moveTo(o.x+6, o.y+6); ctx.lineTo(o.x+o.w-6, o.y+o.h-14);
  ctx.moveTo(o.x+o.w-6, o.y+6); ctx.lineTo(o.x+6, o.y+o.h-14);
  ctx.stroke(); ctx.restore();
  const scan = (performance.now()*0.12) % (o.h-12);
  ctx.fillStyle = "rgba(90,176,255,0.18)"; ctx.fillRect(o.x+4, o.y+4+scan, o.w-8, 3);
  neonStrokePath(ctx, PALETTE.obstacleOutline, 2, 6, 0.55, () => roundRectPath(ctx, o.x, o.y, o.w, o.h-6, 4));
}

function drawWaterTowerGate(ctx, o, P){
  const baseY = o.baseY;
  const beamY = o.y;
  const beamH = o.h;

  // geometry
  const inset = Math.max(10, o.w * 0.18);
  const legW  = Math.max(4, Math.min(7, o.w * 0.08));
  const xL = o.x + inset;
  const xR = o.x + o.w - inset - legW;

  const legH = o.clearance + beamH + o.stem; // ground → platform underside
  const platformY = baseY - legH;            // top of legs / under tank
  const tankPad = 6;                          // platform thickness
  const tx = o.x + 8;                         // tank box
  const tw = o.w - 16;
  const tankY = platformY - tankPad - o.tankH;

  // --- legs (no neon)
  ctx.fillStyle = shade(P.obstacleFill, -30);
  roundRect(ctx, xL, baseY - legH, legW, legH, 2, true);
  roundRect(ctx, xR, baseY - legH, legW, legH, 2, true);

  // cross braces (no neon)
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

  // platform
  ctx.fillStyle = shade(P.obstacleFill, -18);
  roundRect(ctx, o.x + 6, platformY - tankPad, o.w - 12, tankPad, 3, true);

  // --- tank (no neon)
  ctx.fillStyle = shade(P.obstacleFill, -4);
  roundRect(ctx, tx, tankY, tw, o.tankH, 6, true);

  // tank slats
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = shade(P.obstacleOutline, -30);
  ctx.lineWidth = 1;
  for (let x = tx + 4; x < tx + tw - 4; x += 5) {
    ctx.beginPath(); ctx.moveTo(x, tankY + 4); ctx.lineTo(x, tankY + o.tankH - 4); ctx.stroke();
  }
  ctx.restore();

  // top ellipse + tiny cap
  ctx.save();
  ctx.fillStyle = shade(P.obstacleFill, -12);
  ctx.beginPath(); ctx.ellipse(tx + tw/2, tankY, tw/2, 6, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = shade(P.obstacleFill, -26);
  ctx.beginPath();
  ctx.moveTo(tx + tw*0.5 - tw*0.15, tankY - 6);
  ctx.lineTo(tx + tw*0.5,           tankY - 12);
  ctx.lineTo(tx + tw*0.5 + tw*0.15, tankY - 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // ladder (no neon)
  const lx = xR + Math.max(4, legW - 2);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = shade(P.obstacleOutline, -10);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx, tankY + 6); ctx.lineTo(lx, platformY - 2); ctx.stroke();
  for (let y = tankY + 10; y < platformY - 2; y += 5) {
    ctx.beginPath(); ctx.moveTo(lx - 3, y); ctx.lineTo(lx + 3, y); ctx.stroke();
  }
  ctx.restore();

  // --- LOW “DUCK” BAR (the ONLY neon part)
  const innerL = xL + legW + 2;
  const innerR = xR - 2;
  const barW = Math.max(20, innerR - innerL);
  const barX = innerL;

  // bar body
  const g = ctx.createLinearGradient(barX, beamY, barX + barW, beamY);
  g.addColorStop(0, shade(P.obstacleFill, -8));
  g.addColorStop(0.5, P.obstacleFill);
  g.addColorStop(1, shade(P.obstacleFill, -18));
  ctx.fillStyle = g;
  roundRect(ctx, barX, beamY, barW, beamH, 3, true);

  // thin neon outline to signal "duck"
  neonStrokePath(ctx, P.obstacleOutline, 1.6, 4, 0.55,
    () => roundRectPath(ctx, barX, beamY, barW, beamH, 3)
  );
}

function drawWire(ctx, o){
  const x1 = o.x, x2 = o.x + o.w;
  const y = o.y, sag = o.sag || 14, poleH = o.poleH || 30;
  ctx.fillStyle = shade(PALETTE.obstacleFill, -28);
  roundRect(ctx, x1-3, y - poleH, 6, poleH, 2, true);
  roundRect(ctx, x2-3, y - poleH, 6, poleH, 2, true);
  ctx.fillStyle = "#a9e6ff"; ctx.globalAlpha = 0.35;
  roundRect(ctx, x1-4, y-3, 8, 6, 2, true);
  roundRect(ctx, x2-4, y-3, 8, 6, 2, true);
  ctx.globalAlpha = 1;
  const cx = (x1 + x2) / 2; const cy = y + sag;
  ctx.strokeStyle = PALETTE.wireGlow; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); ctx.stroke();
  ctx.strokeStyle = PALETTE.wireCore; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); ctx.stroke();
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4, 0.35, () => { ctx.beginPath(); ctx.moveTo(x1, y); ctx.quadraticCurveTo(cx, cy, x2, y); });
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4, 0.45, () => roundRectPath(ctx, x1-3, y - poleH, 6, poleH, 2));
  neonStrokePath(ctx, PALETTE.obstacleOutline, 1.6, 4, 0.45, () => roundRectPath(ctx, x2-3, y - poleH, 6, poleH, 2));
}
