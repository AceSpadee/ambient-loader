// roofBlocks.js
// (kept lightweight; this module only owns the data + splitting logic)
// If you’re not drawing these anywhere, either hook them up in your renderer
// or remove this file to reduce complexity.

import { shade } from "./utils.js";

// ---- themes ---------------------------------------------------------------
function randomTheme(){
  const bases = ["#121a2c","#0f1628","#10182b","#141c30","#0e1526","#121a2b","#0d1323"];
  const base = bases[Math.floor(Math.random()*bases.length)];
  return { base, variants:[base, shade(base,-8), shade(base,-14)] };
}
function pickVariant(theme){
  const vs = theme.variants || [theme.base];
  return vs[Math.floor(Math.random()*vs.length)];
}

// ---- init -----------------------------------------------------------------
export function initRoofBlocks(state, canvas){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;

  state.roofBlocks = [];
  state.roofTheme  = randomTheme();
  state.roofSeams  = []; // moving seam markers dropped by skylights

  // prefill across screen
  let x = -40;
  while (x < w + 260){
    const bw = 90 + Math.random()*160;
    state.roofBlocks.push({ x, w: bw, col: pickVariant(state.roofTheme), panels: true });
    x += bw;
  }
}

// ---- update (move, split at seams, then fill right) -----------------------
export function updateRoofBlocks(state, dt, canvas){
  const blocks = state.roofBlocks || (state.roofBlocks = []);
  const seams  = state.roofSeams  || (state.roofSeams  = []);
  const speed  = state.speed || 300;

  // move world
  for (const b of blocks) b.x -= speed * dt;
  for (const s of seams)  s.x -= speed * dt;

  // --- split any block a seam falls inside
  const seamW  = 4;  // visual “gap” width
  const minSeg = 8;  // don't create slivers

  for (let i = seams.length - 1; i >= 0; i--){
    const sx = seams[i].x;

    // find containing block
    let bi = -1;
    for (let j = 0; j < blocks.length; j++){
      const b = blocks[j];
      if (sx > b.x && sx < b.x + b.w){ bi = j; break; }
    }
    if (bi === -1) continue;

    const b = blocks[bi];
    const leftW  = Math.max(0, sx - b.x);
    const rightW = Math.max(0, (b.x + b.w) - sx);

    // If either side would be a tiny sliver, skip this seam gracefully.
    if (leftW < minSeg || rightW < minSeg) {
      seams.splice(i, 1);
      continue;
    }

    // Clamp seam strip to the available right side
    const seamWidth = Math.min(seamW, rightW);

    // new pieces replacing block b
    const pieces = [];

    // left piece (same theme)
    pieces.push({ x: b.x, w: leftW, col: b.col, panels: b.panels });

    // seam strip (dark, no panels)
    const seamX = b.x + leftW;
    pieces.push({ x: seamX, w: seamWidth, col: "#0a0f1a", panels: false });

    // right piece (switch to a new theme color)
    const remain = rightW - seamWidth;
    if (remain >= minSeg){
      state.roofTheme = randomTheme(); // switch building style
      pieces.push({ x: seamX + seamWidth, w: remain, col: pickVariant(state.roofTheme), panels: true });
    }

    // replace original with pieces
    blocks.splice(bi, 1, ...pieces);

    // consume this seam
    seams.splice(i, 1);
  }

  // cull left
  while (blocks.length && blocks[0].x + blocks[0].w < -80) blocks.shift();
  for (let i = seams.length - 1; i >= 0; i--) if (seams[i].x < -120) seams.splice(i,1);

  // fill right
  const dpr = (window.devicePixelRatio || 1);
  const canvasW = canvas.width / dpr;
  let rightX = blocks.length ? (blocks[blocks.length-1].x + blocks[blocks.length-1].w) : -40;

  while (rightX < canvasW + 260){
    const bw = 90 + Math.random()*160;
    blocks.push({ x: rightX, w: bw, col: pickVariant(state.roofTheme), panels: true });
    rightX += bw;
  }
}
