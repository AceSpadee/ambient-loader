// drawDeck.js
import { PALETTE } from "./palette.js";
import { roundRect } from "./utils.js";

/* -----------------------------------------------------------
   THEME REGISTRY
   - Add more themes by pushing { name, draw } entries.
   - Each draw(ctx, x, w, topY, botY) renders ONE bay look
     (no animations, cache-friendly, static).
----------------------------------------------------------- */

function drawBayRibs_Skyscraper(ctx, x, w, topY, botY){
  const padX = 9, padTop = 14, padBot = 48;
  const gx = Math.round(x + padX);
  const gw = Math.round(w - padX * 2);
  const gy = Math.round(topY + padTop);
  const gh = Math.round((botY - topY) - (padTop + padBot));
  if (gw < 80 || gh < 48) return;

  // reflective base
  const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
  g.addColorStop(0.00, "rgba(9,18,32,1.00)");
  g.addColorStop(0.25, "rgba(15,26,44,1.00)");
  g.addColorStop(0.50, "rgba(24,44,74,0.95)");
  g.addColorStop(0.55, "rgba(140,190,255,0.18)");
  g.addColorStop(1.00, "rgba(8,16,28,1.00)");
  ctx.fillStyle = g;
  roundRect(ctx, gx, gy, gw, gh, 3, true);

  // vertical ribs (low-contrast)
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#162a44";
  ctx.lineWidth = 1;
  for (let x2 = gx + 8.5; x2 < gx + gw - 8.5; x2 += 14){
    ctx.beginPath();
    ctx.moveTo(x2, gy + 3);
    ctx.lineTo(x2, gy + gh - 3);
    ctx.stroke();
  }
  ctx.restore();

  // mullions
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#1a2f4f";
  const mL = gx + Math.floor(gw * 0.28) + 0.5;
  const mR = gx + Math.floor(gw * 0.72) + 0.5;
  ctx.beginPath(); ctx.moveTo(mL, gy + 2); ctx.lineTo(mL, gy + gh - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mR, gy + 2); ctx.lineTo(mR, gy + gh - 2); ctx.stroke();
  ctx.restore();

  // specular bars
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const bars = [
    { x: gx + Math.floor(gw * 0.18), w: 6,  a: 0.10 },
    { x: gx + Math.floor(gw * 0.52), w: 8,  a: 0.08 },
    { x: gx + Math.floor(gw * 0.82), w: 5,  a: 0.10 },
  ];
  for (const b of bars){
    const gb = ctx.createLinearGradient(b.x, gy, b.x + b.w, gy);
    gb.addColorStop(0,   "rgba(190,220,255,0.00)");
    gb.addColorStop(0.5, `rgba(190,220,255,${b.a})`);
    gb.addColorStop(1,   "rgba(190,220,255,0.00)");
    ctx.fillStyle = gb;
    ctx.fillRect(b.x, gy + 5, b.w, gh - 10);
  }
  ctx.restore();

  // bottom mech strip
  const pw = gw - 20, ph = 16, px = gx + 10, py = botY - 26;
  const pg = ctx.createLinearGradient(px, py - ph, px, py);
  pg.addColorStop(0, "#0d1a2e");
  pg.addColorStop(1, "#0a1626");
  ctx.fillStyle = pg;
  roundRect(ctx, px, py - ph, pw, ph, 2, true);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#0c223c";
  for (let y = py - ph + 4; y < py - 3; y += 4){
    ctx.fillRect(px + 6, Math.floor(y), pw - 12, 1);
  }
  ctx.restore();
}

