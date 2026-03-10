# obstacles.py — complete port with spawner + draw routines (chimney fixed)
import math
import random
import pygame

from utils import pickWeighted, shade, roundRect, get_linear_gradient, _parse_color
from palette import PALETTE

# ---- tiny LRU for gradients (safe reuse) -----------------------------------
from functools import lru_cache as _lru

# keep the original around
_get_linear_gradient_uncached = get_linear_gradient

@_lru(maxsize=512)
def _get_linear_gradient_cached(w, h, c1, c2, horizontal=False):
    # normalize inputs to maximize cache hits
    return _get_linear_gradient_uncached(int(w), int(h), c1, c2, horizontal=bool(horizontal))

# override local name so all calls below automatically use the cache
get_linear_gradient = _get_linear_gradient_cached

# ---- rounded-rect mask cache (display-formatted) --------------------------
_ROUNDED_MASK_CACHE = {}
def _rounded_rect_mask_cached(w, h, r):
    w = int(max(1, w)); h = int(max(1, h)); r = int(max(0, r))
    key = (w, h, r)
    surf = _ROUNDED_MASK_CACHE.get(key)
    if surf is None:
        s = pygame.Surface((w, h), pygame.SRCALPHA)
        # fast rounded rect for masks
        pygame.draw.rect(s, (255,255,255,255), pygame.Rect(0,0,w,h), border_radius=r)
        surf = s.convert_alpha()
        _ROUNDED_MASK_CACHE[key] = surf
    return surf

# Keep public name stable for existing callers
def rounded_rect_mask(w, h, r):
    return _rounded_rect_mask_cached(w, h, r)

# ---- one-shot prewarmer callable from RooftopCat --------------------------
_PREWARMED = False
def prewarm_obstacle_caches(_screen=None):
    """Prebuild common rounded masks so first instances don't hitch."""
    global _PREWARMED
    if _PREWARMED:
        return
    _PREWARMED = True
    # Touch pixel format once
    _ = pygame.Surface((1,1), pygame.SRCALPHA).convert_alpha()
    # Common sizes/radii used across obstacles; tweak if you like
    widths  = (24, 32, 40, 48, 56, 64, 72, 84, 96, 112, 128, 160, 192)
    heights = (14, 18, 22, 28, 32, 40, 48, 56, 64, 72, 84, 96)
    radii   = (2, 3, 4, 6, 8, 10, 12)
    for w in widths:
        for h in heights:
            for r in radii:
                _rounded_rect_mask_cached(w, h, r)

# ------------------------ color helpers ------------------------
def _col(c):
    if isinstance(c, str):
        s = c.strip()
        if s.startswith("#") and len(s) == 7:
            r = int(s[1:3], 16); g = int(s[3:5], 16); b = int(s[5:7], 16)
            return (r, g, b)
        r, g, b, _ = _parse_color(s)
        return (r, g, b)
    if isinstance(c, (tuple, list)):
        return (int(c[0]), int(c[1]), int(c[2]))
    return (255, 255, 255)

def _colA(color, a):
    r,g,b,_ = _parse_color(color)
    return (r, g, b, int(max(0.0, min(1.0, float(a))) * 255))

def _lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, float(t)))
    return (int(c1[0] + (c2[0]-c1[0])*t),
            int(c1[1] + (c2[1]-c1[1])*t),
            int(c1[2] + (c2[2]-c1[2])*t))

def _poly(surface, color, pts, a=255):
    if not pts: return
    pygame.draw.polygon(surface, _col(color) + (int(a),), [(int(x), int(y)) for x,y in pts])

# ------------------------ lightweight neon helpers ------------------------

def _neon_line(surface, color, pts, core_w=2, glow_w=6, glow_alpha=0.55):
    """Draws a polyline with a soft glow by painting glow in a tight bbox."""
    if len(pts) < 2: return
    col = _col(color)
    pad = int(glow_w) + 2
    minx = min(p[0] for p in pts) - pad
    maxx = max(p[0] for p in pts) + pad
    miny = min(p[1] for p in pts) - pad
    maxy = max(p[1] for p in pts) + pad
    w = int(maxx - minx + 1); h = int(maxy - miny + 1)
    if w <= 0 or h <= 0: return
    glow = pygame.Surface((w, h), pygame.SRCALPHA)
    shifted = [(p[0]-minx, p[1]-miny) for p in pts]
    pygame.draw.lines(glow, col + (int(255*glow_alpha),), False, shifted, max(1, int(glow_w)))
    surface.blit(glow, (minx, miny))
    pygame.draw.lines(surface, col, False, pts, max(1, int(core_w)))

def _neon_rounded_rect(surface, color, x, y, w, h, r, core_w=2, glow_w=6, glow_alpha=0.55):
    col = _col(color)
    pad = int(glow_w) + 2
    gx, gy = int(x - pad), int(y - pad)
    gw, gh = int(w + pad*2), int(h + pad*2)
    if gw <= 0 or gh <= 0: return
    glow = pygame.Surface((gw, gh), pygame.SRCALPHA)
    roundRect(glow, pad, pad, w, h, r, False, outline=col + (int(255*glow_alpha),), width=max(1, int(glow_w)))
    surface.blit(glow, (gx, gy))
    roundRect(surface, x, y, w, h, r, False, outline=col, width=max(1, int(core_w)))

def _circle(surface, color, cx, cy, r, a=255):
    s = pygame.Surface((int(r*2+4), int(r*2+4)), pygame.SRCALPHA)
    pygame.draw.circle(s, _col(color) + (a,), (int(r+2), int(r+2)), int(r))
    surface.blit(s, (int(cx-r-2), int(cy-r-2)))

def _line(surface, color, x1, y1, x2, y2, w=1, a=255):
    pygame.draw.line(surface, _col(color) + (a,), (x1, y1), (x2, y2), int(w))

def _line_round(s, color, x1, y1, x2, y2, w=1, a=255):
    """Line with rounded caps (simulate canvas lineCap='round')."""
    col = _col(color) + (int(a),)
    pygame.draw.line(s, col, (int(x1), int(y1)), (int(x2), int(y2)), int(w))
    if w > 1:
        r = max(1, int(round(w * 0.5)))
        pygame.draw.circle(s, col, (int(x1), int(y1)), r)
        pygame.draw.circle(s, col, (int(x2), int(y2)), r)

def _stroke_polyline_grad_round(s, pts, width, x0, wtot, cL, cM, cR, segments=10):
    """
    Stroke a polyline with a horizontal 'steel' gradient across [x0, x0+wtot],
    using rounded caps at segment boundaries.
    """
    if len(pts) < 2: return
    def lerp(a,b,t): return a + (b-a)*t
    def lerpC(a,b,t): return (int(lerp(a[0],b[0],t)), int(lerp(a[1],b[1],t)), int(lerp(a[2],b[2],t)))
    def metal_color(xx):
        if wtot <= 1: return cM
        t = (xx - x0) / wtot
        if t <= 0.5:  return lerpC(cL, cM, t/0.5)
        else:         return lerpC(cM, cR, (t-0.5)/0.5)

    for i in range(len(pts)-1):
        x1,y1 = pts[i]; x2,y2 = pts[i+1]
        for k in range(segments):
            t0 = k/segments; t1 = (k+1)/segments
            xa,ya = lerp(x1,x2,t0), lerp(y1,y2,t0)
            xb,yb = lerp(x1,x2,t1), lerp(y1,y2,t1)
            xm = 0.5*(xa+xb)
            _line_round(s, metal_color(xm), xa, ya, xb, yb, width, a=255)
# ------------------------ spawn logic ------------------------

SKYLIGHT_GAP_PAD = 8

def jumpableGapRange(state):
    v = max(280, min(1200, state["speed"]))
    minw = 80 + 0.06 * v
    maxw = 130 + 0.15 * v
    return {"min": minw, "max": maxw}

def pickGapWidth(state):
    r = jumpableGapRange(state)
    bias = 0.35
    t = math.pow(random.random(), bias)
    return r["min"] + t * (r["max"] - r["min"])

def lastSkylightRight(state):
    gaps = state.get("deckGaps") or []
    if gaps:
        last = gaps[-1]
        return last["x"] + last["w"] + SKYLIGHT_GAP_PAD * 2
    return float("-inf")

def spawnObstacle(state, canvas):
    """Adds one obstacle (or a skylight gap) to state['obstacles'].
       Returns a time (seconds) until next spawn, or None for default cadence."""
    if not state:
        return 1.2

    w = state.get("playerCtx", {}).get("canvasW") or state.get("screen_w") or 1280
    gy = state["groundY"]
    spawnX = w + 40
    speed = max(120, state["speed"])
    MARGIN = 160

    # Wires don't overlap obstacles; compute a local block window.
    blockRight = float("-inf")
    for o in state["obstacles"]:
        if o.get("type") != "wire": continue
        left = o["x"]; right = o["x"] + o["w"]
        if spawnX >= left - MARGIN and spawnX <= right + MARGIN:
            blockRight = max(blockRight, right)
    if blockRight > float("-inf"):
        remaining = (blockRight + MARGIN) - spawnX
        if remaining > 0:
            return max(0.08, remaining / speed)

    # speed raises frequency slightly by adding longer spans to non-wire choices
    speedFactor = (state["speed"] - state["baseSpeed"]) / (state["speedMax"] - state["baseSpeed"] + 1e-6)
    extraSpan = max(0, speedFactor) * 160

    pick = pickWeighted([
        ("chimney",           22),
        ("antenna",           16),
        ("hvac",              14),
        ("skylight",          40),
        ("vent_pipe",         10),
        ("access_shed",        9),
        ("water_tank",         6),
        ("billboard",          4),
        ("water_tower_gate",   8),
        ("wire",              17),
    ])

    if pick == "wire":
        blockRight = float("-inf")
        for o in state["obstacles"]:
            if o.get("type") == "wire": continue
            left = o["x"]; right = o["x"] + o["w"]
            if spawnX >= left - MARGIN and spawnX <= right + MARGIN:
                blockRight = max(blockRight, right)
        if blockRight > float("-inf"):
            remaining = (blockRight + MARGIN) - spawnX
            if remaining > 0:
                return max(0.08, remaining / speed)

    if pick == "chimney":
        bw = 26 + random.random() * 20
        bh = 44 + random.random() * 34
        state["obstacles"].append({"type":"chimney","x":spawnX,"y":gy-bh,"w":bw,"h":bh})

    elif pick == "antenna":
        sr = max(0.0, min(1.0, (state["speed"] - state["baseSpeed"]) / (state["speedMax"] - state["baseSpeed"] + 1e-6)))
        wantPylon = random.random() < (0.45 + 0.25 * sr)
        if not wantPylon:
            bw = 12 + random.random() * 10; bh = 64 + random.random() * 52
            state["obstacles"].append({"type":"antenna","variant":"mast","x":spawnX,"y":gy-bh,"w":bw,"h":bh})
        else:
            SCALE = 1.5
            bw = (56 + random.random()*32) * SCALE
            bh = (110 + random.random()*46) * SCALE
            duckH = state.get("playerCtx",{}).get("duckH", 24)
            clearance = max(duckH + 10, 34)
            def pyl_colliders(o=None):
                o = pyl if o is None else o
                yClear = o["baseY"] - o["clearance"]
                cx = o["x"] + o["w"]/2
                coreW = max(12, o["w"] * 0.30)
                spine = {"x": cx - coreW/2, "y": o["y"], "w": coreW, "h": max(1, yClear - o["y"])}
                armY  = o["y"] + max(12, o["h"] * 0.26)
                arm   = {"x": cx - max(16, o["w"]*0.40)/2, "y": armY - 4, "w": max(16, o["w"]*0.40), "h": 8}
                return [spine, arm]
            pyl = {"type":"antenna","variant":"pylon","x":spawnX,"y":gy-bh,"w":bw,"h":bh,"baseY":gy,"clearance":clearance,"colliders":pyl_colliders}
            state["obstacles"].append(pyl)

    elif pick == "hvac":
        bw = 44 + random.random() * 36; bh = 22 + random.random() * 12
        state["obstacles"].append({"type":"hvac","x":spawnX,"y":gy-bh,"w":bw,"h":bh})

    elif pick == "skylight":
        needRunway = 160 + (state["speed"] - state["baseSpeed"]) * 0.18
        lastR = lastSkylightRight(state)
        if lastR > float("-inf"):
            runway = spawnX - lastR
            if runway < needRunway:
                remain = needRunway - runway
                return max(0.06, remain / speed)
        gapW = round(pickGapWidth(state))
        gapLeft = spawnX + 8
        state.setdefault("deckGaps", []).append({"x":gapLeft, "w":gapW})

    elif pick == "vent_pipe":
        bh = 44
        tier = pickWeighted([("medium",5),("long",4),("xlong",2)])
        MED_MIN,MED_MAX = 84,108
        LONG_MIN,LONG_MAX = 112,148
        XL_MIN,XL_MAX = 156,220
        if tier == "medium":   bw = MED_MIN + random.random()*(MED_MAX-MED_MIN)
        elif tier == "long":   bw = LONG_MIN + random.random()*(LONG_MAX-LONG_MIN)
        else:                  bw = XL_MIN  + random.random()*(XL_MAX-XL_MIN)
        minWidthForConstantR = math.ceil(bh * (0.30/0.18)) + 4
        bw = max(bw, minWidthForConstantR, MED_MIN)
        runFrac = {"medium":(0.80 + random.random()*0.10),"long":(0.88 + random.random()*0.07),"xlong":(0.90 + random.random()*0.05)}[tier]
        state["obstacles"].append({"type":"vent_pipe","x":spawnX,"y":gy-bh,"w":bw,"h":bh,"runFrac":runFrac,"brackets":True})

    elif pick == "access_shed":
        bw = 36 + random.random() * 24; bh = 34 + random.random() * 20
        state["obstacles"].append({"type":"access_shed","x":spawnX,"y":gy-bh,"w":bw,"h":bh,"roofDir":(-1 if random.random()<0.5 else 1)})

    elif pick == "water_tank":
        bw = 96 + random.random() * 54; bh = 46 + random.random() * 14
        variant = "drum" if random.random() >= 0.5 else "poly_round"
        ww, hh = bw, bh
        if variant == "poly_round":
            polyExtraH = 6
            hh = round(bh + polyExtraH)
            desiredW = round((hh - 2) * 2.0 + 12)
            ww = max(bw, desiredW)
        state["obstacles"].append({"type":"water_tank","x":spawnX,"y":gy-hh,"w":ww,"h":hh,"variant":variant})

    elif pick == "billboard":
        bw = 110 + random.random() * 70; bh = 56 + random.random() * 28
        variant = pickWeighted([("classic",3),("slats",4),("led",3),("wood",3)])
        state["obstacles"].append({"type":"billboard","x":spawnX,"y":gy-bh,"w":bw,"h":bh,"variant":variant})

    elif pick == "water_tower_gate":
        bw = 84 + random.random() * 36
        clearance = 26 + math.floor(random.random() * 4)
        beamH = 12
        stem = 28 + random.random() * 22
        tankH = 56 + random.random() * 20
        y = gy - (clearance + beamH)

        def _wtg_colliders(o):
            inset = max(10, o["w"]*0.18)
            legW = max(4, min(7, o["w"]*0.08))
            innerL = o["x"] + inset + legW + 2
            innerR = o["x"] + o["w"] - inset - legW - 2
            barW = max(20, innerR - innerL)
            duckBar = {"x": innerL, "y": o["y"], "w": barW, "h": o["h"]}

            legH = o["clearance"] + o["h"] + o["stem"]
            platformY = o["baseY"] - legH
            tankPad = 6
            tankTopY = platformY - tankPad - o["tankH"]
            capExtra = 12
            towerTopY = tankTopY - capExtra
            towerH = o["y"] - towerTopY
            tower = {"x": o["x"], "y": towerTopY, "w": o["w"], "h": max(0, towerH)}
            return [duckBar, tower]

        obj = {
            "type": "water_tower_gate",
            "x": spawnX, "y": y, "w": bw, "h": beamH,
            "clearance": clearance, "stem": stem, "tankH": tankH, "baseY": gy,
        }
        obj["colliders"] = (lambda o=obj: _wtg_colliders(o))
        state["obstacles"].append(obj)

    else:
        # wire
        span  = 140 + random.random() * 140 + extraSpan
        y     = gy - (48 + random.random() * 26)
        sag   = 10 + random.random() * 20
        poleH = 28 + random.random() * 16

        def _wire_colliders(o):
            x1 = o["x"]; x2 = o["x"] + o["w"]; y0 = o["y"]
            sagV = o.get("sag", 14); poleH0 = o.get("poleH", 30)
            cx = (x1 + x2) / 2; cy = y0 + sagV
            rects = []
            # poles
            rects.append({"x": x1 - 3, "y": y0 - poleH0, "w": 6, "h": poleH0})
            rects.append({"x": x2 - 3, "y": y0 - poleH0, "w": 6, "h": poleH0})
            # coarse cable sweep
            N = 8; halfT = 8/2
            def evalQ(t):
                mt = 1 - t
                return (
                    mt*mt*x1 + 2*mt*t*cx + t*t*x2,
                    mt*mt*y0 + 2*mt*t*cy + t*t*y0
                )
            for i in range(N):
                t0 = i / N; t1 = (i + 1) / N
                xA, yA = evalQ(t0); xB, yB = evalQ(t1)
                rects.append({
                    "x": min(xA, xB),
                    "y": min(yA, yB) - halfT,
                    "w": max(1, abs(xB - xA)),
                    "h": max(1, abs(yB - yA) + 2*halfT)
                })
            return rects

        ob = {
            "type": "wire",
            "x": spawnX, "y": y, "w": span, "h": 4,
            "sag": sag, "poleH": poleH, "baseY": gy,
            "poleVariant": None,
        }
        ob["colliders"] = (lambda o=ob: _wire_colliders(o))
        state["obstacles"].append(ob)

    return None

