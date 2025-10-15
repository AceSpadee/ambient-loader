// drawDeck.js
import { PALETTE } from "./palette.js";
import { roundRect } from "./utils.js";

/** Call once in resetRun() */
export function initUnderDeck(state){
  state.deckScrollX = 0;
  state.deckGaps = [];           // [{ x, w, __gid, __theme }]
  state.__gapIdCounter = 1;

  // 2-theme setup (0 = ribs, 1 = glazed)
  state.__firstSpanTheme = (Math.random() < 0.5 ? 0 : 1);
  state.__carryLeftTheme = state.__firstSpanTheme;

  // NEW: per-run salt so the random pick is stable per run, varied between runs
  state.__themeSalt = (Math.random() * 0x7fffffff) | 0;

  // NEW: offscreen cache for under-deck facade tiles
  state.__ud = {
    pilasterW: 18,
    bayW: 148,
    period: 18 + 148,     // one repeatable tile width
    tileH: 0,             // current tile height (botY - topY)
    cache: { 0: null, 1: null }, // canvases per theme
    ready: false,
    buildRequested: false,
    key: "",              // size key
  };
}

/**
 * Render the deck strip + under-deck facade.
 * Accepts (ctx, state, canvas) or (ctx, state, width, height).
 */
export function drawDeck(ctx, state, canvasOrW, maybeH){
  let W, H;
  if (typeof canvasOrW === "number") { W = canvasOrW; H = maybeH; }
  else { const dpr = (window.devicePixelRatio || 1); W = canvasOrW.width / dpr; H = canvasOrW.height / dpr; }

  const gy    = state.groundY | 0;
  const deckH = state.deckH   | 0;
  const lipH  = state.deckLip | 0;

  const gaps = state.deckGaps || [];

  // ensure every gap has a stable id for deterministic theme seeding
  for (const g of gaps){
    if (g.__gid == null){
      g.__gid = (state.__gapIdCounter = (state.__gapIdCounter || 1) + 1);
    }
  }

  // ---------- 1) Deck strip with punched holes at gaps ----------
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

  // ---------- 2) Under-deck wall with holes at gaps -------------
  const topY = gy + deckH + lipH;
  const botY = Math.max(topY, H);

  // Make sure our offscreen tiles exist / match the current height
  ensureUDCache(state, botY - topY);

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

  // base wall tone (distinct from background buildings)
  const gWall = ctx.createLinearGradient(0, topY, 0, botY);
  gWall.addColorStop(0.00, "#0c172a");
  gWall.addColorStop(0.55, "#0a1424");
  gWall.addColorStop(1.00, "#091222");
  ctx.fillStyle = gWall;
  ctx.fillRect(0, topY, W, botY - topY);

  // small coping under the lip
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#13223a";
  ctx.fillRect(0, topY, W, 2);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, topY + 2, W, 2);
  ctx.restore();

  // facade details — 2 themes, stable per span (and now drawn from offscreen tiles)
  drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, /*SAFE_MARGIN=*/16);

  ctx.restore(); // end wall clip

  // ---------- 3) Neon gap edges (extend up to deck top) ----
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

/* ---------------- caching & helpers ---------------- */

// Build (or rebuild) the offscreen tile canvases lazily.
// Each tile is one period wide, full wall height, for theme 0 and 1.
function ensureUDCache(state, tileH){
  const ud = state.__ud;
  const key = `${tileH}|${ud.period}`;
  if (ud.key === key && ud.ready) return;

  // If a build is already queued for this size, do nothing
  if (ud.buildRequested && ud.key === key) return;

  ud.key = key;
  ud.tileH = tileH;
  ud.ready = false;
  ud.buildRequested = true;

  const schedule = window.requestIdleCallback || ((fn)=>setTimeout(fn, 0));
  schedule(() => {
    ud.cache[0] = buildTileCanvas(ud.period, tileH, 0); // ribs
    ud.cache[1] = buildTileCanvas(ud.period, tileH, 1); // glazed
    ud.ready = true;
    ud.buildRequested = false;
  });
}