function drawBayGlazed_TokyoReflective(ctx, x, w, topY, botY){
  const padX = 10, padTop = 16, padBot = 56;
  const gx = Math.round(x + padX);
  const gw = Math.round(w - padX * 2);
  const gy = Math.round(topY + padTop);
  const gh = Math.round((botY - topY) - (padTop + padBot));
  if (gw < 90 || gh < 52) return;

  // base glass with strong horizon reflection
  const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
  g.addColorStop(0.00, "rgba(10,20,36,1.00)");
  g.addColorStop(0.20, "rgba(16,28,48,1.00)");
  g.addColorStop(0.45, "rgba(26,50,86,0.95)");
  g.addColorStop(0.50, "rgba(170,220,255,0.22)");
  g.addColorStop(0.55, "rgba(24,46,78,0.92)");
  g.addColorStop(1.00, "rgba(8,16,30,1.00)");
  ctx.fillStyle = g;
  roundRect(ctx, gx, gy, gw, gh, 3, true);

  // side vignettes
  ctx.save();
  ctx.globalAlpha = 0.12;
  let edge = ctx.createLinearGradient(gx, 0, gx + 12, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.55)");
  edge.addColorStop(1, "rgba(0,0,0,0.0)");
  ctx.fillStyle = edge; ctx.fillRect(gx, gy + 6, 12, gh - 12);
  edge = ctx.createLinearGradient(gx + gw - 12, 0, gx + gw, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.0)");
  edge.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = edge; ctx.fillRect(gx + gw - 12, gy + 6, 12, gh - 12);
  ctx.restore();

  // faint vertical mullions
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "#1f3556";
  const mL = gx + Math.floor(gw * 0.28) + 0.5;
  const mR = gx + Math.floor(gw * 0.72) + 0.5;
  ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke();
  ctx.restore();

  // reflective diagonal wedges
  const clipRect = () => { ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip(); };
  ctx.save(); clipRect();
  const diag = (x0, y0, x1, y1, a=0.06) => {
    const gD = ctx.createLinearGradient(x0, y0, x1, y1);
    gD.addColorStop(0.00, "rgba(210,235,255,0.0)"); 
    gD.addColorStop(0.50, `rgba(210,235,255,${a})`);
    gD.addColorStop(1.00, "rgba(210,235,255,0.0)");
    return gD;
  };

  ctx.fillStyle = diag(gx, gy, gx + gw, gy + gh, 0.07);
  ctx.beginPath();
  ctx.moveTo(gx + 18, gy + 20);
  ctx.lineTo(gx + 34, gy + 20);
  ctx.lineTo(gx + gw - 46, gy + gh - 14);
  ctx.lineTo(gx + gw - 62, gy + gh - 14);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = diag(gx + gw, gy, gx, gy + gh, 0.05);
  ctx.beginPath();
  ctx.moveTo(gx + gw - 18, gy + 16);
  ctx.lineTo(gx + gw - 34, gy + 16);
  ctx.lineTo(gx + 56,      gy + gh - 10);
  ctx.lineTo(gx + 72,      gy + gh - 10);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // vertical lightbox sign (looks like a sign)
  const sx = gx + gw - 26, sy = gy + 12, sw = 12, sh = gh - 24;
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#081426";
  roundRect(ctx, sx - 2, sy - 2, sw + 4, sh + 4, 2, true);
  ctx.restore();

  const sg = ctx.createLinearGradient(sx, sy, sx + sw, sy);
  sg.addColorStop(0.00, "rgba(120,190,255,0.25)");
  sg.addColorStop(0.50, "rgba(210,245,255,0.60)");
  sg.addColorStop(1.00, "rgba(120,190,255,0.25)");
  ctx.fillStyle = sg;
  roundRect(ctx, sx, sy, sw, sh, 2, true);

  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = "#d8f3ff";
  for (let y = sy + 6; y < sy + sh - 6; y += 12){
    const bw = (y % 24 === 0) ? sw - 4 : sw - 6;
    const bx = sx + ((y % 24 === 0) ? 2 : 3);
    ctx.fillRect(bx, Math.floor(y), bw, 2);
  }
  ctx.restore();

  // slim top highlight
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#8fbaff";
  ctx.fillRect(gx + 3, gy + 7, gw - 6, 1);
  ctx.restore();
}