# ------------------------ draw dispatcher ------------------------

def drawObstacles(ctx, state, t=0.0):
    """Draw all obstacles with simple culling + gentle pruning."""
    obstacles = state.get("obstacles", [])
    if not obstacles:
        return

    # View window — use the ACTUAL surface width we’re drawing to
    W = ctx.get_width()
    VIS_PAD  = 48   # small draw padding
    PRUNE_L  = 320  # prune if completely this far off the left

    kept = []
    show_debug = bool(state.get("_debug_obstacles"))  # optional outlines

    for o in obstacles:
        ox = float(o.get("x", 0.0)); ow = float(o.get("w", 0.0))
        if not math.isfinite(ox) or not math.isfinite(ow):
            continue

        # prune very-far-left to keep the list small
        if (ox + ow) < -PRUNE_L:
            continue

        # quick cull if completely outside the padded view
        if (ox > W + VIS_PAD) or (ox + ow < -VIS_PAD):
            kept.append(o)
            continue

        # draw visible types
        typ = o.get("type")
        if   typ == "chimney":            _drawChimney(ctx, o)
        elif typ == "antenna":            _drawAntenna(ctx, o, t)
        elif typ == "hvac":               _drawHVAC(ctx, o)
        elif typ == "vent_pipe":          _drawVentPipe(ctx, o)
        elif typ == "access_shed":        _drawAccessShed(ctx, o)
        elif typ == "water_tank":         _drawWaterTank(ctx, o)
        elif typ == "billboard":          _drawBillboard(ctx, o, t)
        elif typ == "water_tower_gate":   _drawWaterTowerGate(ctx, o, PALETTE)
        elif typ == "wire":               _drawWire(ctx, o)

        # optional debug outline (toggle with state["_debug_obstacles"] = True)
        if show_debug:
            try:
                pygame.draw.rect(ctx, (0, 255, 255), pygame.Rect(int(o["x"]), int(o["y"]), int(o["w"]), int(o["h"])), 1)
            except Exception:
                pass

        kept.append(o)

    # gentle pruning result (keeps collisions current, list smaller)
    state["obstacles"] = kept
    if len(kept) > 240:
        del kept[:len(kept)-240]
    
# ------------------------ per-type renders ------------------------

def _drawChimney(s, o):
    """
    1:1-style chimney:
      - tapered body with horizontal multi-stop gradient
      - brick courses (staggered vertical joints)
      - tiny tint jitter per brick (deterministic)
      - soot fade near the top
      - concrete cap + soldier band (vertical bricks)
      - neon outline that follows the tapered silhouette
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    topY, botY = y, y + h
    TAPER = max(3, int(w * 0.08))
    xTL, xTR = x + TAPER, x + w - TAPER

    # ---- helpers -----------------------------------------------------------
    def _body_outline_pts():
        return [(xTL, topY), (xTR, topY), (x + w, botY), (x, botY), (xTL, topY)]

    def _top_for_x(ix):
        if ix < TAPER:
            return topY + h * (1.0 - ix / max(1.0, TAPER))
        elif ix > w - TAPER:
            return topY + h * ((ix - (w - TAPER)) / max(1.0, TAPER))
        else:
            return topY

    def _multi_stop_hgrad(t):
        c0 = _col(shade(PALETTE["obstacleFill"], -12))
        c1 = _col(shade(PALETTE["obstacleFill"],  -4))
        c2 = _col(PALETTE["obstacleFill"])
        c3 = _col(shade(PALETTE["obstacleFill"], -18))
        if t <= 0.25:
            return _lerp_color(c0, c1, t / 0.25)
        elif t <= 0.75:
            return _lerp_color(c1, c2, (t - 0.25) / 0.50)
        else:
            return _lerp_color(c2, c3, (t - 0.75) / 0.25)

    def _hash_int(n):
        n &= 0xFFFFFFFF
        n ^= (n >> 16); n = (n * 0x85ebca6b) & 0xFFFFFFFF
        n ^= (n >> 13); n = (n * 0xc2b2ae35) & 0xFFFFFFFF
        n ^= (n >> 16)
        return n

    # ---- soft shadow conforming to tapered silhouette ----------------------
    _poly(s, PALETTE["obstacleOutline"], _body_outline_pts(), a=int(0.16 * 255))

    # ---- body fill: horizontal multi-stop gradient, clipped to trapezoid ---
    for i in range(int(w)):
        t = i / max(1.0, w - 1.0)
        col = _multi_stop_hgrad(t)
        y_top = _top_for_x(i)
        pygame.draw.line(s, col, (int(x + i), int(y_top)), (int(x + i), int(botY - 1)), 1)

    # subtle side bevels
    for dx in range(0, 3):
        ix = int(dx); y_top = _top_for_x(ix)
        c = _col(shade(PALETTE["obstacleFill"], -34))
        pygame.draw.line(s, c+(int(0.10*255),), (int(x + ix), int(y_top + 2)), (int(x + ix), int(botY - 2)), 1)
    for dx in range(0, 2):
        ix = int(w - 3 + dx); y_top = _top_for_x(ix)
        c = _col(shade(PALETTE["obstacleFill"], +18))
        pygame.draw.line(s, c+(int(0.08*255),), (int(x + ix), int(y_top + 3)), (int(x + ix), int(botY - 3)), 1)

    # ---- brick courses -----------------------------------------------------
    mortar = _col(shade(PALETTE["obstacleFill"], -38))
    rowH, brickW = 6, 12
    y0 = int(topY + 6); y1 = int(botY - 6)
    for yy in range(y0, y1, rowH):
        trow = (yy - topY) / max(1.0, h)
        leftX  = x + TAPER * (1.0 - trow) + 4
        rightX = x + w - TAPER * (1.0 - trow) - 4
        _line(s, mortar, int(leftX), yy, int(rightX), yy, w=1, a=int(0.24*255))
        rowIdx = (yy - y0) // rowH
        offset = 0 if (rowIdx % 2) == 0 else int(brickW * 0.5)
        xx = int(leftX + 6 + offset)
        while xx < int(rightX - 6):
            _line(s, mortar, xx, yy, xx, min(yy + rowH, y1), w=1, a=int(0.24*255))
            xx += brickW

    # tint jitter inside bricks
    for yy in range(y0, y1, rowH):
        trow = (yy - topY) / max(1.0, h)
        leftX  = x + TAPER * (1.0 - trow) + 4
        rightX = x + w - TAPER * (1.0 - trow) - 4
        rowIdx = (yy - y0) // rowH
        offset = 0 if (rowIdx % 2) == 0 else int(brickW * 0.5)
        xx = int(leftX + 6 + offset)
        while xx < int(rightX - 6):
            hid = _hash_int(int(xx * 1315423911 + yy * 2654435761 + int(w)*97))
            tint = (hid % 13) - 6
            col = _col(shade(PALETTE["obstacleFill"], tint))
            pygame.draw.rect(s, col+(int(0.10*255),), pygame.Rect(int(xx + 1), int(yy + 1), int(brickW - 2), int(rowH - 2)))
            xx += brickW

    # ---- soot fade near the top -------------------------------------------
    hSoot = min(0.50 * h, h - 10)
    if hSoot > 2:
        yS0 = int(topY + 2); yS1 = int(topY + 2 + hSoot)
        for yy in range(yS0, yS1):
            k = (yy - yS0) / max(1.0, (yS1 - yS0))
            a = int(255 * 0.12 * (1.0 - k) * 0.35)
            trow = (yy - topY) / max(1.0, h)
            leftX  = x + TAPER * (1.0 - trow) + 2
            rightX = x + w - TAPER * (1.0 - trow) - 2
            pygame.draw.line(s, (0,0,0,a), (int(leftX), yy), (int(rightX), yy), 1)

    # ---- concrete cap ------------------------------------------------------
    CAP_H = max(6, int(h * 0.10))
    capInset = 3
    capY = topY + 2
    capW = (xTR - xTL) - capInset * 2
    capX = xTL + capInset
    capSurf = get_linear_gradient(int(capW), int(CAP_H),
                                  shade(PALETTE["obstacleFill"], 10),
                                  shade(PALETTE["obstacleFill"], -14),
                                  horizontal=False)
    roundRect(s, capX, capY, capW, CAP_H, 2, True, fill=(0,0,0,0))  # reserve area
    s.blit(capSurf, (int(capX), int(capY)))
    _line(s, shade(PALETTE["obstacleFill"], 22), int(capX + 2), int(capY + 2), int(capX + capW - 2), int(capY + 2), w=1, a=int(0.28*255))

    # ---- soldier course band ----------------------------------------------
    bandTop, bandH = capY + CAP_H + 1, 5
    pygame.draw.rect(s, _col(shade(PALETTE["obstacleFill"], -10)) + (int(0.30*255),), pygame.Rect(int(xTL + 2), int(bandTop), int((xTR - xTL) - 4), int(bandH)))
    bMid = bandTop + bandH * 0.5
    trow = (bMid - topY) / max(1.0, h)
    leftB  = x + TAPER * (1.0 - trow) + 6
    rightB = x + w - TAPER * (1.0 - trow) - 6
    xx = int(leftB)
    while xx < int(rightB):
        _line(s, shade(PALETTE["obstacleFill"], -32), xx, int(bandTop), xx, int(bandTop + bandH), w=1, a=int(0.40*255))
        xx += 6

    # ---- neon outline following tapered silhouette ------------------------
    _neon_line(s, PALETTE["obstacleOutline"], _body_outline_pts(), core_w=2, glow_w=6, glow_alpha=0.55)


def _drawAntenna(s, o, t):
    """
    1:1 port of your JS drawAntenna.
    pylon: Y silhouette (steel gradient), lattice (55% alpha), droppers, feet, duck line,
           neon on blocking segments only + small beacon.
    mast : base plate gradient, mast gradient, soft bands, pulsing beacon, neon spine.
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    cx = x + w * 0.5

    steelL  = _col(shade(PALETTE["obstacleFill"], -22))
    steelM  = _col(PALETTE["obstacleFill"])
    steelR  = _col(shade(PALETTE["obstacleFill"], -26))

    pulse = 0.5 + 0.5 * math.sin(t * 6.0)
    blink = 0.65 + 0.35 * (0.5 * (1.0 + math.sin(t * 6.0)))

    if o.get("variant") == "pylon":
        # ----- Y-pylon -----
        top    = y
        baseY  = o.get("baseY", y + h)
        yClear = baseY - o.get("clearance", 30)

        footOut   = max(8.0, 0.46 * w)
        waistY    = top + max(18.0, h * 0.52)
        waistW    = max(8.0,  0.20 * w)
        shoulderY = top + max(10.0, h * 0.28)
        armSpan   = max(28.0, 0.95 * w)
        armW      = max(12.0, 0.36 * w)
        legW      = 3

        Lf = (cx - footOut,   baseY)
        Rf = (cx + footOut,   baseY)
        Lw = (cx - waistW/2,  waistY)
        Rw = (cx + waistW/2,  waistY)
        Ls = (cx - armW/2,    shoulderY)
        Rs = (cx + armW/2,    shoulderY)
        La = (cx - armSpan/2, shoulderY - 2)
        Ra = (cx + armSpan/2, shoulderY - 2)

        # silhouette with steel gradient + round caps
        path = [Lf, Lw, Ls, La, Ra, Rs, Rw, Rf]
        _stroke_polyline_grad_round(s, path, legW, x, w, steelL, steelM, steelR, segments=12)

        # lattice (diagonals) ~55% alpha
        crossCol = _col(shade(PALETTE["obstacleFill"], -18))
        # base → waist (4 slices)
        for i in range(4):
            t0 = i/4.0; t1 = (i+1)/4.0
            ly0 = baseY - (baseY - waistY) * t0
            ly1 = baseY - (baseY - waistY) * t1
            lx0 = Lf[0] + (Lw[0] - Lf[0]) * t0
            lx1 = Lf[0] + (Lw[0] - Lf[0]) * t1
            rx0 = Rf[0] + (Rw[0] - Rf[0]) * t0
            rx1 = Rf[0] + (Rw[0] - Rf[0]) * t1  # (fixed)
            _line(s, crossCol, int(lx0), int(ly0), int(rx1), int(ly1), w=2, a=int(0.55*255))
            _line(s, crossCol, int(rx0), int(ly0), int(lx1), int(ly1), w=2, a=int(0.55*255))
        # waist → shoulders (3 slices)
        for i in range(3):
            t0 = i/3.0; t1 = (i+1)/3.0
            uy0 = waistY - (waistY - shoulderY) * t0
            uy1 = waistY - (waistY - shoulderY) * t1
            lx0 = Lw[0] + (Ls[0] - Lw[0]) * t0
            lx1 = Lw[0] + (Ls[0] - Lw[0]) * t1
            rx0 = Rw[0] + (Rs[0] - Rw[0]) * t0
            rx1 = Rw[0] + (Rs[0] - Rw[0]) * t1
            _line(s, crossCol, int(lx0), int(uy0), int(rx1), int(uy1), w=2, a=int(0.55*255))
            _line(s, crossCol, int(rx0), int(uy0), int(lx1), int(uy1), w=2, a=int(0.55*255))

        # droppers (insulators)
        dropCol = shade(PALETTE["obstacleOutline"], -6)
        _line_round(s, dropCol, La[0], La[1], La[0], La[1] + 8, w=2, a=int(0.8*255))
        _line_round(s, dropCol, Ra[0], Ra[1], Ra[0], Ra[1] + 8, w=2, a=int(0.8*255))

        # base feet
        footCol = shade(PALETTE["obstacleFill"], -30)
        roundRect(s, int(Lf[0] - 6), int(baseY - 3), 12, 6, 3, True, fill=footCol)
        roundRect(s, int(Rf[0] - 6), int(baseY - 3), 12, 6, 3, True, fill=footCol)

        # duck line (visual)
        duckCol = shade(PALETTE["obstacleOutline"], -14)
        _line(s, duckCol, int(Lw[0] + 4), int(yClear), int(Rw[0] - 4), int(yClear), w=3, a=int(0.5*255))

        # neon only on blocking silhouette + cross-arm
        _neon_line(s, PALETTE["obstacleOutline"], [(int(Ls[0]), int(Ls[1])), (int(Lw[0]), int(Lw[1])), (int(cx), int(yClear))],
                   core_w=2, glow_w=6, glow_alpha=0.55)
        _neon_line(s, PALETTE["obstacleOutline"], [(int(Rs[0]), int(Rs[1])), (int(Rw[0]), int(Rw[1])), (int(cx), int(yClear))],
                   core_w=2, glow_w=6, glow_alpha=0.55)
        _neon_line(s, PALETTE["obstacleOutline"], [(int(La[0]), int(La[1])), (int(Ra[0]), int(Ra[1]))],
                   core_w=2, glow_w=6, glow_alpha=0.55)

        # small top beacon
        _circle(s, (255, 160, 150), cx, y + 4, 4, a=int(255 * 0.45 * blink))
        _circle(s, (255, 120, 120), cx, y + 4, 2, a=int(255 * 0.90))

    else:
        # ----- classic mast -----
        top = y
        bot = y + h
        mW = max(2, min(4, int(round(w * 0.45))))

        # base plate (vertical gradient)
        plateW = max(w + 10, 18)
        plateH = 6
        plateX = cx - plateW/2
        plateY = bot - plateH
        pg = get_linear_gradient(int(plateW), int(plateH),
                                 shade(PALETTE["obstacleFill"], 12),
                                 shade(PALETTE["obstacleFill"], -18),
                                 horizontal=False)
        s.blit(pg, (int(plateX), int(plateY)))

        # mast body (horizontal gradient with mid highlight)
        bodyH = int(h - plateH + 1)
        mg1 = get_linear_gradient(int(mW), int(bodyH),
                                  shade(PALETTE["obstacleFill"], -20),
                                  PALETTE["obstacleFill"], horizontal=True)
        mg2 = get_linear_gradient(int(mW), int(bodyH),
                                  PALETTE["obstacleFill"],
                                  shade(PALETTE["obstacleFill"], -28), horizontal=True)
        s.blit(mg1, (int(cx - mW/2), int(top)))
        s.blit(mg2, (int(cx - mW/2), int(top)))

        # soft ladder/bands
        bandCol = _col(shade(PALETTE["obstacleOutline"], -18))
        yy = top + 10
        while yy < bot - plateH - 6:
            roundRect(s, int(cx - (mW + 6)/2), int(yy), int(mW + 6), 3, 2, True,
                      fill=bandCol + (int(0.28*255),))
            yy += 16

        # pulsing beacon (halo + core)
        capR = max(2.5, mW * 0.8)
        bx, by = cx, top + 2
        halo_a = int(0.28 * 255 * (0.6 + 0.4 * pulse))
        pygame.draw.circle(s, (91, 188, 255, halo_a), (int(bx), int(by)), int(9 + pulse * 5), width=2)
        pygame.draw.circle(s, (255, 120, 120, 240), (int(bx), int(by)), int(capR))

        # neon spine
        _neon_line(s, PALETTE["obstacleOutline"], [(int(cx), int(top)), (int(cx), int(bot - plateH))],
                   core_w=2, glow_w=6, glow_alpha=0.55)