// Create one offscreen canvas for a theme (one period wide, full height)
function buildTileCanvas(periodW, tileH, themeIdx){
  const c = document.createElement("canvas");
  c.width = periodW;
  c.height = tileH;
  const g = c.getContext("2d");

  // Draw exactly one tile starting at x=0 (pilaster + bay)
  const pilasterW = 18, bayW = 148;
  const topY = 0, botY = tileH;

  // Pilaster
  const px = 0;
  const pGrad = g.createLinearGradient(px, topY, px, botY);
  pGrad.addColorStop(0.00, "#0b1526");
  pGrad.addColorStop(1.00, "#0b1422");
  g.fillStyle = pGrad;
  g.fillRect(px, topY, pilasterW, botY - topY);

  // bright edges on pilaster
  g.save();
  g.globalAlpha = 0.18;
  g.strokeStyle = "#8ab7ff";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(px + 0.5, topY); g.lineTo(px + 0.5, botY); g.stroke();
  g.beginPath(); g.moveTo(px + pilasterW - 0.5, topY); g.lineTo(px + pilasterW - 0.5, botY); g.stroke();
  g.restore();

  // Bay
  const bx = px + pilasterW;
  const bw = bayW;

  const bGrad = g.createLinearGradient(bx, topY, bx, botY);
  bGrad.addColorStop(0.00, "#0e1c30");
  bGrad.addColorStop(0.30, "#0e1b2e");
  bGrad.addColorStop(1.00, "#0a1526");
  g.fillStyle = bGrad;
  g.fillRect(bx, topY, bw, botY - topY);

  // inner mullions (shared)
  g.save();
  g.globalAlpha = 0.14;
  g.strokeStyle = "#10213a";
  g.lineWidth = 1;
  const m1 = bx + Math.floor(bw * 0.28) + 0.5;
  const m2 = bx + Math.floor(bw * 0.72) + 0.5;
  g.beginPath(); g.moveTo(m1, topY); g.lineTo(m1, botY); g.stroke();
  g.beginPath(); g.moveTo(m2, topY); g.lineTo(m2, botY); g.stroke();
  g.restore();

  if (themeIdx === 0){
    drawBayRibs(g, bx, bw, topY, botY);
  } else {
    drawBayGlazed(g, bx, bw, topY, botY);
  }

  // Small utility box (optional – keep very cheap)
  if (themeIdx === 0) {
    const ux = bx + 20, uy = topY + 24;
    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = "#13243c";
    roundRect(g, ux, uy, 18, 12, 2, true);
    g.globalAlpha = 0.45;
    g.fillStyle = "#0c1830";
    g.fillRect(ux + 7, uy + 12, 2, 26);
    g.restore();
  }

  return c;
}

// Fast integer hash → [0,1)
function rand01(n){
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967295;
}

// Deterministic 50/50 pick for 2 themes, independent of previous theme
function pickTheme2(state, gapId){
  const salt = state.__themeSalt | 0;
  const r = rand01(Math.imul((gapId ^ salt) | 0, 0x9e3779b1));
  return r < 0.5 ? 0 : 1; // 0=ribs, 1=glazed
}

/**
 * Build world-space spans separated by gaps (with a margin), then intersect with the screen.
 * We keep the correct left gap even when it’s off-screen, so the theme doesn’t flip as gaps slide.
 */
function getWorldSpansThenClip(W, gaps, margin){
  const list = (gaps || []).slice().sort((a,b) => a.x - b.x);

  // No gaps anywhere → draw one continuous building across the screen.
  if (list.length === 0) {
    return [{ x: 0, w: W, leftGap: null, rightGap: null }];
  }

  const spans = [];
  let cursor  = -1e9;     // far-left sentinel
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

  // Trailing span to +∞ (use a huge width so it won't clip to 0)
  spans.push({ xw: cursor, ww: 1e12, leftGap: prevGap, rightGap: null });

  // Intersect with the screen
  const visible = [];
  for (const s of spans){
    const vx = Math.max(0, s.xw);
    const vw = Math.min(W, s.xw + s.ww) - vx;
    if (vw > 0) visible.push({ x: vx, w: vw, leftGap: s.leftGap, rightGap: s.rightGap });
  }

  // Safety: if numerical quirks produced nothing, fill the screen.
  if (visible.length === 0) {
    visible.push({ x: 0, w: W, leftGap: prevGap, rightGap: null });
  }

  return visible;
}