function drawBayDiagrid_Skyscraper(ctx, x, w, topY, botY){
  const padX   = 10, padTop = 16, padBot = 56;
  const gx     = Math.round(x + padX);
  const gw     = Math.round(w - padX * 2);
  const gy     = Math.round(topY + padTop);
  const gh     = Math.round((botY - topY) - (padTop + padBot));
  if (gw < 90 || gh < 52) return;

  // base glass
  const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
  g.addColorStop(0.00, "rgba(10,20,36,1.00)");
  g.addColorStop(0.22, "rgba(15,28,48,1.00)");
  g.addColorStop(0.44, "rgba(28,52,88,0.95)");
  g.addColorStop(0.50, "rgba(120,180,255,0.18)");
  g.addColorStop(0.56, "rgba(24,46,78,0.92)");
  g.addColorStop(1.00, "rgba(8,16,30,1.00)");
  ctx.fillStyle = g;
  roundRect(ctx, gx, gy, gw, gh, 3, true);

  // mullions + diagrid
  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#1f3556";
  ctx.lineWidth   = 1;

  const mL = gx + Math.floor(gw * 0.28) + 0.5;
  const mR = gx + Math.floor(gw * 0.72) + 0.5;
  ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke();

  const stepX = 22;
  for (let x0 = gx + 8; x0 < gx + gw - 8; x0 += stepX){
    const xa = x0 + 0.5;
    ctx.beginPath(); ctx.moveTo(xa, gy + 10); ctx.lineTo(xa + 34, gy + gh - 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xa + 34, gy + 10); ctx.lineTo(xa, gy + gh - 12); ctx.stroke();
  }
  ctx.restore();

  // reflective bars
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const bars = [
    { x: gx + Math.floor(gw * 0.18), w: 6,  a: 0.10 },
    { x: gx + Math.floor(gw * 0.53), w: 10, a: 0.08 },
    { x: gx + Math.floor(gw * 0.80), w: 5,  a: 0.10 },
  ];
  for (const b of bars){
    const gBar = ctx.createLinearGradient(b.x, gy, b.x + b.w, gy);
    gBar.addColorStop(0,   "rgba(190,220,255,0.00)");
    gBar.addColorStop(0.5, `rgba(190,220,255,${b.a})`);
    gBar.addColorStop(1,   "rgba(190,220,255,0.00)");
    ctx.fillStyle = gBar;
    ctx.fillRect(b.x, gy + 5, b.w, gh - 10);
  }
  ctx.restore();

  // slim sign on right
  const sx = gx + gw - 24, sy = gy + 12, sw = 10, sh = gh - 24;
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#081426";
  roundRect(ctx, sx - 2, sy - 2, sw + 4, sh + 4, 2, true);
  ctx.restore();

  const sg = ctx.createLinearGradient(sx, sy, sx + sw, sy);
  sg.addColorStop(0.00, "rgba(100,180,255,0.25)");
  sg.addColorStop(0.50, "rgba(190,240,255,0.55)");
  sg.addColorStop(1.00, "rgba(100,180,255,0.25)");
  ctx.fillStyle = sg;
  roundRect(ctx, sx, sy, sw, sh, 2, true);

  // bottom spandrel
  const pw = gw - 22, ph = 18, px2 = gx + 11, py2 = botY - 28;
  const pg = ctx.createLinearGradient(px2, py2 - ph, px2, py2);
  pg.addColorStop(0, "#0d1a2e"); pg.addColorStop(1, "#0a1626");
  ctx.fillStyle = pg; roundRect(ctx, px2, py2 - ph, pw, ph, 2, true);
  ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#0c223c";
  for (let y = py2 - ph + 4; y < py2 - 3; y += 5){
    ctx.fillRect(px2 + 6, Math.floor(y), pw - 12, 1);
  }
  ctx.restore();
}