def _drawHVAC(s, o):
    """
    React-like HVAC:
      - soft outer shadow
      - 3-stop horizontal 'metal' gradient body
      - lid with vertical gradient + seam line
      - horizontal louver slats
      - circular fan grille (rings + cross + hub)
      - right access panel with screws + handle
      - small conduit stub curve
      - rubber feet
      - subtle front highlight band
      - neon rounded outline
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    xI, yI, wI, hI = int(x), int(y), int(w), int(h)
    r = 4
    inset = 4

    # --- palette shortcuts
    fill    = PALETTE["obstacleFill"]
    outline = PALETTE["obstacleOutline"]

    # --- soft outer shadow
    roundRect(s, xI - 2, yI - 2, wI + 4, hI + 5, r, True,
              fill=_col(outline) + (int(0.14 * 255),))

    # --- body: 3-stop horizontal gradient (-18 → base → -24)
    bodySurf = pygame.Surface((wI, hI), pygame.SRCALPHA)
    mid = wI // 2
    leftG  = get_linear_gradient(mid + 1, hI,
                                 shade(fill, -18), fill, horizontal=True)
    rightG = get_linear_gradient(wI - mid, hI,
                                 fill, shade(fill, -24), horizontal=True)
    bodySurf.blit(leftG, (0, 0))
    bodySurf.blit(rightG, (mid, 0))
    s.blit(bodySurf, (xI, yI))

    # --- top lid (vertical gradient) + seam under lid
    lidH = max(4, min(6, int(hI * 0.14)))
    lid = get_linear_gradient(wI - 4, lidH,
                              shade(fill, 14), shade(fill, -8),
                              horizontal=False)
    s.blit(lid, (xI + 2, yI + 1))
    # seam line
    pygame.draw.line(
        s,
        _col(shade(outline, -16)) + (int(0.40 * 255),),
        (xI + 2, int(yI + lidH + 1.5)),
        (xI + wI - 2, int(yI + lidH + 1.5)),
        1
    )

    # --- louver slats (horizontal)
    slatTop = yI + lidH + 5
    slatBot = yI + hI - 8
    slatCol = _col(shade(outline, -18))
    for yy in range(int(slatTop), int(slatBot), 5):
        pygame.draw.line(
            s, slatCol + (int(0.28 * 255),),
            (xI + inset, yy), (xI + wI - inset, yy), 1
        )

    # --- circular fan grille (left bay)
    bayW  = max(20, int(wI * 0.42))
    fanCX = xI + inset + int(bayW * 0.55)
    fanCY = yI + int(hI * 0.52)
    fanR  = max(8, min(14, int(min(wI, hI) * 0.28)))

    # fan housing (darker disk)
    pygame.draw.circle(
        s, _col(shade(fill, -10)) + (int(0.85 * 255),),
        (int(fanCX), int(fanCY)), int(fanR + 2)
    )
    # grille rings
    ringCol = _col(shade(outline, -4))
    for rr in range(fanR, fanR - 5, -2):
        pygame.draw.circle(
            s, ringCol + (int(0.75 * 255),),
            (int(fanCX), int(fanCY)), int(rr), width=1
        )
    # grille cross
    pygame.draw.line(
        s, ringCol + (int(0.75 * 255),),
        (int(fanCX - fanR + 1), int(fanCY)),
        (int(fanCX + fanR - 1), int(fanCY)), 1
    )
    pygame.draw.line(
        s, ringCol + (int(0.75 * 255),),
        (int(fanCX), int(fanCY - fanR + 1)),
        (int(fanCX), int(fanCY + fanR - 1)), 1
    )
    # hub
    pygame.draw.circle(
        s, _col(shade(outline, -10)) + (int(0.90 * 255),),
        (int(fanCX), int(fanCY)), 2
    )

    # --- access panel (right bay) with screws + handle
    panelW = max(18, int(wI * 0.34))
    panelH = max(14, int(hI * 0.38))
    panelX = xI + wI - panelW - inset
    panelY = yI + int(hI * 0.35)
    gp = get_linear_gradient(panelW, panelH,
                             shade(fill, 6), shade(fill, -12),
                             horizontal=False)
    s.blit(gp, (panelX, panelY))
    # screws
    scr = _col(shade(outline, -12)) + (int(0.6 * 255),)
    for (sx, sy) in [
        (panelX + 3, panelY + 3),
        (panelX + panelW - 5, panelY + 3),
        (panelX + 3, panelY + panelH - 5),
        (panelX + panelW - 5, panelY + panelH - 5),
    ]:
        pygame.draw.rect(s, scr, pygame.Rect(int(sx), int(sy), 2, 2))
    # handle
    hx = panelX + panelW - 8
    hy = panelY + panelH // 2
    pygame.draw.line(
        s, _col(shade(outline, -6)) + (int(0.9 * 255),),
        (int(hx - 4), int(hy)), (int(hx + 2), int(hy)), 2
    )

    # --- conduit stub (quadratic curve approximation)
    c0x = xI + wI - 2
    c0y = yI + hI - 10
    c1x, c1y = c0x + 10, c0y + 2  # control
    c2x, c2y = c0x + 8,  c0y + 10
    pts = []
    for i in range(9):  # 0..8 → 9 points
        t = i / 8.0
        mt = 1.0 - t
        qx = mt*mt*c0x + 2*mt*t*c1x + t*t*c2x
        qy = mt*mt*c0y + 2*mt*t*c1y + t*t*c2y
        pts.append((int(qx), int(qy)))
    pygame.draw.lines(s, _col(shade(outline, -10)) + (int(0.6 * 255),), False, pts, 2)

    # --- rubber feet / skids
    footW, footH = 10, 3
    footY = yI + hI - footH
    roundRect(s, xI + 6,           footY, footW, footH, 2, True, fill=shade(fill, -26))
    roundRect(s, xI + wI - 6 - footW, footY, footW, footH, 2, True, fill=shade(fill, -26))

    # --- subtle front highlight band
    hbW = max(10, int(wI * 0.35))
    hbH = int(hI * 0.65)
    roundRect(s, xI + 3, yI + 8, hbW, hbH, 3, True, fill=(207, 230, 255, int(0.12 * 255)))

    # --- neon edge accent
    _neon_rounded_rect(s, outline, xI, yI, wI, hI, r, core_w=2, glow_w=6, glow_alpha=0.55)


def _drawVentPipe(s, o):
    """
    1:1-ish port of the JS drawVentPipe:
      - Silhouette built from lines + two quarter-round elbows + left intake circle
      - 3/4-stop vertical highlight inside (galvanized look)
      - Rim darkening clipped to the shape
      - Rolled seams (run, collar, elbow, leg)
      - Flanged circular grille with thin sparse horizontals
      - Optional rain hood (o.startStyle == 'hood')
      - Brackets along the run
      - Neon outline around the whole path
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    deckY = y + h

    # --- sizing (mirror JS) --------------------------------------------------
    pad = 6.0
    R = float(max(10, min(20, int(min(h * 0.30, w * 0.18)))))
    ReLayout = round(R * 1.12)     # layout elbow (fatter only for layout math)
    Re = R                          # actual elbow radius for drawing
    collarL = max(10.0, float(int(R * 1.2)))

    yMid = min(deckY - Re - 8.0, y + max(Re + 10.0, float(int(h * 0.52))))
    leftC = x + pad + R

    elbowMaxC = x + w - pad - ReLayout
    maxRun = max(8.0, float(int(elbowMaxC - (leftC + ReLayout + collarL))))
    if isinstance(o.get("runPx"), (int, float)):
        runLenRaw = float(o["runPx"])
    elif isinstance(o.get("runFrac"), (int, float)):
        runLenRaw = float(o["runFrac"]) * maxRun
    else:
        runLenRaw = 0.90 * maxRun
    runLen = max(8.0, min(maxRun, float(int(runLenRaw))))

    extra = 2.0 * (ReLayout - Re)
    stepStartX = leftC + runLen + extra
    elbowC = stepStartX + Re + collarL
    kneeInset = max(2.0, float(int(R * 0.15)))

    # --- build silhouette polygon (Path2D → poly) ----------------------------
    def arc_points(cx, cy, rad, a0, a1, steps):
        # from a0 to a1 (radians), inclusive
        pts = []
        for i in range(steps + 1):
            t = i / steps
            a = a0 + (a1 - a0) * t
            pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
        return pts

    poly = []
    # top straight (grille → step start)
    poly.append((leftC, yMid - R))
    poly.append((stepStartX, yMid - R))
    # notch into elbow
    poly.append((elbowC - Re - kneeInset, yMid - Re))
    poly.append((elbowC, yMid - Re))
    # outer elbow (-pi/2 .. 0)
    poly += arc_points(elbowC, yMid, Re, -math.pi/2, 0.0, 8)
    # drop to deck and back to elbow inner
    poly.append((elbowC + Re, deckY))
    poly.append((elbowC - Re, deckY))
    poly.append((elbowC - Re, yMid))
    # inner elbow (pi .. pi/2) reversed
    poly += arc_points(elbowC, yMid, Re, math.pi, math.pi/2, 8)
    # back toward step and grille bottom
    poly.append((elbowC - Re - kneeInset, yMid + Re))
    poly.append((stepStartX, yMid + R))
    poly.append((leftC, yMid + R))
    # left intake semicircle (pi/2 .. -pi/2)
    poly += arc_points(leftC, yMid, R, math.pi/2, -math.pi/2, 16)
    # close implicit

    # local coords relative to (x,y) for masking
    poly_local = [(px - x, py - y) for (px, py) in poly]
    wI, hI = int(w), int(h)
    xI, yI = int(x), int(y)

    # --- Fill (galvanized) using a masked gradient surface -------------------
    fillSurf = pygame.Surface((wI, hI), pygame.SRCALPHA)

    # vertical gradient centered on yMid±Re with mid highlight band
    gH = max(2, int(2 * Re))
    gy = int((yMid - Re) - y)  # where gradient sits in local surface
    gMain = get_linear_gradient(wI, gH,
                                shade(PALETTE["obstacleFill"], -20),
                                shade(PALETTE["obstacleFill"], -24),
                                horizontal=False)
    fillSurf.blit(gMain, (0, gy))
    # mid highlights (two stops ~0.42 and ~0.58)
    bandTop = gy + int(0.42 * gH)
    bandBot = gy + int(0.58 * gH)
    if bandBot > bandTop:
        hl = pygame.Surface((wI, bandBot - bandTop), pygame.SRCALPHA)
        hl.fill(_col(shade(PALETTE["obstacleFill"], +12)) + (120,))
        fillSurf.blit(hl, (0, bandTop))

    # rim darkening (drawn on fillSurf before clipping)
    rimA = int(0.25 * 255)
    rimW = max(1, int(R * 0.18))
    topA = _col(shade(PALETTE["obstacleOutline"], -28)) + (rimA,)
    botA = _col(shade(PALETTE["obstacleOutline"], -28)) + (rimA,)
    pygame.draw.line(
        fillSurf, topA,
        (int(leftC - R - x), int(yMid - R + 1 - y)),
        (int(elbowC + Re - x), int(yMid - Re + 1 - y)),
        rimW
    )
    pygame.draw.line(
        fillSurf, botA,
        (int(leftC - R - x), int(yMid + R - 1 - y)),
        (int(elbowC + Re - x), int(yMid + Re - 1 - y)),
        rimW
    )

    # mask to polygon
    mask = pygame.Surface((wI, hI), pygame.SRCALPHA)
    pygame.draw.polygon(mask, (255, 255, 255, 255), [(int(px), int(py)) for px, py in poly_local])
    masked = fillSurf.copy()
    masked.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(masked, (xI, yI))

    # --- Rolled seams along the run -----------------------------------------
    startX = leftC + max(8.0, R * 0.6)
    endX = stepStartX - max(6.0, R * 0.4)
    step = max(12.0, float(int(R * 1.05)))
    for xi in frange(startX, endX, step):
        _line(s, shade(PALETTE["obstacleOutline"], -22), int(xi), int(yMid - (R - 0.5)),
              int(xi), int(yMid + (R - 0.5)), w=1, a=int(0.30 * 255))
        _line(s, shade(PALETTE["obstacleFill"], +28), int(xi + 1), int(yMid - (R - 2)),
              int(xi + 1), int(yMid + (R - 2)), w=1, a=int(0.30 * 255))

    # --- Collar bands --------------------------------------------------------
    xs = [stepStartX + 2.0, elbowC - Re - max(2.0, R * 0.1)]
    for xi in xs:
        _line(s, shade(PALETTE["obstacleOutline"], -25), int(xi), int(yMid - Re),
              int(xi), int(yMid + Re), w=1, a=int(0.35 * 255))
        _line(s, shade(PALETTE["obstacleFill"], +26), int(xi + 1), int(yMid - (Re - 2)),
              int(xi + 1), int(yMid + (Re - 2)), w=1, a=int(0.35 * 255))

    # --- Elbow gore seams ----------------------------------------------------
    stepR = max(3.5, Re * 0.18)
    rr = Re * 0.85
    while rr >= Re * 0.40:
        rect = pygame.Rect(int(elbowC - rr), int(yMid - rr), int(rr * 2), int(rr * 2))
        pygame.draw.arc(s, _col(shade(PALETTE["obstacleOutline"], -25)) + (int(0.32 * 255),), rect,
                        -math.pi/2 + 0.06, 0.0 - 0.06, 1)
        rect2 = pygame.Rect(int(elbowC - (rr - 1)), int(yMid - (rr - 1)), int((rr - 1) * 2), int((rr - 1) * 2))
        pygame.draw.arc(s, _col(shade(PALETTE["obstacleFill"], +24)) + (int(0.32 * 255),), rect2,
                        -math.pi/2 + 0.12, 0.0 - 0.12, 1)
        rr -= stepR

    # --- Leg seams -----------------------------------------------------------
    startY = yMid + max(8.0, Re * 0.3)
    endY = deckY - max(6.0, Re * 0.25)
    stepY = max(12.0, float(int(Re * 1.05)))
    for yi in frange(startY, endY, stepY):
        _line(s, shade(PALETTE["obstacleOutline"], -22), int(elbowC - (Re - 0.5)), int(yi),
              int(elbowC + (Re - 0.5)), int(yi), w=1, a=int(0.30 * 255))
        _line(s, shade(PALETTE["obstacleFill"], +28), int(elbowC - (Re - 2)), int(yi + 1),
              int(elbowC + (Re - 2)), int(yi + 1), w=1, a=int(0.30 * 255))

    # --- Flanged grille (thin horizontal lines) ------------------------------
    outerR = R - 1.0          # flange
    openR  = max(2.0, R - 3.0)
    # flange ring
    pygame.draw.circle(s, _col(shade(PALETTE["obstacleOutline"], -22)) + (int(0.95 * 255),),
                       (int(leftC), int(yMid)), int(outerR), width=2)
    # inner sheen
    pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], +30)) + (int(0.55 * 255),),
                       (int(leftC), int(yMid)), int(openR - 0.6), width=1)

    # recessed cavity fill (approx radial)
    pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], -12)) + (255,), (int(leftC), int(yMid)), int(openR))
    pygame.draw.circle(s, _col(shade(PALETTE["obstacleOutline"], -48)) + (90,), (int(leftC+R*0.2), int(yMid+R*0.2)),
                       int(openR), width=0)

    # THIN HORIZONTAL LINES (sparse, spread out)
    sideGap = 1.2
    margin  = max(3, int(R * 0.22))
    pitch   = max(3, int(R * (o.get("grillePitchMul", 0.34))))
    topLine = int(yMid - openR + margin)
    botLine = int(yMid + openR - margin)
    for yy in range(topLine, botLine + 1, pitch):
        dy = yy - yMid
        half = math.sqrt(max(0.0, (openR - sideGap) ** 2 - dy * dy))
        Lx = leftC - half; Rx = leftC + half
        # dark line
        _line(s, shade(PALETTE["obstacleOutline"], -36),
              int(Lx), int(round(yy) + 0.5), int(Rx), int(round(yy) + 0.5), w=1, a=int(0.85 * 255))
        # faint highlight just above
        _line(s, shade(PALETTE["obstacleFill"], +22),
              int(Lx + 1), int(round(yy) - 0.5), int(Rx - 1), int(round(yy) - 0.5), w=1, a=int(0.45 * 255))

    # --- Optional rain hood over inlet ---------------------------------------
    if o.get("startStyle") == "hood":
        a0 = math.pi * 0.60
        a1 = math.pi * 1.40
        outer = arc_points(leftC, yMid, R - 0.8, a0, a1, 20)
        inner = arc_points(leftC, yMid, R - 4.8, a1, a0, 20)  # reverse
        hood_poly = [(px, py) for (px, py) in outer + inner]
        pygame.draw.polygon(s, _col(shade(PALETTE["obstacleFill"], -10)) + (int(0.9 * 255),),
                            [(int(px), int(py)) for (px, py) in hood_poly])
        pygame.draw.lines(s, _col(shade(PALETTE["obstacleFill"], +26)) + (int(0.45 * 255),),
                          False, [(int(px), int(py)) for (px, py) in outer], 1)

    # --- Tiny brackets along run (start near grille; step rightward) ----------
    leftBound  = leftC + max(R * 0.85, 6.0)
    rightBound = stepStartX - max(R * 0.35, 6.0)
    usable = rightBound - leftBound
    if usable > 2:
        legWBase   = max(2, int(R * 0.22))
        strapH     = max(2, int(R * 0.26))
        strapWBase = max(9, int(R * 0.85))
        topY       = yMid + R - 1
        legH       = max(4, int(deckY - topY + 1))

        def draw_bracket(xi):
            leftAvail  = max(0.0, (xi - leftBound) - 1.0)
            rightAvail = max(0.0, (rightBound - xi) - 1.0)
            half = max(4.0, min(strapWBase * 0.5, leftAvail, rightAvail))
            strapW = max(6, int(half * 2.0))
            legW   = legWBase

            # vertical leg
            roundRect(s, int(xi - legW / 2), int(topY), legW, legH, 2, True,
                      fill=shade(PALETTE["obstacleOutline"], -42))
            # foot pad
            roundRect(s, int(xi - legW * 1.4), int(deckY - 3), int(legW * 2.8), 4, 2, True,
                      fill=shade(PALETTE["obstacleOutline"], -42))
            # strap
            roundRect(s, int(xi - strapW / 2), int(yMid + R - strapH - 1),
                      strapW, strapH, int(max(1, strapH / 2)), True,
                      fill=shade(PALETTE["obstacleOutline"], -36))
            # tiny highlight
            _line(s, shade(PALETTE["obstacleFill"], +24),
                  int(xi - strapW * 0.45), int(yMid + R - 1.5),
                  int(xi + strapW * 0.45), int(yMid + R - 1.5), w=1, a=int(0.45 * 255))

        # first bracket near grille
        startClear = max(2.0, R * 0.18)
        firstX = max(leftBound + 3.0, min(leftBound + startClear, rightBound - 3.0))
        draw_bracket(firstX)

        # then step rightward with doubled spacing
        baseSpacing = max(20, int(R * 1.4))
        spacing = int((o.get("bracketSpacingMul", 2)) * baseSpacing)
        xi = firstX + spacing
        while xi <= rightBound - 3.0:
            draw_bracket(xi)
            xi += spacing

    # --- Neon outline (stroke the silhouette poly) ---------------------------
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(px), int(py)) for (px, py) in poly + [poly[0]]],
               core_w=2.0, glow_w=5.5, glow_alpha=0.62)