// Dark "returns" just inside the wall at gap edges to sell depth
function drawGapReturns(ctx, gaps, topY, botY){
  if (!gaps || !gaps.length) return;
  ctx.save();
  for (const g of gaps){
    const L = Math.round(g.x);
    const R = Math.round(g.x + g.w);

    // left return
    let grd = ctx.createLinearGradient(L - 8, 0, L, 0);
    grd.addColorStop(0, "rgba(0,0,0,0.0)");
    grd.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grd;
    ctx.fillRect(L - 8, topY, 8, botY - topY);

    // right return
    grd = ctx.createLinearGradient(R, 0, R + 8, 0);
    grd.addColorStop(0, "rgba(0,0,0,0.35)");
    grd.addColorStop(1, "rgba(0,0,0,0.0)");
    ctx.fillStyle = grd;
    ctx.fillRect(R, topY, 8, botY - topY);
  }
  ctx.restore();
}

/* ---------- THEMED, PER-SPAN FACADE RENDERER (uses cache) ---------- */

function drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, SAFE_MARGIN = 16){
  const gaps = state.deckGaps || [];
  const spans = getWorldSpansThenClip(W, gaps, SAFE_MARGIN);

  // carry from prior frame for the very first span (before any left gap)
  let firstUsedTheme = state.__carryLeftTheme;

  let isFirst = true;
  for (const span of spans){
    let theme;
    if (span.leftGap){
      const g = span.leftGap;
      if (g.__theme == null){
        g.__theme = pickTheme2(state, g.__gid); // random per building (stable)
      }
      theme = g.__theme;
    } else {
      theme = state.__carryLeftTheme; // beginning-of-run stretch
    }

    if (isFirst){
      firstUsedTheme = theme; // record the starting span’s theme for next frame
      isFirst = false;
    }

    // Clip to the span so details never cross gap rails
    ctx.save();
    ctx.beginPath();
    ctx.rect(span.x, topY, span.w, botY - topY);
    ctx.clip();

    // Draw from offscreen cache if ready; otherwise do a cheap placeholder
    if (state.__ud && state.__ud.ready && state.__ud.cache[theme]){
      drawSpanFromCache(ctx, state, topY, span.x, span.w, theme);
    } else {
      // placeholder: nothing (the base wall gradient already drew)
      // You could add a faint wash here if you want something visible.
    }

    ctx.restore();
  }

  // Persist the first visible span’s theme → prevents left-edge flicker
  state.__carryLeftTheme = firstUsedTheme;

  // add dark returns
  drawGapReturns(ctx, gaps, topY, botY);
}

// Repeating drawImage using the pre-rendered tile
function drawSpanFromCache(ctx, state, topY, startX, spanW, theme){
  const ud = state.__ud;
  const tile = ud.cache[theme];
  const period = ud.period;

  const phase = state.deckScrollX || 0;
  const offset = ((phase + startX) % period + period) % period;

  let x = startX - offset - period;
  for (; x < startX + spanW + period; x += period){
    ctx.drawImage(tile, x, topY);
  }
}

/* ----- Two bay variants (used for offscreen tiles) ----- */

// RIBBED: vertical ribs inside the bay
function drawBayRibs(ctx, x, w, topY, botY){
  const pad = 8;
  const rx = x + pad, rw = w - pad*2;
  const ry = topY + 14, rh = (botY - topY) - 46;

  const g = ctx.createLinearGradient(rx, ry, rx, ry + rh);
  g.addColorStop(0.00, "#0e1c2f");
  g.addColorStop(1.00, "#0b1627");
  ctx.fillStyle = g;
  roundRect(ctx, rx, ry, rw, rh, 2, true);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#0f2036";
  ctx.lineWidth = 1;
  for (let x2 = rx + 10; x2 < rx + rw - 8; x2 += 16){
    ctx.beginPath(); ctx.moveTo(x2 + 0.5, ry + 2); ctx.lineTo(x2 + 0.5, ry + rh - 2); ctx.stroke();
  }
  ctx.restore();
}

// GLAZED: single big pane with soft gradient + faint top highlight
function drawBayGlazed(ctx, x, w, topY, botY){
  const pad = 10;
  const gx = x + pad, gw = w - pad*2;
  const gy = topY + 18, gh = (botY - topY) - 56;

  const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
  g.addColorStop(0.00, "rgba(24,36,56,0.85)");
  g.addColorStop(1.00, "rgba(16,26,44,0.92)");
  ctx.fillStyle = g;
  roundRect(ctx, gx, gy, gw, gh, 2, true);

  // subtle top highlight
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#89b2ff";
  ctx.fillRect(gx, gy + 6, gw, 1);
  ctx.restore();
}