function drawBayGlazed_Skyscraper(ctx, x, w, topY, botY){
  // ---- Geometry (keep things integer-ish for crispness)
  const padX   = 12, padTop = 16, padBot = 52;
  const gx     = Math.round(x + padX);
  const gw     = Math.round(w - padX * 2);
  const gy     = Math.round(topY + padTop);
  const gh     = Math.round((botY - topY) - (padTop + padBot));

  if (gw < 92 || gh < 48) return; // too tight → skip details

  // ========== 1) Deep glass field with horizon band ==========
  {
    const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
    // top → very dark
    g.addColorStop(0.00, "rgba(13,24,40,1.00)");
    // upper mid → cool blue
    g.addColorStop(0.28, "rgba(16,30,50,1.00)");
    // horizon strip (reflective)
    g.addColorStop(0.42, "rgba(30,56,92,0.92)");
    g.addColorStop(0.50, "rgba(92,148,220,0.22)");
    g.addColorStop(0.58, "rgba(28,54,88,0.90)");
    // lower → dark again
    g.addColorStop(1.00, "rgba(10,22,40,1.00)");
    ctx.fillStyle = g;
    roundRect(ctx, gx, gy, gw, gh, 3, true);
  }

  // Inner AO/vignette (left/right) to sell depth
  ctx.save();
  ctx.globalAlpha = 0.12;
  let edge = ctx.createLinearGradient(gx, 0, gx + 12, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.55)");
  edge.addColorStop(1, "rgba(0,0,0,0.0)");
  ctx.fillStyle = edge;
  ctx.fillRect(gx, gy + 6, 12, gh - 12);

  edge = ctx.createLinearGradient(gx + gw - 12, 0, gx + gw, 0);
  edge.addColorStop(0, "rgba(0,0,0,0.0)");
  edge.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = edge;
  ctx.fillRect(gx + gw - 12, gy + 6, 12, gh - 12);
  ctx.restore();

  // Subtle top highlight + side rims
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#8fbaff";
  ctx.fillRect(gx + 3, gy + 6, gw - 6, 1);
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#92b8ff";
  ctx.fillRect(gx + 2,      gy + 10, 1, gh - 20);
  ctx.fillRect(gx + gw - 3, gy + 10, 1, gh - 20);
  ctx.restore();

  // ========== 2) Curtain-wall mullions & spandrels (Tokyo rhythm) ==========
  // Vertical mullions (match other theme positions for coherence)
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#102138";
  ctx.lineWidth = 1;
  const mL = gx + Math.floor(gw * 0.28) + 0.5;
  const mR = gx + Math.floor(gw * 0.72) + 0.5;
  ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke();
  ctx.restore();

  // Dense spandrels (thin paired lines)
  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#12243e";
  ctx.lineWidth = 1;
  const step = 22;
  for (let y = gy + 18; y < gy + gh - 14; y += step){
    const yy = Math.floor(y) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx + 6, yy);     ctx.lineTo(gx + gw - 6, yy);     ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.beginPath(); ctx.moveTo(gx + 6, yy + 2); ctx.lineTo(gx + gw - 6, yy + 2); ctx.stroke();
    ctx.globalAlpha = 0.11;
  }
  ctx.restore();

  // ========== 3) Stronger reflective cues (specular stripes & diagonals) ==========
  // Vertical specular bars (lighter blend)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const bars = [
    { x: gx + Math.floor(gw * 0.18), w: 6, a: 0.10 },
    { x: gx + Math.floor(gw * 0.48), w: 10, a: 0.08 },
    { x: gx + Math.floor(gw * 0.78), w: 5, a: 0.10 },
  ];
  for (const b of bars){
    const gBar = ctx.createLinearGradient(b.x, gy, b.x + b.w, gy);
    gBar.addColorStop(0, `rgba(180,210,255,0.00)`);
    gBar.addColorStop(0.5, `rgba(180,210,255,${b.a})`);
    gBar.addColorStop(1, `rgba(180,210,255,0.00)`);
    ctx.fillStyle = gBar;
    ctx.fillRect(b.x, gy + 4, b.w, gh - 8);
  }

  // Two diagonal “streak” wedges (very faint)
  const diag = (x0, y0, x1, y1, a=0.05) => {
    const gD = ctx.createLinearGradient(x0, y0, x1, y1);
    gD.addColorStop(0.00, "rgba(200,230,255,0.0)");
    gD.addColorStop(0.50, `rgba(200,230,255,${a})`);
    gD.addColorStop(1.00, "rgba(200,230,255,0.0)");
    return gD;
  };
  // Clip to glass
  ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip();
  ctx.fillStyle = diag(gx, gy, gx + gw, gy + gh, 0.055);
  ctx.beginPath();
  // left-to-right wedge
  ctx.moveTo(gx + 12, gy + 8);
  ctx.lineTo(gx + 24, gy + 8);
  ctx.lineTo(gx + gw - 36, gy + gh - 10);
  ctx.lineTo(gx + gw - 52, gy + gh - 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = diag(gx + gw, gy, gx, gy + gh, 0.04);
  ctx.beginPath();
  // right-to-left wedge
  ctx.moveTo(gx + gw - 18, gy + 10);
  ctx.lineTo(gx + gw - 30, gy + 10);
  ctx.lineTo(gx + 46, gy + gh - 12);
  ctx.lineTo(gx + 60, gy + gh - 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ========== 4) Upper billboard strip (static glyphs) ==========
  {
    const bh = 12;
    const bw = gw - 32, bx = gx + 16;
    const by = gy + Math.floor(gh * 0.26);

    // face
    const gg = ctx.createLinearGradient(bx, by, bx + bw, by);
    gg.addColorStop(0.00, "#ff5aa3");
    gg.addColorStop(1.00, "#ffd66b");
    ctx.save();
    ctx.globalAlpha = 0.22;
    roundRect(ctx, bx, by, bw, bh, 2, true);
    ctx.restore();

    // static glyph blocks
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = "#ffffff22";
    const cell = 10, pad = 6, gx0 = bx + pad, gx1 = bx + bw - pad;
    for (let x2 = gx0; x2 <= gx1 - 4; x2 += cell){
      const tall = ((x2 >> 3) & 1) === 0;
      const h2 = tall ? bh - 6 : Math.max(4, bh - 8);
      ctx.fillRect(x2, by + ((bh - h2) >> 1), 4, h2);
    }
    ctx.restore();

    // trims
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#111c30";
    roundRect(ctx, bx, by - 2, bw, 2, 1, true);
    roundRect(ctx, bx, by + bh, bw, 2, 1, true);
    ctx.restore();
  }

  // ========== 5) Vertical lightbox signs (real sign look) ==========
  // helper to draw one sign (bezel + glass + glyphs + glow + brackets)
  const drawSign = (sx, sy, sw, sh, hue) => {
    // Bezel (dark case)
    ctx.save();
    ctx.fillStyle = "#0b1422";
    roundRect(ctx, sx - 2, sy - 2, sw + 4, sh + 4, 3, true);

    // Inner recess shadow
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "#000000";
    roundRect(ctx, sx - 1, sy - 1, sw + 2, sh + 2, 2, true);

    // Glass face
    ctx.globalAlpha = 1;
    const glass = ctx.createLinearGradient(sx, sy, sx, sy + sh);
    const cTop = hue === "cyan" ? "#0e2b48" : "#2a0d2b";   // cool vs magenta
    const cBot = hue === "cyan" ? "#0b2038" : "#200a21";
    glass.addColorStop(0, cTop);
    glass.addColorStop(1, cBot);
    roundRect(ctx, sx, sy, sw, sh, 2, true);

    // Neon halo (lighter, vertical gradient slightly wider than sign)
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createLinearGradient(sx - 6, sy, sx + sw + 6, sy + sh);
    const glow = hue === "cyan" ? "rgba(120,200,255" : "rgba(255,120,200";
    halo.addColorStop(0.00, `${glow},0.00)`);
    halo.addColorStop(0.50, `${glow},0.22)`);
    halo.addColorStop(1.00, `${glow},0.00)`);
    ctx.fillStyle = halo;
    roundRect(ctx, sx - 3, sy + 2, sw + 6, sh - 4, 3, true);

    // Glyph bars (static), inset
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = hue === "cyan" ? "#87d2ff" : "#ff6bc2";
    const segH = 9, gap = 11, padX = 3;
    for (let yy = sy + 6; yy + segH < sy + sh - 6; yy += segH + gap){
      ctx.fillRect(sx + padX, yy, sw - padX*2, segH);
    }

    // Rim highlights
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = hue === "cyan" ? "#9dd8ff" : "#ffc1e9";
    ctx.fillRect(sx, sy, 1, sh);
    ctx.fillRect(sx + sw - 1, sy, 1, sh);

    // Brackets/mounts (tie into wall)
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0e1b2e";
    const brW = 6, brH = 4;
    for (let yy = sy + 6; yy < sy + sh - 6; yy += 22){
      // left mount
      ctx.fillRect(sx - brW, yy, brW, brH);
      // right mount
      ctx.fillRect(sx + sw, yy, brW, brH);
    }

    // Tiny screws on bezel corners
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#17263e";
    const screw = (px, py) => ctx.fillRect(px, py, 2, 2);
    screw(sx - 1,       sy - 1);
    screw(sx + sw - 1,  sy - 1);
    screw(sx - 1,       sy + sh - 1);
    screw(sx + sw - 1,  sy + sh - 1);

    ctx.restore();
  };

  // Left cyan sign (taller)
  {
    const sw = 14;
    const sx = gx + Math.floor(gw * 0.17);
    const sy = gy + 10;
    const sh = gh - 20;
    drawSign(sx, sy, sw, sh, "cyan");
  }

  // Right magenta sign (only if there’s room)
  if (gw >= 140){
    const sw = 10;
    const sx = gx + Math.floor(gw * 0.79);
    const sy = gy + 14;
    const sh = gh - 28;
    drawSign(sx, sy, sw, sh, "magenta");
  }

  // ========== 6) Bottom mechanical louver panel ==========
  {
    const pw = gw - 24, ph = 22, px2 = gx + 12, py2 = botY - 28;
    // recess
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#0a172a";
    roundRect(ctx, px2, py2 - ph, pw, ph, 2, true);
    ctx.restore();
    // face
    const pg = ctx.createLinearGradient(px2, py2 - ph, px2, py2);
    pg.addColorStop(0, "#0d1a2e");
    pg.addColorStop(1, "#0a1626");
    ctx.fillStyle = pg;
    roundRect(ctx, px2, py2 - ph, pw, ph, 2, true);
    // slats
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#0c223c";
    for (let y = py2 - ph + 4; y < py2 - 2; y += 6){
      ctx.fillRect(px2 + 6, Math.floor(y), pw - 12, 2);
    }
    ctx.restore();
  }
}