# small float-range helper (step > 0)
def frange(a, b, step):
    x = a
    if step <= 0: step = 1.0
    while x <= b + 1e-6:
        yield x
        x += step


def _drawAccessShed(s, o):
    """
    1:1-ish port of JS drawAccessShed:
      - 3D side/back extrude with gradients
      - coping cap + tiny drip shadow
      - CMU front wall w/ mortar hints
      - steel door + jamb, hinges, lever + door louvers
      - small cage light glow
      - multi-part neon (with clipping) including outer U, front U, ridge, side/back edges, and deck stitch
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    dir = int(o.get("roofDir", 1))  # 1 rises to right, -1 rises to left
    yBot = y + h

    # ---- front body geometry
    bodyY  = y + 6
    bodyH  = h - 6
    bodyR  = 3

    # Top coping cap
    capH = 5
    capOver = max(2, min(4, int(w * 0.06)))
    roofTopY = y
    roofBotY = y + capH

    # ridge overhang (kept small so neon ≈ hitbox)
    rawOver = max(6, min(10, int(w * 0.18)))
    EPS = 0.5
    ridgeL = max(x + EPS,     x     + (-rawOver if dir == -1 else 0))
    ridgeR = min(x + w - EPS, x + w + ( rawOver if dir ==  1 else 0))

    # ---- simple 3D side extrude (behind the front)
    d  = max(6, min(12, int(w * 0.22)))
    px = ( d if dir == 1 else -d)
    py = -int(d * 0.35)

    sideRoofTopY = max(roofTopY, roofTopY + py)
    sideRoofBotY = max(roofBotY, roofBotY + py)
    sideWallTopY = max(bodyY,    bodyY    + py)

    sideXFront = (x + w) if dir == 1 else x
    sideXBack  = sideXFront + px

    edgeBotX = (x + w) if dir == 1 else x
    edgeTopX = ridgeR if dir == 1 else ridgeL

    # small helpers -----------------------------------------------------------
    def poly_mask_fill(points, grad_surf, dest=(0, 0)):
        """Mask a gradient surface by polygon and blit to s at dest (no needless scaling)."""
        xs = [p[0] for p in points]; ys = [p[1] for p in points]
        minx, maxx = int(math.floor(min(xs))), int(math.ceil(max(xs)))
        miny, maxy = int(math.floor(min(ys))), int(math.ceil(max(ys)))
        bw, bh = max(1, maxx - minx), max(1, maxy - miny)

        # Build mask once for the polygon's tight box
        mask = pygame.Surface((bw, bh), pygame.SRCALPHA)
        pts = [(int(px - minx), int(py - miny)) for (px, py) in points]
        pygame.draw.polygon(mask, (255, 255, 255, 255), pts)

        # If the gradient already matches, skip smoothscale
        if grad_surf.get_width() == bw and grad_surf.get_height() == bh:
            out = grad_surf.copy()
        else:
            out = pygame.transform.smoothscale(grad_surf, (bw, bh))

        out.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        s.blit(out, (minx, miny))

    # -------------------- SIDE/BACK (behind) --------------------
    # Thin side tar strip (kept above deck)
    sideTarTop = yBot - 3
    tar_poly = [
        (sideXFront, sideTarTop),
        (sideXBack,  sideTarTop + (sideRoofBotY - roofBotY)),
        (sideXBack,  sideTarTop + 3 + (sideRoofBotY - roofBotY)),
        (sideXFront, sideTarTop + 3),
    ]
    pygame.draw.polygon(
        s,
        _col(shade(PALETTE["obstacleOutline"], -40)) + (int(0.85 * 255),),
        [(int(a), int(b)) for a, b in tar_poly],
    )

    # Side wall quad (gradient)
    side_wall_poly = [
        (sideXFront, bodyY),
        (sideXBack,  sideWallTopY),
        (sideXBack,  bodyY + bodyH + (sideWallTopY - bodyY)),
        (sideXFront, bodyY + bodyH),
    ]
    sideShade = get_linear_gradient(
        max(1, int(abs(sideXBack - sideXFront))),
        max(1, int(abs((sideWallTopY) - (bodyY + bodyH)) + bodyH)),
        shade(PALETTE["obstacleFill"], -8),
        shade(PALETTE["obstacleFill"], -22),
        horizontal=True
    )
    poly_mask_fill(side_wall_poly, sideShade)

    # Side "roof" strip (under coping return)
    side_roof_poly = [
        (edgeBotX,          roofBotY),
        (edgeTopX,          roofTopY),
        (edgeTopX + px,     sideRoofTopY),
        (edgeBotX + px,     sideRoofBotY),
    ]
    sideRoofGrad = get_linear_gradient(
        max(1, int(abs((edgeTopX + px) - edgeBotX))),
        max(1, int(abs(sideRoofBotY - roofBotY))),
        shade(PALETTE["obstacleFill"], -2),
        shade(PALETTE["obstacleFill"], -18),
        horizontal=True
    )
    poly_mask_fill(side_roof_poly, sideRoofGrad)

    # Subtle back-edge hints
    hint_col = (170, 210, 255, int(0.35 * 255))
    pygame.draw.line(s, hint_col, (int(sideXBack), int(sideWallTopY)),
                     (int(sideXBack), int(bodyY + bodyH + (sideWallTopY - bodyY))), 1)
    pygame.draw.lines(s, hint_col, True,
                      [(int(edgeBotX + 0.5),      int(roofBotY + 0.5)),
                       (int(edgeTopX + 0.5),      int(roofTopY + 0.5)),
                       (int(edgeTopX + px + 0.5), int(sideRoofTopY + 0.5)),
                       (int(edgeBotX + px + 0.5), int(sideRoofBotY + 0.5))], 1)

    # -------------------- FRONT (in front) --------------------
    # Tar/torch-down base
    roundRect(s, int(x - 6), int(yBot - 3), int(w + 12), 3, 3, True,
              fill=shade(PALETTE["obstacleOutline"], -38))

    # Coping tiny overhang shadow
    roundRect(s, int(x - capOver + 1), int(roofTopY - 1), int(w + capOver * 2 - 2), 2, 2, True,
              fill=_col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.22 * 255),))

    # Coping cap gradient (masked rounded rect)
    capW, capHh = int(w + capOver * 2), capH
    capGrad = get_linear_gradient(capW, capHh, shade(PALETTE["obstacleFill"], 10),
                                  shade(PALETTE["obstacleFill"], -12), horizontal=False)
    capMask = rounded_rect_mask(capW, capHh, 3)
    capSurf = capGrad.copy()
    capSurf.blit(capMask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(capSurf, (int(x - capOver), int(roofTopY)))

    # Front wall (painted CMU)
    wallGrad = get_linear_gradient(int(w), int(bodyH),
                                   shade(PALETTE["obstacleFill"], 6),
                                   shade(PALETTE["obstacleFill"], -12),
                                   horizontal=False)
    wallMask = rounded_rect_mask(int(w), int(bodyH), bodyR)
    wallSurf = wallGrad.copy()
    wallSurf.blit(wallMask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(wallSurf, (int(x), int(bodyY)))

    # Mortar hints (very subtle)
    rowH = 7
    mortCol = _col(shade(PALETTE["obstacleOutline"], -24)) + (int(0.14 * 255),)
    yy = bodyY + 9
    while yy < bodyY + bodyH - 6:
        pygame.draw.line(s, mortCol, (int(x + 6), int(yy)), (int(x + w - 6), int(yy)), 1)
        yy += rowH

    # Door + hardware
    dw = max(18, int(w * 0.38))
    dh = max(26, int(bodyH * 0.60))
    dx = int(x + w * 0.16)
    dy = int(bodyY + bodyH - dh - 6)

    # Door frame (jamb)
    roundRect(s, dx - 2, dy - 2, dw + 4, dh + 4, 3, False,
              outline=_col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.35 * 255),), width=2)

    # Door leaf (gradient + mask)
    doorGrad = get_linear_gradient(dw, dh,
                                   shade(PALETTE["obstacleFill"], -8),
                                   shade(PALETTE["obstacleFill"], -22),
                                   horizontal=False)
    doorMask = rounded_rect_mask(dw, dh, 3)
    doorSurf = doorGrad.copy()
    doorSurf.blit(doorMask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(doorSurf, (dx, dy))

    # Hinges (right side)
    hingeCol = _col(shade(PALETTE["obstacleOutline"], -8)) + (int(0.7 * 255),)
    hingeY1 = dy + int(dh * 0.28)
    hingeY2 = dy + int(dh * 0.62)
    pygame.draw.rect(s, hingeCol, pygame.Rect(dx + dw + 1, hingeY1, 3, 5))
    pygame.draw.rect(s, hingeCol, pygame.Rect(dx + dw + 1, hingeY2, 3, 5))

    # Lever handle
    pygame.draw.line(s, _col(shade(PALETTE["obstacleOutline"], -6)) + (int(0.9 * 255),),
                     (int(dx + dw - 14), int(dy + dh * 0.52)),
                     (int(dx + dw - 6),  int(dy + dh * 0.52)), 2)

    # Louver slats on door
    lvX = dx + 5; lvY = dy + 8; lvW = dw - 10; rows = 5
    louCol = _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.32 * 255),)
    for i in range(rows):
        yy = lvY + i * 4
        pygame.draw.line(s, louCol, (int(lvX), int(yy)), (int(lvX + lvW), int(yy)), 1)

    # Little cage light above door (soft glow)
    lx = dx + int(dw * 0.5); ly = dy - 6
    pygame.draw.circle(s, (169, 230, 255, 217), (int(lx), int(ly)), 2)
    # simple radial-ish glow
    for rr, a in [(10, 90), (8, 70), (6, 50), (4, 35)]:
        pygame.draw.circle(s, (150, 210, 255, a), (int(lx), int(ly)), rr)

    # -------------------- NEON (3D) --------------------
    contactY = yBot

    # OUTER silhouette extents (include side extrude) — for hitbox/clip
    outerL = min(x, sideXBack) if dir == -1 else x
    outerR = max(x + w, sideXBack) if dir == 1  else x + w

    # Clip region for neon (keep headroom so drop leg kisses the deck)
    clip_rect = pygame.Rect(int(outerL - 14), int(y - 24),
                            int((outerR - outerL) + 28), int((yBot - y) + 21))
    prev_clip = s.get_clip()
    s.set_clip(clip_rect)

    # (A) Back/side neon (dim) for depth
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(sideXBack), int(sideWallTopY)), (int(sideXBack), int(yBot + 2))],
               core_w=1.2, glow_w=3.6, glow_alpha=0.32)
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(edgeTopX + px), int(sideRoofTopY)), (int(edgeBotX + px), int(sideRoofBotY))],
               core_w=1.2, glow_w=3.4, glow_alpha=0.30)
    # tiny ridge thickness
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(edgeTopX), int(roofTopY)), (int(edgeTopX + px), int(sideRoofTopY))],
               core_w=1.1, glow_w=3.0, glow_alpha=0.28)

    # (B) Front face neon (bright)
    frontL = int(round(x) + 0.5)
    frontR = int(round(x + w) - 0.5)
    topYLine   = int(round(y) + 0.5)
    baseYLine  = int(contactY + 0.5)

    # Coping front lip
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(x - capOver + 1), int(roofTopY + 1)),
                (int(x + w + capOver - 1), int(roofTopY + 1))],
               core_w=1.5, glow_w=4.2, glow_alpha=0.55)

    # Front rectangle (U) down the sides
    _neon_line(s, PALETTE["obstacleOutline"],
               [(frontL, baseYLine + 3), (frontL, topYLine),
                (frontR, topYLine), (frontR, baseYLine + 3)],
               core_w=1.9, glow_w=5.4, glow_alpha=0.62)

    # (C) Subtle outer U (hitbox guide)
    outerLeft  = int(round(outerL) + 0.5)
    outerRight = int(round(outerR) - 0.5)
    _neon_line(s, PALETTE["obstacleOutline"],
               [(outerLeft,  baseYLine + 3), (outerLeft,  topYLine),
                (outerRight, topYLine),      (outerRight, baseYLine + 3)],
               core_w=1.6, glow_w=4.5, glow_alpha=0.38)

    # (D) Deck stitch + hotspot at attach side
    legX = outerRight if dir == 1 else outerLeft
    _neon_line(s, PALETTE["obstacleOutline"],
               [(int(legX), int(bodyY + bodyH - 0.25)), (int(legX), int(contactY + 4.0))],
               core_w=1.8, glow_w=5.2, glow_alpha=0.60)

    # stitch line + hotspot (additive-ish look)
    pygame.draw.line(s, _col(PALETTE["obstacleOutline"]) + (230,),
                     (int(legX - 3), int(contactY + 1)), (int(legX + 3), int(contactY + 1)), 1)
    for rr, a in [(6, 140), (4, 100), (2, 70)]:
        pygame.draw.circle(s, (160, 220, 255, a), (int(legX), int(contactY + 1)), rr)

    # restore clip
    s.set_clip(prev_clip)


def _drawWaterTank(s, o):
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    deckY = y + h

    # --- helpers -------------------------------------------------------------
    def _ellipse_points(cx, cy, rx, ry, a0, a1, steps):
        pts = []
        for i in range(steps + 1):
            t = i / steps
            a = a0 + (a1 - a0) * t
            pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
        return pts

    def _mask_poly_blit(grad_surf, poly_points):
        xs = [p[0] for p in poly_points]; ys = [p[1] for p in poly_points]
        minx, maxx = int(math.floor(min(xs))), int(math.ceil(max(xs)))
        miny, maxy = int(math.floor(min(ys))), int(math.ceil(max(ys)))
        bw, bh = max(1, maxx - minx), max(1, maxy - miny)

        mask = pygame.Surface((bw, bh), pygame.SRCALPHA)
        loc = [(int(px - minx), int(py - miny)) for (px, py) in poly_points]
        pygame.draw.polygon(mask, (255, 255, 255, 255), loc)

        if grad_surf.get_width() == bw and grad_surf.get_height() == bh:
            g = grad_surf
        else:
            g = pygame.transform.smoothscale(grad_surf, (bw, bh))

        out = g.copy()
        out.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        s.blit(out, (minx, miny))

    # ========================================================================
    # =============== POLY ROUND (vertical domed tank) =======================
    # ========================================================================
    if o.get("variant") == "poly_round":
        padX  = 6
        tankW = max(42, int(w - padX * 2))
        tankH = max(36, int(h - 2))
        left  = x + (w - tankW) / 2
        right = left + tankW
        topY  = deckY - tankH
        cx    = (left + right) / 2
        domeH = max(10, int(tankH * 0.28))

        # silhouette (base → sides → TOP dome; anticlockwise like Canvas)
        poly = []
        poly.append((left,  deckY))
        poly.append((right, deckY))
        poly.append((right, topY + domeH))
        poly += _ellipse_points(cx, topY + domeH, tankW / 2, domeH, 0.0, -math.pi, 32)
        poly.append((left, deckY))

        # Fill (vertical 3-stop)
        gh = int(tankH); midp = int(0.55 * gh)
        gTop = get_linear_gradient(int(tankW), max(1, midp),
                                   shade(PALETTE["obstacleFill"], -18),
                                   shade(PALETTE["obstacleFill"],  +8), horizontal=False)
        gBot = get_linear_gradient(int(tankW), max(1, gh - midp),
                                   shade(PALETTE["obstacleFill"],  +8),
                                   shade(PALETTE["obstacleFill"], -22), horizontal=False)
        bodyG = pygame.Surface((int(tankW), gh), pygame.SRCALPHA)
        bodyG.blit(gTop, (0, 0)); bodyG.blit(gBot, (0, midp))
        _mask_poly_blit(bodyG, poly)

        # Ribs
        gap = max(8, int(tankH * 0.16))
        start = topY + domeH + gap * 0.7
        ribCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.35 * 255),)
        for yy in range(int(start), int(deckY - 6) + 1, gap):
            shrink = max(0, (topY + domeH + gap - yy) * 0.10)
            pygame.draw.line(s, ribCol, (int(left + 4 + shrink), yy),
                             (int(right - 4 - shrink), yy), 2)

        # Central roof ridge
        ridgeW = max(6, int(tankW * 0.08))
        ridgeH = max(6, int(domeH * 0.55))
        roundRect(s, int(cx - ridgeW / 2), int((topY + domeH) - ridgeH),
                  int(ridgeW), int(ridgeH), min(3, ridgeW // 2), True,
                  fill=shade(PALETTE["obstacleFill"], -14))
        pygame.draw.line(
            s, _col(shade(PALETTE["obstacleFill"], +24)) + (int(0.35 * 255),),
            (int(cx - ridgeW * 0.35), int((topY + domeH) - ridgeH * 0.65)),
            (int(cx + ridgeW * 0.35), int((topY + domeH) - ridgeH * 0.65)), 1
        )

        # Base pad
        roundRect(s, int(left + 8), int(deckY - 4),
                  int(tankW - 16), 4, 2, True, fill=shade(PALETTE["obstacleOutline"], -42))

        # Soft vertical highlight (goes BEHIND hatch → draw first)
        hiW = max(10, int(tankW * 0.22))
        hiX = int(left + tankW * 0.30)
        roundRect(s, hiX, int(topY + domeH + 6),
                  hiW, int(tankH - domeH - 12), 6, True,
                  fill=(207, 230, 255, int(0.10 * 255)))

        # ------------------ FRONT HATCH / DOOR (more detail) ------------------
        cylH = tankH - domeH
        dh = max(24, min(int(cylH * 0.55), int(tankH * 0.62)))
        dw = max(16, min(int(tankW * 0.28), int(tankW * 0.36)))
        dx = int(cx - dw / 2)
        dy = int(topY + domeH + (cylH - dh) * 0.42)  # slightly lower than true center

        # jamb/frame
        pygame.draw.rect(
            s, _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.35 * 255),),
            pygame.Rect(dx - 2, dy - 2, dw + 4, dh + 4), 2
        )

        # leaf (rounded + gradient)
        doorGrad = get_linear_gradient(dw, dh,
                                       shade(PALETTE["obstacleFill"], -8),
                                       shade(PALETTE["obstacleFill"], -26),
                                       horizontal=False)
        doorMask = pygame.Surface((dw, dh), pygame.SRCALPHA)
        roundRect(doorMask, 0, 0, dw, dh, 4, True, fill=(255, 255, 255, 255))
        doorSurf = doorGrad.copy(); doorSurf.blit(doorMask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        s.blit(doorSurf, (dx, dy))

        # small circular viewport near top
        pox = int(cx); poy = int(dy + dh * 0.18)
        pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], -30)) + (240,), (pox, poy), 3)
        pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], +24)) + (110,), (pox, poy), 4, width=1)

        # hinges (right)
        hingeCol = _col(shade(PALETTE["obstacleOutline"], -8)) + (int(0.7 * 255),)
        hy1 = dy + int(dh * 0.28); hy2 = dy + int(dh * 0.66)
        pygame.draw.rect(s, hingeCol, pygame.Rect(dx + dw + 1, hy1, 3, 6))
        pygame.draw.rect(s, hingeCol, pygame.Rect(dx + dw + 1, hy2, 3, 6))

        # lever handle
        hx = dx + dw - 8; hy = dy + int(dh * 0.52)
        pygame.draw.line(s, _col(shade(PALETTE["obstacleOutline"], -6)) + (int(0.9 * 255),),
                         (int(hx - 6), int(hy)), (int(hx + 2), int(hy)), 2)

        # door louvers (thin horizontals)
        lvX = dx + 5; lvY = dy + 9; lvW = dw - 10; rows = 5
        louCol = _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.32 * 255),)
        for i in range(rows):
            yy = lvY + i * 5
            pygame.draw.line(s, louCol, (int(lvX), int(yy)), (int(lvX + lvW), int(yy)), 1)

        # tiny screws at frame corners
        scr = _col(shade(PALETTE["obstacleOutline"], -14)) + (180,)
        for (sx, sy) in [(dx + 3, dy + 3), (dx + dw - 5, dy + 3),
                         (dx + 3, dy + dh - 5), (dx + dw - 5, dy + dh - 5)]:
            pygame.draw.rect(s, scr, pygame.Rect(sx, sy, 2, 2))

        # ---------------------------------------------------------------------

        # Neon along tank silhouette
        _neon_line(s, PALETTE["obstacleOutline"],
                   [(int(px), int(py)) for (px, py) in poly + [poly[0]]],
                   core_w=2.0, glow_w=6.0, glow_alpha=0.55)
        return

    # ========================================================================
    # =============== DRUM ON SADDLES (unchanged) =============================
    # ========================================================================
    sidePad = 6
    standH  = max(10, int(h * 0.30))
    bodyW   = max(52, int(w - sidePad * 2))
    dia     = max(26, min(int(h - standH - 3), int(w * 0.56)))
    r       = dia // 2

    bodyX = x + (w - bodyW) / 2
    bodyY = deckY - standH - dia

    saddleXs = ([bodyX + bodyW * 0.20, bodyX + bodyW * 0.50, bodyX + bodyW * 0.80]
                if bodyW >= 110 else
                [bodyX + bodyW * 0.30, bodyX + bodyW * 0.70])

    # pads
    for sx in saddleXs:
        roundRect(s, int(sx - max(16, int(w * 0.18)) / 2), int(deckY - 4),
                  max(16, int(w * 0.18)), 4, 2, True, fill=shade(PALETTE["obstacleOutline"], -42))

    legW   = max(6, int(r * 0.60)); wallW = max(3, int(legW * 0.28))
    strapH = max(4, int(r * 0.35)); seatY  = bodyY + dia - strapH - 1
    for sx in saddleXs:
        colLeg = shade(PALETTE["obstacleOutline"], -34)
        # side walls + cap
        roundRect(s, int(sx - legW/2),         int(deckY - standH), wallW, standH, 2, True, fill=colLeg)
        roundRect(s, int(sx + legW/2 - wallW), int(deckY - standH), wallW, standH, 2, True, fill=colLeg)
        roundRect(s, int(sx - legW/2 + wallW),
                  int(deckY - max(6, int(standH*0.24))),
                  int(legW - wallW*2), max(3, int(standH*0.16)), 2, True, fill=colLeg)
        # cutout
        holeTop = deckY - int(standH*0.55)
        tri = [(sx - legW*0.26, deckY - int(standH*0.28)),
               (sx,              holeTop),
               (sx + legW*0.26, deckY - int(standH*0.28))]
        pygame.draw.polygon(s, _col(shade(PALETTE["obstacleOutline"], -46)) + (int(0.55*255),),
                            [(int(a), int(b)) for a,b in tri])
        # strap
        roundRect(s, int(sx - int(legW*0.75)/2), int(seatY),
                  int(int(legW*0.75)), int(strapH), int(max(2, strapH//2)), True,
                  fill=shade(PALETTE["obstacleOutline"], -30))

    # drum body + mask
    half = int(bodyW * 0.5)
    gL = get_linear_gradient(half + 1, dia, shade(PALETTE["obstacleFill"], -16),
                             shade(PALETTE["obstacleFill"], +8), horizontal=True)
    gR = get_linear_gradient(int(bodyW - half), dia, shade(PALETTE["obstacleFill"], +8),
                             shade(PALETTE["obstacleFill"], -20), horizontal=True)
    body = pygame.Surface((int(bodyW), int(dia)), pygame.SRCALPHA)
    body.blit(gL, (0, 0)); body.blit(gR, (half, 0))
    mask = pygame.Surface((int(bodyW), int(dia)), pygame.SRCALPHA)
    roundRect(mask, 0, 0, int(bodyW), int(dia), int(r), True, fill=(255,255,255,255))
    body.blit(mask, (0,0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(body, (int(bodyX), int(bodyY)))

    # bands
    ringCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.30 * 255),)
    ringStep = max(18, int(r * 1.1))
    xi = bodyX + r + ringStep
    while xi <= bodyX + bodyW - r - 6:
        pygame.draw.line(s, ringCol, (int(xi), int(bodyY + 3)), (int(xi), int(bodyY + dia - 3)), 2)
        xi += ringStep

    # highlight band
    roundRect(s, int(bodyX + bodyW * 0.25), int(bodyY + 6),
              max(10, int(bodyW * 0.30)), int(dia - 12), 6, True,
              fill=(207, 230, 255, int(0.10 * 255)))

    # manway
    manX = bodyX + bodyW * 0.56
    manW = max(10, int((dia/2) * 0.9))
    manH = max(6,  int((dia/2) * 0.55))
    riserH = max(4, int((dia/2) * 0.40))
    roundRect(s, int(manX - manW * 0.14), int(bodyY - riserH + 1),
              int(manW * 0.28), int(riserH), 2, True, fill=shade(PALETTE["obstacleFill"], -14))
    gLid = get_linear_gradient(manW, manH, shade(PALETTE["obstacleFill"], 8),
                               shade(PALETTE["obstacleFill"], -12), horizontal=False)
    lidMask = pygame.Surface((manW, manH), pygame.SRCALPHA)
    roundRect(lidMask, 0, 0, manW, manH, min(6, manH // 2), True, fill=(255,255,255,255))
    lidSurf = gLid.copy(); lidSurf.blit(lidMask, (0,0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(lidSurf, (int(manX - manW / 2), int(bodyY - riserH - manH)))

    # ladder + feet
    railGap = max(6, int((dia/2) * 0.32))
    margin  = max(2, int((dia/2) * 0.10))
    railL = int(bodyX + margin + 1 + 4); railR = int(railL + railGap)
    top = int(bodyY + max(4, int((dia/2) * 0.10))); bot = int(deckY - 3)
    railCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.70 * 255),)
    pygame.draw.line(s, railCol, (railL, top), (railL, bot), 1)
    pygame.draw.line(s, railCol, (railR, top), (railR, bot), 1)
    for yy in range(top + 5, bot - 5, 6):
        pygame.draw.line(s, railCol, (railL + 1, yy), (railR - 1, yy), 1)
    footCol = shade(PALETTE["obstacleOutline"], -42)
    roundRect(s, railL - 3, int(deckY - 4), 6, 4, 2, True, fill=footCol)
    roundRect(s, railR - 3, int(deckY - 4), 6, 4, 2, True, fill=footCol)

    # neon outline
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       int(bodyX), int(bodyY), int(bodyW), int(dia), int(r),
                       core_w=2.0, glow_w=6.0, glow_alpha=0.55)


def _drawBillboard(s, o, t=0.0):
    """
    Python port of drawBillboard(ctx, o, t) from the JS version.
    Variants supported: "classic", "slats", "led", "wood".
    """
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    contactY = y + h

    # -------------------- GEOMETRY --------------------
    faceR  = 4
    legW   = max(4, int(w * 0.035))
    legH   = max(10, int(h * 0.22))
    faceH  = h - legH - 6
    faceY  = y
    faceW  = w
    faceX  = x

    # legs (left/right positions) and top of legs
    legLX  = int(round(x + max(8, w * 0.08)))
    legRX  = int(round(x + w - max(8, w * 0.08) - legW))
    legTop = y + faceH + 2

    # -------------------- BASE / LEGS --------------------
    # pads
    padW = max(18, legW + 12)
    roundRect(s, legLX - 6, int(contactY - 3), padW, 3, 2, True,
              fill=shade(PALETTE["obstacleOutline"], -40))
    roundRect(s, legRX - 6, int(contactY - 3), padW, 3, 2, True,
              fill=shade(PALETTE["obstacleOutline"], -40))

    # legs (vertical metal gradient)
    lg = get_linear_gradient(legW, int(legH),
                             shade(PALETTE["obstacleFill"], -18),
                             shade(PALETTE["obstacleFill"], -30),
                             horizontal=False)
    s.blit(lg, (legLX, int(legTop)))
    s.blit(lg, (legRX, int(legTop)))

    # web (centerline) faint
    webCol = _col(shade(PALETTE["obstacleOutline"], -16)) + (int(0.45 * 255),)
    webX1 = legLX + legW // 2
    webX2 = legRX + legW // 2
    pygame.draw.line(s, webCol, (webX1, int(legTop + 1)), (webX1, int(contactY - 4)), 1)
    pygame.draw.line(s, webCol, (webX2, int(legTop + 1)), (webX2, int(contactY - 4)), 1)

    # cross bracing
    braceCol = _col(shade(PALETTE["obstacleOutline"], -12)) + (int(0.55 * 255),)
    pygame.draw.line(s, braceCol, (webX1, int(contactY - 3)), (webX2, int(legTop + 2)), 2)
    pygame.draw.line(s, braceCol, (webX2, int(contactY - 3)), (webX1, int(legTop + 2)), 2)

    # -------------------- CATWALK + RAIL --------------------
    walkY = y + faceH + 0.5
    walkH = 6
    railH = 8

    gWalk = get_linear_gradient(int(w - 8), int(walkH),
                                shade(PALETTE["obstacleFill"],  6),
                                shade(PALETTE["obstacleFill"], -14),
                                horizontal=False)
    # catwalk deck
    surfWalk = pygame.Surface((int(w - 8), int(walkH)), pygame.SRCALPHA)
    surfWalk.blit(gWalk, (0, 0))
    s.blit(surfWalk, (int(x + 4), int(walkY)))

    # grating
    grateCol = _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.25 * 255),)
    for gx in range(int(x + 8), int(x + w - 8), 6):
        pygame.draw.line(s, grateCol, (gx, int(walkY + 1)), (gx, int(walkY + walkH - 1)), 1)

    # uprights + top rail
    railCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.60 * 255),)
    for rx in range(int(x + 10), int(x + w - 10) + 1, 14):
        pygame.draw.line(s, railCol, (rx, int(walkY)), (rx, int(walkY - railH)), 2)
    pygame.draw.line(s, railCol, (int(x + 8), int(walkY - railH)),
                     (int(x + w - 8), int(walkY - railH)), 2)

    # -------------------- FACE / FRAME --------------------
    frameInset  = 2
    faceInnerX  = int(faceX + frameInset)
    faceInnerY  = int(faceY + frameInset)
    faceInnerW  = int(faceW - frameInset * 2)
    faceInnerH  = int(faceH - frameInset * 2)

    # outer frame
    gFrame = get_linear_gradient(int(faceW), int(faceH),
                                 shade(PALETTE["obstacleFill"], -8),
                                 shade(PALETTE["obstacleFill"], -22),
                                 horizontal=False)
    # mask frame to rounded rect
    frameSurf = gFrame.copy()
    mask = pygame.Surface((int(faceW), int(faceH)), pygame.SRCALPHA)
    roundRect(mask, 0, 0, int(faceW), int(faceH), faceR, True, fill=(255, 255, 255, 255))
    frameSurf.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    s.blit(frameSurf, (int(faceX), int(faceY)))

    # choose/remember variant (weighted)
    if "variant" in o and o["variant"]:
        variant = o["variant"]
    else:
        spec = [("classic", 5), ("slats", 4), ("led", 3), ("wood", 3)]
        total = sum(wt for _, wt in spec)
        seed = int(o.get("seed", int(x * 31 + y * 17 + w * 13 + h * 7)))
        rnd = random.Random(seed).uniform(0, total)
        acc = 0.0; variant = "classic"
        for name, wt in spec:
            acc += wt
            if rnd <= acc:
                variant = name; break
        o["variant"] = variant  # persist like the JS does

    # panel surface we can clip to rounded inner rect
    panel = pygame.Surface((faceInnerW, faceInnerH), pygame.SRCALPHA)

    def _apply_inner_round_mask(surf):
        m = pygame.Surface((faceInnerW, faceInnerH), pygame.SRCALPHA)
        rr = max(2, faceR - 1)
        roundRect(m, 0, 0, faceInnerW, faceInnerH, rr, True, fill=(255, 255, 255, 255))
        out = surf.copy()
        out.blit(m, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        s.blit(out, (faceInnerX, faceInnerY))

    # -------- variant content --------
    if variant == "slats":
        # background
        bg = get_linear_gradient(faceInnerW, faceInnerH, "#0f1a32", "#0b1224", horizontal=False)
        panel.blit(bg, (0, 0))

        slatW = max(8, faceInnerW // 10)
        for sx in range(4, faceInnerW - 4, slatW):
            g = get_linear_gradient(slatW - 3, faceInnerH - 6,
                                    shade(PALETTE["obstacleFill"], -26),
                                    shade(PALETTE["obstacleFill"], -24),
                                    horizontal=True)
            # fake bright middle line: overlay a narrow bright strip
            mid = get_linear_gradient(slatW - 3, faceInnerH - 6,
                                      shade(PALETTE["obstacleFill"], +4),
                                      shade(PALETTE["obstacleFill"], +6),
                                      horizontal=True)
            rrSurf = pygame.Surface((slatW - 3, faceInnerH - 6), pygame.SRCALPHA)
            rrSurf.blit(g, (0, 0))
            rrSurf.blit(mid, (0, 0), special_flags=pygame.BLEND_RGBA_ADD)
            # mask to small rounded slat
            m = pygame.Surface((slatW - 3, faceInnerH - 6), pygame.SRCALPHA)
            roundRect(m, 0, 0, slatW - 3, faceInnerH - 6, 2, True, fill=(255, 255, 255, 255))
            rrSurf.blit(m, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
            panel.blit(rrSurf, (sx + 1, 3))

            # side bevels
            bevelCol = _col(shade(PALETTE["obstacleOutline"], -14)) + (int(0.35 * 255),)
            pygame.draw.line(panel, bevelCol, (sx + 2, 4), (sx + 2, faceInnerH - 4), 1)
            pygame.draw.line(panel, bevelCol, (sx + slatW - 3, 4), (sx + slatW - 3, faceInnerH - 4), 1)

        _apply_inner_round_mask(panel)

    elif variant == "led":
        panel.fill(_col("#0b1326"))
        # pixel grid
        step, rad = 6, 1
        for yy in range(3, faceInnerH - 2, step):
            for xx in range(3, faceInnerW - 2, step):
                flick = 0.75 + 0.25 * math.sin((t or 0) * 3.0 + xx * 0.04 + yy * 0.03)
                a = int(255 * 0.08 * flick)
                pygame.draw.circle(panel, (160, 210, 255, a), (xx, yy), rad)
        # scanline
        if faceInnerH > 2:
            scan = int((t * 120.0) % (faceInnerH - 2))
            pygame.draw.rect(panel, (90, 176, 255, int(0.20 * 255)),
                             pygame.Rect(2, 1 + scan, faceInnerW - 4, 3))
        # inner bezel
        bezelCol = _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.35 * 255),)
        rr = max(1, faceR - 2)
        _apply_inner_round_mask(panel)
        pygame.draw.rect(s, bezelCol,
                         pygame.Rect(faceInnerX + 1, faceInnerY + 1, faceInnerW - 2, faceInnerH - 2),
                         width=1, border_radius=rr)

    elif variant == "wood":
        plankH = max(10, faceInnerH // 6)
        rng = random.Random(int(o.get("seed", 0)) ^ 0xA5A5)
        for py in range(0, faceInnerH, plankH):
            g = get_linear_gradient(faceInnerW, plankH,
                                    shade(PALETTE["obstacleFill"], -14),
                                    shade(PALETTE["obstacleFill"], -24),
                                    horizontal=False)
            panel.blit(g, (0, py))
            # grain & nails
            grainCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.25 * 255),)
            pygame.draw.line(panel, grainCol, (8, int(py + plankH * 0.4)),
                             (faceInnerW - 8, int(py + plankH * 0.6)), 1)
            nailCol = _col(shade(PALETTE["obstacleOutline"], -16)) + (int(0.6 * 255),)
            for bx in range(10, faceInnerW - 8, 38):
                panel.fill(nailCol, pygame.Rect(bx, py + 3, 1, 1))
                panel.fill(nailCol, pygame.Rect(bx + 14, py + plankH - 5, 1, 1))
        # occasional missing plank
        if rng.random() < 0.25 and plankH > 4:
            row = int((faceInnerH / plankH) * 0.5) * plankH
            panel.fill((0, 0, 0, 0), pygame.Rect(12, row + 2, faceInnerW - 24, plankH - 4))

        _apply_inner_round_mask(panel)

        # inner vignette
        vg = pygame.Surface((faceInnerW, faceInnerH), pygame.SRCALPHA)
        # simple radial-ish vignette by alpha rectangle; keep cheap:
        pygame.draw.rect(vg, (0, 0, 0, int(0.22 * 255)),
                         pygame.Rect(0, 0, faceInnerW, faceInnerH), width=0, border_radius=max(2, faceR-1))
        vg.set_alpha(int(0.22 * 255))
        s.blit(vg, (faceInnerX, faceInnerY), special_flags=pygame.BLEND_RGBA_MULT)

    else:
        # classic
        gFace = get_linear_gradient(faceInnerW, faceInnerH, "#16243f", "#0b1326", horizontal=False)
        # add mid stop
        mid = get_linear_gradient(faceInnerW, faceInnerH, "#16243f", "#0f1a33", horizontal=False)
        panel.blit(gFace, (0, 0))
        panel.blit(mid, (0, 0), special_flags=pygame.BLEND_RGBA_ADD)

        # bolts around
        boltPad = 6; boltStep = max(18, int(faceW / 6))
        boltCol = _col(shade(PALETTE["obstacleOutline"], -14)) + (int(0.5 * 255),)
        for bx in range(int(faceX + boltPad), int(faceX + faceW - boltPad) + 1, boltStep):
            panel.fill(boltCol, pygame.Rect(bx - faceInnerX - 1, 2, 2, 2))
            panel.fill(boltCol, pygame.Rect(bx - faceInnerX - 1, faceInnerH - 4, 2, 2))
        for by in range(boltPad, faceInnerH - boltPad + 1, 16):
            panel.fill(boltCol, pygame.Rect(2, by - 1, 2, 2))
            panel.fill(boltCol, pygame.Rect(faceInnerW - 4, by - 1, 2, 2))

        # faint vertical ribs
        ribCol = (37, 58, 102, int(0.18 * 255))
        for sx in range(12, faceInnerW - 12, 16):
            pygame.draw.line(panel, ribCol, (sx, 6), (sx, faceInnerH - 6), 1)

        _apply_inner_round_mask(panel)

        # subtle X
        crossCol = (42, 58, 96, int(0.14 * 255))
        pygame.draw.line(s, crossCol,
                         (faceInnerX + 6, faceInnerY + 6),
                         (faceInnerX + faceInnerW - 6, faceInnerY + faceInnerH - 6), 1)
        pygame.draw.line(s, crossCol,
                         (faceInnerX + faceInnerW - 6, faceInnerY + 6),
                         (faceInnerX + 6, faceInnerY + faceInnerH - 6), 1)

        # scanline
        if faceInnerH > 2:
            scan = int((t * 120.0) % (faceInnerH - 2))
            pygame.draw.rect(s, (90, 176, 255, int(0.18 * 255)),
                             pygame.Rect(faceInnerX + 2, faceInnerY + 1 + scan, faceInnerW - 4, 3))

    # -------------------- TOP LAMPS --------------------
    lampCount = max(2, int(w // 60))
    for i in range(lampCount):
        u = (i + 0.5) / lampCount
        lx = int(faceX + 10 + u * (faceW - 20))
        ly = int(faceY - 4)
        # lamp head
        pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], -8)) + (255,), (lx, ly), 2)
        # stalk
        pygame.draw.line(s, _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.6 * 255),),
                         (lx, ly), (lx, ly + 6), 2)
        # simple light cone/glow
        flick = 0.7 + 0.3 * math.sin((t or 0) * 6.0 + i * 1.7)
        a = int(255 * 0.20 * flick)
        cone = pygame.Surface((64, 40), pygame.SRCALPHA)
        pygame.draw.polygon(cone, (160, 210, 255, a),
                            [(8, 6), (56, 6), (64, 38), (0, 38)])
        s.blit(cone, (lx - 32, ly + 2), special_flags=pygame.BLEND_ADD)

    # -------------------- NEON / READABILITY --------------------
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       int(faceX), int(faceY), int(faceW), int(faceH), faceR,
                       core_w=2, glow_w=6, glow_alpha=0.55)

    postLX = int(round(legLX) + 0.5)
    postRX = int(round(legRX + legW) - 0.5)
    _neon_line(s, PALETTE["obstacleOutline"],
               [(postLX, int(legTop)), (postLX, int(contactY + 2.5))],
               core_w=1.4, glow_w=4, glow_alpha=0.45)
    _neon_line(s, PALETTE["obstacleOutline"],
               [(postRX, int(legTop)), (postRX, int(contactY + 2.5))],
               core_w=1.4, glow_w=4, glow_alpha=0.45)

    # tiny deck hotspots at post bases
    hotCol = _col(PALETTE["obstacleOutline"]) + (int(0.9 * 255),)
    pygame.draw.line(s, hotCol, (postLX - 3, int(contactY + 0.5)), (postLX + 3, int(contactY + 0.5)), 1)
    pygame.draw.line(s, hotCol, (postRX - 3, int(contactY + 0.5)), (postRX + 3, int(contactY + 0.5)), 1)


def _drawWaterTowerGate(s, o, P=PALETTE):
    """
    Python port of drawWaterTowerGate(ctx, o, P).
    Expects helpers: roundRect, get_linear_gradient, shade, _col,
                     _neon_line, _neon_rounded_rect.
    """

    # ----- inputs & derived geometry -----
    x, y, w, h = float(o["x"]), float(o["y"]), float(o["w"]), float(o["h"])
    baseY   = float(o.get("baseY", y + h))       # deck line
    beamY   = y                                  # duck bar top-left Y
    beamH   = float(o.get("h", h))               # duck bar height

    inset = max(10, w * 0.18)
    legW  = max(4, min(7, int(w * 0.08)))
    xL    = int(x + inset)
    xR    = int(x + w - inset - legW)

    clearance = float(o.get("clearance", 24))
    stem      = float(o.get("stem", 18))
    legH      = int(clearance + beamH + stem)    # ground → platform underside
    platformY = int(baseY - legH)                # top of legs / under tank
    tankPad   = 6

    tx     = int(x + 8)                          # tank box
    tw     = int(w - 16)
    tankH  = int(o.get("tankH", 38))
    tankY  = int(platformY - tankPad - tankH)

    # 0) soft contact shadow
    shW = int(w); shH = 14
    if shW > 0 and shH > 0:
        g = get_linear_gradient(shW, shH, (0, 0, 0, 0), (0, 0, 0, int(0.25 * 255)), horizontal=False)
        s.blit(g, (int(x), int(baseY - 8)))

    # 1) feet: tar pads + base plates + bolts
    footH = 3
    padW  = max(18, legW + 12)
    roundRect(s, xL - 6, int(baseY - footH), padW, footH, 2, True,
              fill=shade(PALETTE["obstacleOutline"], -40))
    roundRect(s, xR - 6, int(baseY - footH), padW, footH, 2, True,
              fill=shade(PALETTE["obstacleOutline"], -40))

    plateCol = shade(PALETTE["obstacleFill"], -20)
    roundRect(s, xL - 2, int(baseY - (footH + 2)), legW + 4, 3, 2, True, fill=plateCol)
    roundRect(s, xR - 2, int(baseY - (footH + 2)), legW + 4, 3, 2, True, fill=plateCol)

    boltCol = _col(shade(PALETTE["obstacleOutline"], -12)) + (int(0.6 * 255),)
    s.fill(boltCol, pygame.Rect(xL - 1, int(baseY - (footH + 1)), 2, 2))
    s.fill(boltCol, pygame.Rect(xL + legW - 1, int(baseY - (footH + 1)), 2, 2))
    s.fill(boltCol, pygame.Rect(xR - 1, int(baseY - (footH + 1)), 2, 2))
    s.fill(boltCol, pygame.Rect(xR + legW - 1, int(baseY - (footH + 1)), 2, 2))

    # 2) legs (vertical metal gradient) + webs + bracing
    gLeg = get_linear_gradient(legW, legH,
                               shade(PALETTE["obstacleFill"], -16),
                               shade(PALETTE["obstacleFill"], -28),
                               horizontal=False)
    s.blit(gLeg, (xL, int(baseY - legH)))
    s.blit(gLeg, (xR, int(baseY - legH)))

    webCol = _col(shade(PALETTE["obstacleOutline"], -14)) + (int(0.45 * 255),)
    webL = xL + legW // 2
    webR = xR + legW // 2
    pygame.draw.line(s, webCol, (webL, int(baseY - legH + 2)), (webL, int(baseY - 2)), 1)
    pygame.draw.line(s, webCol, (webR, int(baseY - legH + 2)), (webR, int(baseY - 2)), 1)

    braceCol = _col(shade(PALETTE["obstacleOutline"], -22)) + (int(0.55 * 255),)
    pygame.draw.line(s, braceCol, (webL, int(baseY - legH)), (webR, int(baseY)), 2)
    pygame.draw.line(s, braceCol, (webR, int(baseY - legH)), (webL, int(baseY)), 2)

    # small beam across under platform
    roundRect(s, xL + legW, platformY - 4, (xR - xL - legW), 3, 2, True,
              fill=shade(PALETTE["obstacleFill"], -22))

    # gussets
    gusCol = shade(PALETTE["obstacleFill"], -24)
    ptsL = [(xL + legW, platformY), (xL + legW + 10, platformY), (xL + legW, platformY + 10)]
    ptsR = [(xR, platformY), (xR - 10, platformY), (xR, platformY + 10)]
    pygame.draw.polygon(s, _col(gusCol) + (int(0.7 * 255),), ptsL)
    pygame.draw.polygon(s, _col(gusCol) + (int(0.7 * 255),), ptsR)

    # 3) platform slab / planks
    slabX = int(x + 6)
    slabW = int(w - 12)
    gSlab = get_linear_gradient(slabW, tankPad,
                                shade(PALETTE["obstacleFill"], 8),
                                shade(PALETTE["obstacleFill"], -14),
                                horizontal=False)
    s.blit(gSlab, (slabX, platformY - tankPad))
    plankCol = _col(shade(PALETTE["obstacleOutline"], -18)) + (int(0.22 * 255),)
    for px in range(slabX + 6, slabX + slabW - 6, 6):
        pygame.draw.line(s, plankCol, (px, platformY - tankPad + 1), (px, platformY - 1), 1)

    # 4) tank box with vertical slats + hoops + vent
    roundRect(s, tx, tankY, tw, tankH, 6, True, fill=shade(PALETTE["obstacleFill"], -4))

    slatCol = _col(shade(PALETTE["obstacleOutline"], -28)) + (int(0.22 * 255),)
    for xx in range(tx + 4, tx + tw - 4, 5):
        pygame.draw.line(s, slatCol, (xx, tankY + 4), (xx, tankY + tankH - 4), 1)

    hoopCol = _col(shade(PALETTE["obstacleOutline"], -10)) + (int(0.45 * 255),)
    bandTop = tankY + 10
    bandMid = tankY + max(16, int(tankH * 0.52))
    bandBot = tankY + tankH - 12
    for yy in (bandTop, bandMid, bandBot):
        pygame.draw.line(s, hoopCol, (tx + 6, yy), (tx + tw - 6, yy), 2)

    # top vent (ellipse cap + little triangle)
    pygame.draw.ellipse(s, _col(shade(PALETTE["obstacleFill"], -12)) + (255,),
                        pygame.Rect(tx, tankY - 6, tw, 12))
    vent = [(tx + tw * 0.5 - tw * 0.15, tankY - 6),
            (tx + tw * 0.5,            tankY - 12),
            (tx + tw * 0.5 + tw * 0.15, tankY - 6)]
    pygame.draw.polygon(s, _col(shade(PALETTE["obstacleFill"], -26)) + (255,), vent)
    pygame.draw.line(s, (190, 210, 255, int(0.55 * 255)),
                     (int(tx + tw * 0.35), int(tankY - 8)),
                     (int(tx + tw * 0.65), int(tankY - 8)), 1)

    # 5) ladder on right leg
    lx = int(xR + max(4, legW - 2))
    railCol = _col(shade(PALETTE["obstacleOutline"], -12)) + (int(0.6 * 255),)
    pygame.draw.line(s, railCol, (lx - 2, tankY + 6), (lx - 2, platformY - 2), 1)
    pygame.draw.line(s, railCol, (lx + 2, tankY + 6), (lx + 2, platformY - 2), 1)
    for yy in range(tankY + 10, platformY - 2, 5):
        pygame.draw.line(s, railCol, (lx - 3, yy), (lx + 3, yy), 1)

    # 6) low “duck” bar + ticks + neon
    innerL = xL + legW + 2
    innerR = xR - 2
    barW   = max(20, int(innerR - innerL))
    barX   = int(innerL)
    gBar = get_linear_gradient(barW, int(beamH),
                               shade(PALETTE["obstacleFill"], -8),
                               shade(PALETTE["obstacleFill"], -18),
                               horizontal=True)
    s.blit(gBar, (barX, int(beamY)))
    # hazard ticks
    tickCol = _col(shade(PALETTE["obstacleOutline"], -8)) + (int(0.18 * 255),)
    for sx in range(barX + 4, barX + barW - 4, 6):
        pygame.draw.line(s, tickCol, (sx, int(beamY + 2)), (sx, int(beamY + beamH - 2)), 1)
    # neon around bar
    _neon_rounded_rect(s, PALETTE["obstacleOutline"], barX, int(beamY), barW, int(beamH), 3,
                       core_w=1.6, glow_w=4, glow_alpha=0.55)

    # 7) tower silhouette neon (ONLY above the duck bar)
    prev_clip = s.get_clip()
    s.set_clip(pygame.Rect(int(x - 4), -10000, int(w + 8), int(beamY + 2 + 10000)))

    # left leg
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       xL, int(baseY - legH), legW, legH, 2,
                       core_w=1.6, glow_w=4.5, glow_alpha=0.50)
    # right leg
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       xR, int(baseY - legH), legW, legH, 2,
                       core_w=1.6, glow_w=4.5, glow_alpha=0.50)
    # platform edge
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       slabX, platformY - tankPad, slabW, tankPad, 3,
                       core_w=1.6, glow_w=4.5, glow_alpha=0.50)
    # tank box
    _neon_rounded_rect(s, PALETTE["obstacleOutline"],
                       tx, tankY, tw, tankH, 6,
                       core_w=1.6, glow_w=4.5, glow_alpha=0.50)

    s.set_clip(prev_clip)


def _drawWire(s, o):
    """
    JS -> Python port of drawWire(ctx, o)
    - Three visual pole variants (pipe_arm, cantilever, stub_gantry)
    - Sagging wire with shadow, glow, core, and neon accent
    """

    # -------- helpers --------
    def _colA(c, a=1.0):
        r, g, b = _col(c)
        return (r, g, b, max(0, min(255, int(a * 255))))

    def _quad_points(p0, p1, p2, steps):
        pts = []
        for i in range(steps + 1):
            t = i / steps
            mt = 1 - t
            x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
            y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
            pts.append((x, y))
        return pts

    def _stroke_polyline(surface, color, pts, width):
        if len(pts) >= 2:
            pygame.draw.lines(surface, color, False, [(int(x), int(y)) for x, y in pts], max(1, int(width)))

    # -------- geometry --------
    x1 = float(o["x"])
    x2 = float(o["x"] + o["w"])
    y  = float(o["y"])
    sag = float(o.get("sag", 14))
    deckY = float(o.get("baseY", y + 44))
    cx = (x1 + x2) * 0.5
    cy = y + sag

    # polyline quality (a bit more when span is wide)
    steps = max(16, int(abs(x2 - x1) / 12))

    # -------- pole variant pick (sticky) --------
    if o.get("poleVariant") is None:
        o["poleVariant"] = random.choices(
            ["pipe_arm", "cantilever", "stub_gantry"],
            weights=[4, 3, 3],
            k=1
        )[0]
    poleVariant = o["poleVariant"]

    # -------- pole drawer (drop-leg, non-colliding) --------
    def drawDropPole(px, side, variant):
        padH = 3
        overTop = 14
        topY = y - overTop

        # tar pad
        roundRect(s, px - 10, deckY - padH, 20, padH, 2, True,
                  fill=shade(PALETTE["obstacleOutline"], -40))

        if variant == "pipe_arm":
            poleW = 8
            armW, armH = 18, 4
            armY = topY + 2
            armX = px - armW / 2

            # pole shaft
            gp = get_linear_gradient(int(poleW), int(deckY - topY),
                                     shade(PALETTE["obstacleFill"], -10),
                                     shade(PALETTE["obstacleFill"], -26),
                                     horizontal=False)
            s.blit(gp, (int(px - poleW / 2), int(topY)))

            # bands
            bandCol = _colA(shade(PALETTE["obstacleOutline"], -14), 0.55)
            pygame.draw.line(s, bandCol,
                             (int(px - poleW/2 + 2), int(armY + 6)),
                             (int(px + poleW/2 - 2), int(armY + 6)), 1)
            pygame.draw.line(s, bandCol,
                             (int(px - poleW/2 + 2), int(deckY - 10)),
                             (int(px + poleW/2 - 2), int(deckY - 10)), 1)

            # crossarm
            gArm = get_linear_gradient(int(armW), int(armH),
                                       shade(PALETTE["obstacleFill"], 10),
                                       shade(PALETTE["obstacleFill"], -16),
                                       horizontal=False)
            s.blit(gArm, (int(armX), int(armY)))
            roundRect(s, armX, armY, armW, armH, 2, False)  # shape crispness

            # brace
            pygame.draw.line(s, _colA(shade(PALETTE["obstacleOutline"], -10), 0.7),
                             (int(px), int(armY + armH)),
                             (int(px + side * (armW * 0.35)), int(armY + armH + 6)), 1)

            # insulator puck
            insX = px + side * (armW * 0.38)
            insY = armY + armH / 2
            insG = get_linear_gradient(8, 6,
                                       shade(PALETTE["obstacleFill"], 14),
                                       shade(PALETTE["obstacleFill"], -8),
                                       horizontal=True)
            s.blit(insG, (int(insX - 4), int(insY - 3)))
            pygame.draw.ellipse(s, _colA(shade(PALETTE["obstacleOutline"], -10), 0.85),
                                pygame.Rect(int(insX - 0.6), int(insY - 1.6), 1, 3))

            # jumper to wire
            pts = _quad_points((insX, insY), (insX + side * 10, insY + 8),
                               ((x1 + 1) if side < 0 else (x2 - 1), y + 1), 10)
            _stroke_polyline(s, _colA(PALETTE.get("wireCore", "#8fc2ff"), 0.65), pts, 2)

            # subtle highlight on pole
            roundRect(s, px - poleW/2 + 1, topY + 6,
                      3, max(12, deckY - topY - 12), 2, True, fill=(207, 230, 255, int(0.12 * 255)))

        elif variant == "cantilever":
            poleW = 6
            postH = deckY - topY
            gp = get_linear_gradient(int(poleW), int(postH),
                                     shade(PALETTE["obstacleFill"], -8),
                                     shade(PALETTE["obstacleFill"], -24),
                                     horizontal=False)
            s.blit(gp, (int(px - poleW/2), int(topY)))

            # angled arm
            ax0, ay0 = px, topY + 3
            ax1, ay1 = px + side * 16, ay0 + 6
            pygame.draw.line(s, _colA(shade(PALETTE["obstacleOutline"], -12), 1.0),
                             (int(ax0), int(ay0)), (int(ax1), int(ay1)), 3)

            # small insulator
            pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], -6)),
                               (int(ax1), int(ay1)), 3)

            # jumper
            pts = _quad_points((ax1, ay1), (ax1 + side * 10, ay1 + 8),
                               ((x1 + 1) if side < 0 else (x2 - 1), y + 1), 10)
            _stroke_polyline(s, _colA(PALETTE.get("wireCore", "#8fc2ff"), 0.65), pts, 2)

        else:  # "stub_gantry"
            postW = 7
            postH = max(18, deckY - topY - 4)
            gp = get_linear_gradient(int(postW), int(postH),
                                     shade(PALETTE["obstacleFill"], -8),
                                     shade(PALETTE["obstacleFill"], -24),
                                     horizontal=False)
            s.blit(gp, (int(px - postW/2), int(topY + 4)))

            # U-yoke
            ux = px + side * (postW/2 + 1.5)
            uy = topY + 6
            pygame.draw.lines(s, _col(shade(PALETTE["obstacleOutline"], -12)),
                              False,
                              [(int(ux), int(uy)),
                               (int(ux + side * (16 * 0.6)), int(uy + 8/2)),
                               (int(ux), int(uy + 8))], 2)

            # twin insulators
            for (ix, iy) in [(ux + side * (16 * 0.32), uy + 8 * 0.28),
                             (ux + side * (16 * 0.52), uy + 8 * 0.58)]:
                pygame.draw.circle(s, _col(shade(PALETTE["obstacleFill"], -6)), (int(ix), int(iy)), 3)

            # jumper from outer insulator
            ix, iy = (ux + side * (16 * 0.52), uy + 8 * 0.58)
            pts = _quad_points((ix, iy), (ix + side * 10, iy + 8),
                               ((x1 + 1) if side < 0 else (x2 - 1), y + 1), 10)
            _stroke_polyline(s, _colA(PALETTE.get("wireCore", "#8fc2ff"), 0.65), pts, 2)

    # place drop-legs slightly outside the span
    offset = max(8, min(14, int(o["w"] * 0.035)))
    drawDropPole(x1 - offset, -1, poleVariant)
    drawDropPole(x2 + offset,  1, poleVariant)

    # -------- wire: shadow + glow + core + neon accent --------
    # shadow (very soft, slightly offset)
    shadow_pts = _quad_points((x1, y + 1.5), (cx, cy + 1.5), (x2, y + 1.5), steps)
    _stroke_polyline(s, _colA((0, 0, 0), 0.10), shadow_pts, 5)

    # main curve points
    wire_pts = _quad_points((x1, y), (cx, cy), (x2, y), steps)

    # glow + core in one helper
    _neon_line(s,
               PALETTE.get("wireGlow", "#7ab6ff"),
               wire_pts,
               core_w=2.6,
               glow_w=6,
               glow_alpha=0.35)

    # subtle neon accent (outline color)
    _neon_line(s,
               PALETTE["obstacleOutline"],
               wire_pts,
               core_w=1.6,
               glow_w=4,
               glow_alpha=0.35)