// Register themes here (order = index)
const THEME_REGISTRY = [
  { name: "RibsSkyscraper",    draw: drawBayRibs_Skyscraper },
  { name: "GlazedTokyo",       draw: drawBayGlazed_TokyoReflective },
  { name: "DiagridSkyscraper", draw: drawBayDiagrid_Skyscraper },
  { name: "GlazedSkyscraper",  draw: drawBayGlazed_Skyscraper },
];

/* -----------------------------------------------------------
   INITIALIZATION
----------------------------------------------------------- */

export function initUnderDeck(state){
  state.deckScrollX = 0;
  state.deckGaps = [];           // [{ x, w, __gid, __theme }]
  state.__gapIdCounter = 1;

  state.__themeSalt  = (Math.random() * 0x7fffffff) | 0;
  state.__themeCount = THEME_REGISTRY.length;

  // stable first span theme
  state.__firstSpanTheme = Math.floor(Math.random() * state.__themeCount) | 0;
  state.__carryLeftTheme = state.__firstSpanTheme;

  // offscreen cache
  const pilasterW = 18, bayW = 148;
  state.__ud = {
    pilasterW,
    bayW,
    period: pilasterW + bayW,
    tileH: 0,
    cache: new Array(state.__themeCount).fill(null),
    ready: false,
    buildRequested: false,
    key: "",
  };
}

/* -----------------------------------------------------------
   MAIN DRAW
----------------------------------------------------------- */

export function drawDeck(ctx, state, canvasOrW, maybeH){
  let W, H;
  if (typeof canvasOrW === "number") { W = canvasOrW; H = maybeH; }
  else { const dpr = (window.devicePixelRatio || 1); W = canvasOrW.width / dpr; H = canvasOrW.height / dpr; }

  const gy    = state.groundY | 0;
  const deckH = state.deckH   | 0;
  const lipH  = state.deckLip | 0;

  const gaps = state.deckGaps || [];
  for (const g of gaps){
    if (g.__gid == null) g.__gid = (state.__gapIdCounter = (state.__gapIdCounter || 1) + 1);
  }

  // 1) Deck strip (punch out at gaps)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, gy, W, deckH + lipH);
  for (const g of gaps){
    const L = Math.round(g.x);
    const R = Math.round(g.x + g.w);
    if (L < W && R > 0){
      ctx.rect(L, gy, Math.max(1, R - L), deckH + lipH);
    }
  }
  ctx.clip("evenodd");

  ctx.fillStyle = PALETTE.lineTop;       ctx.fillRect(0, gy, W, deckH);
  ctx.fillStyle = PALETTE.lineHighlight; ctx.fillRect(0, gy, W, 2);
  ctx.fillStyle = PALETTE.lineLip;       ctx.fillRect(0, gy + deckH, W, lipH);
  ctx.restore();

  // 2) Under-deck wall (punched at gaps)
  const topY = gy + deckH + lipH;
  const botY = Math.max(topY, H);

  ensureUDCache(state, botY - topY); // builds N tiles lazily

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, topY, W, botY - topY);
  for (const g of gaps){
    const L = Math.round(g.x);
    const R = Math.round(g.x + g.w);
    if (L < W && R > 0){
      ctx.rect(L, topY, Math.max(1, R - L), botY - topY);
    }
  }
  ctx.clip("evenodd");

  // base wall tone
  const gWall = ctx.createLinearGradient(0, topY, 0, botY);
  gWall.addColorStop(0.00, "#0c172a");
  gWall.addColorStop(0.55, "#0a1424");
  gWall.addColorStop(1.00, "#091222");
  ctx.fillStyle = gWall;
  ctx.fillRect(0, topY, W, botY - topY);

  // coping under the lip
  ctx.save();
  ctx.globalAlpha = 0.35; ctx.fillStyle = "#13223a"; ctx.fillRect(0, topY, W, 2);
  ctx.globalAlpha = 0.18; ctx.fillStyle = "#000000"; ctx.fillRect(0, topY + 2, W, 2);
  ctx.restore();

  // themed facade, one design per span between gaps
  drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, /*SAFE_MARGIN=*/16);

  ctx.restore();

  // 3) Neon gap rails
  if (gaps.length){
    ctx.save();
    ctx.strokeStyle = PALETTE.obstacleOutline;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1.5;
    for (const g of gaps){
      const L = Math.round(g.x) + 0.5;
      const R = Math.round(g.x + g.w) + 0.5;
      if (R < 0 || L > W) continue;
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L, botY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(R, gy); ctx.lineTo(R, botY); ctx.stroke();
    }
    ctx.restore();
  }
}

/* -----------------------------------------------------------
   CACHE + SPANS
----------------------------------------------------------- */

function ensureUDCache(state, tileH){
  const ud = state.__ud;
  const key = `${tileH}|${ud.period}|${state.__themeCount}`;
  if (ud.key === key && ud.ready) return;
  if (ud.buildRequested && ud.key === key) return;

  ud.key = key;
  ud.tileH = tileH;
  ud.ready = false;
  ud.buildRequested = true;

  const schedule = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  schedule(() => {
    for (let i = 0; i < state.__themeCount; i++){
      ud.cache[i] = buildTileCanvas(ud.period, tileH, i);
    }
    ud.ready = true;
    ud.buildRequested = false;
  });
}

function buildTileCanvas(periodW, tileH, themeIdx){
  const c = document.createElement("canvas");
  c.width = periodW;
  c.height = tileH;
  const g = c.getContext("2d");

  const pilasterW = 18, bayW = 148;
  const topY = 0, botY = tileH;

  // pilaster
  const px = 0;
  const pGrad = g.createLinearGradient(px, topY, px, botY);
  pGrad.addColorStop(0.00, "#0b1526");
  pGrad.addColorStop(1.00, "#0b1422");
  g.fillStyle = pGrad;
  g.fillRect(px, topY, pilasterW, botY - topY);

  // bright edges on pilaster
  g.save();
  g.globalAlpha = 0.18; g.strokeStyle = "#8ab7ff"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(px + 0.5, topY); g.lineTo(px + 0.5, botY); g.stroke();
  g.beginPath(); g.moveTo(px + pilasterW - 0.5, topY); g.lineTo(px + pilasterW - 0.5, botY); g.stroke();
  g.restore();

  // bay
  const bx = px + pilasterW;
  const bw = bayW;

  // bay background
  const bGrad = g.createLinearGradient(bx, topY, bx, botY);
  bGrad.addColorStop(0.00, "#0e1c30");
  bGrad.addColorStop(0.30, "#0e1b2e");
  bGrad.addColorStop(1.00, "#0a1526");
  g.fillStyle = bGrad;
  g.fillRect(bx, topY, bw, botY - topY);

  // inner mullions (shared)
  g.save();
  g.globalAlpha = 0.14; g.strokeStyle = "#10213a"; g.lineWidth = 1;
  const m1 = bx + Math.floor(bw * 0.28) + 0.5;
  const m2 = bx + Math.floor(bw * 0.72) + 0.5;
  g.beginPath(); g.moveTo(m1, topY); g.lineTo(m1, botY); g.stroke();
  g.beginPath(); g.moveTo(m2, topY); g.lineTo(m2, botY); g.stroke();
  g.restore();

  // themed bay face
  const theme = THEME_REGISTRY[Math.max(0, Math.min(themeIdx, THEME_REGISTRY.length - 1))];
  theme.draw(g, bx, bw, topY, botY);

  return c;
}

// integer hash → [0,1)
function rand01(n){
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

// deterministic pick in [0, themeCount)
function pickThemeIndex(state, gapId){
  const salt = state.__themeSalt | 0;
  const r = rand01(Math.imul((gapId ^ salt) | 0, 0x9e3779b1));
  return Math.floor(r * state.__themeCount) | 0;
}

// build world spans between gaps, then clip to screen
function getWorldSpansThenClip(W, gaps, margin){
  const list = (gaps || []).slice().sort((a,b)=>a.x - b.x);
  if (list.length === 0) return [{ x: 0, w: W, leftGap: null, rightGap: null }];

  const spans = [];
  let cursor = -1e9;
  let prevGap = null;

  for (const g of list){
    const Lw = Math.round(g.x) - margin;
    const Rw = Math.round(g.x + g.w) + margin;
    if (Lw > cursor){
      spans.push({ xw: cursor, ww: Lw - cursor, leftGap: prevGap, rightGap: g });
    }
    cursor  = Math.max(cursor, Rw);
    prevGap = g;
  }
  spans.push({ xw: cursor, ww: 1e12, leftGap: prevGap, rightGap: null });

  const visible = [];
  for (const s of spans){
    const vx = Math.max(0, s.xw);
    const vw = Math.min(W, s.xw + s.ww) - vx;
    if (vw > 0) visible.push({ x: vx, w: vw, leftGap: s.leftGap, rightGap: s.rightGap });
  }
  if (visible.length === 0) visible.push({ x: 0, w: W, leftGap: prevGap, rightGap: null });
  return visible;
}

function drawGapReturns(ctx, gaps, topY, botY){
  if (!gaps || !gaps.length) return;
  ctx.save();
  for (const g of gaps){
    const L = Math.round(g.x);
    const R = Math.round(g.x + g.w);

    let grd = ctx.createLinearGradient(L - 8, 0, L, 0);
    grd.addColorStop(0, "rgba(0,0,0,0.0)");
    grd.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grd;
    ctx.fillRect(L - 8, topY, 8, botY - topY);

    grd = ctx.createLinearGradient(R, 0, R + 8, 0);
    grd.addColorStop(0, "rgba(0,0,0,0.35)");
    grd.addColorStop(1, "rgba(0,0,0,0.0)");
    ctx.fillStyle = grd;
    ctx.fillRect(R, topY, 8, botY - topY);
  }
  ctx.restore();
}

function drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, SAFE_MARGIN = 16){
  const gaps = state.deckGaps || [];
  const spans = getWorldSpansThenClip(W, gaps, SAFE_MARGIN);

  let firstUsedTheme = state.__carryLeftTheme;
  let isFirst = true;

  for (const span of spans){
    let themeIdx;
    if (span.leftGap){
      const g = span.leftGap;
      if (g.__theme == null) g.__theme = pickThemeIndex(state, g.__gid);
      themeIdx = g.__theme;
    } else {
      themeIdx = state.__carryLeftTheme;
    }
    if (isFirst){ firstUsedTheme = themeIdx; isFirst = false; }

    ctx.save();
    ctx.beginPath();
    ctx.rect(span.x, topY, span.w, botY - topY);
    ctx.clip();

    if (state.__ud && state.__ud.ready && state.__ud.cache[themeIdx]){
      drawSpanFromCache(ctx, state, topY, span.x, span.w, themeIdx);
    } else {
      // cheap placeholder (static wash)
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = "#89b2ff";
      ctx.fillRect(span.x, topY + 8, span.w, 2);
      ctx.restore();
    }

    ctx.restore();
  }

  state.__carryLeftTheme = firstUsedTheme;
  drawGapReturns(ctx, gaps, topY, botY);
}

function drawSpanFromCache(ctx, state, topY, startX, spanW, themeIdx){
  const ud = state.__ud;
  const tile = ud.cache[themeIdx];
  const period = ud.period;

  const phase = state.deckScrollX || 0;
  const offset = ((phase + startX) % period + period) % period;

  let x = startX - offset - period;
  for (; x < startX + spanW + period; x += period){
    ctx.drawImage(tile, x, topY);
  }
}