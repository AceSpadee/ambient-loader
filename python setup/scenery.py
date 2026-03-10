# scenery.py — optimized & 1:1 visuals: cached gradients/panels/windows
import math
import random
import pygame

from utils import pick, shade, roundRect, get_linear_gradient, _parse_color
from palette import PALETTE

_CLOUD_RGB = _parse_color("#e8edff")
_CLOUD_CACHE = {}

__all__ = [
    "makeScenery","makeSkyline","makeCityLayers","makeBuildingObj","decorateTall",
    "makeBottomDetail","makeWindows","makeClouds","makeStars",
    "drawCloud","drawBuilding","drawRoofProp","drawSilhouette",
]

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _canvas_dims(canvas, groundY=None):
    try:
        w = canvas.get_width(); h = canvas.get_height()
        return (int(w), int(h), 1)
    except AttributeError:
        pass
    if isinstance(canvas, dict):
        w = int(canvas.get("width", 1280))
        h = int(canvas.get("height", 720))
        dpr = float(canvas.get("dpr", 1))
        return (int(w/dpr), int(h/dpr), dpr)
    if isinstance(canvas, (int, float)):
        w = int(canvas)
        if groundY is not None:
            est = max(int(groundY / 0.66), int(groundY + 220))
        else:
            est = 640
        return (w, est, 1)
    return (1280, 640, 1)

def __rand01(n):
    """small fast integer hash -> [0,1)"""
    n &= 0xFFFFFFFF
    n ^= (n >> 16)
    n = (n * 0x85ebca6b) & 0xFFFFFFFF
    n ^= (n >> 13)
    n = (n * 0xc2b2ae35) & 0xFFFFFFFF
    n ^= (n >> 16)
    return n / 4294967295.0

def _get_cloud_surface(scale):
    # quantize scale so cache doesn’t explode
    key = round(float(scale) * 10)  # 0.1 steps
    surf = _CLOUD_CACHE.get(key)
    if surf is None:
        s = key / 10.0
        r = int(30 * s + 26 * s)
        surf = pygame.Surface((r*2+10, r*2+10), pygame.SRCALPHA)
        col = _CLOUD_RGB
        cx = r + 5; cy = r + 5
        pygame.draw.circle(surf, col, (int(cx + 0),       int(cy + 0)),    int(30*s))
        pygame.draw.circle(surf, col, (int(cx + 20*s),    int(cy - 6*s)),  int(24*s))
        pygame.draw.circle(surf, col, (int(cx - 22*s),    int(cy - 4*s)),  int(22*s))
        pygame.draw.circle(surf, col, (int(cx + 6*s),     int(cy + 4*s)),  int(26*s))
        surf = surf.convert_alpha()
        _CLOUD_CACHE[key] = surf
    return surf

# ---------------------------------------------------------------------------
# content factories
# ---------------------------------------------------------------------------

def makeScenery(canvas, groundY, reduceMotion):
    return {
        "stars":    makeStars(canvas, reduceMotion),
        "clouds":   makeClouds(canvas, reduceMotion),
        "skyline":  makeSkyline(canvas, groundY),
        **makeCityLayers(canvas, groundY),
    }

def makeSkyline(canvas, groundY=None):
    w, h, dpr = _canvas_dims(canvas, groundY)
    baseY = h - 260
    polys = []
    x = -80.0
    while x < w + 200.0:
        bw = 60.0 + random.random() * 120.0
        bh = 100.0 + random.random() * 220.0
        polys.append({"x": x, "y": baseY - bh, "w": bw, "h": bh, "roof": ("flat" if random.random() < 0.5 else "spike")})
        x += bw + random.random() * 40.0
    return polys

def makeCityLayers(canvas, gy):
    w, h, dpr = _canvas_dims(canvas, gy)
    backTall, frontTall, backSmallBottom, frontSmallBottom = [], [], [], []

    for _ in range(18):
        isFront = (random.random() < 0.4)
        bw = 80 + random.random() * 160
        bh = 220 + random.random() * 240
        x = random.random() * (w + 400) - 200
        yTop = gy - bh
        b = makeBuildingObj(x, yTop, bw, bh, 2, False)
        decorateTall(b, isFront)
        (frontTall if isFront else backTall).append(b)

    bottomPad = 8
    for _ in range(24):
        isFront = (random.random() < 0.5)
        bw = 60 + random.random() * 110
        bh = 80 + random.random() * 140
        x = random.random() * (w + 400) - 200
        yTop = h - bh - bottomPad
        b = makeBuildingObj(x, yTop, bw, bh, 1, True)
        (frontSmallBottom if isFront else backSmallBottom).append(b)

    return { "backTall": backTall, "frontTall": frontTall, "backSmallBottom": backSmallBottom, "frontSmallBottom": frontSmallBottom }

def makeBuildingObj(x, y, w, h, scaleFlag, silhouette=False):
    return {
        "x": x, "y": y, "w": w, "h": h,
        "windows": (None if silhouette else makeWindows(w, h, scaleFlag)),
        "twinkleT": 0.0,
        "twinkleRate": 1.2 + random.random() * 2.0,
        "hasBillboard": (not silhouette and scaleFlag == 1 and random.random() < 0.12),
        "scaleFlag": scaleFlag,
        "silhouette": silhouette,
        "silDetail": (makeBottomDetail(w, h) if silhouette else None),
        "panelStep": 0, "panelAlpha": 0,
        "roof": [],
        "layer": ("bottom" if silhouette else "tall"),
        "baseColor": None,
        "seed": int(random.random() * 0x7fffffff) & 0x7fffffff,
        "_cache": {},
    }

def decorateTall(b, isFront):
    b["panelStep"]  = 16 + math.floor(random.random() * 10)
    b["panelAlpha"] = (0.12 if isFront else 0.08)
    b["baseColor"]  = (pick(PALETTE["frontTallVariants"]) if isFront else pick(PALETTE["backTallVariants"]))
    b["layer"]      = ("frontTall" if isFront else "backTall")

    b["roof"] = []
    if random.random() < 0.40: b["roof"].append({ "kind": "tank", "dx": 8 + random.random() * (b["w"] - 40), "dy": -12 })
    if random.random() < (0.28 if isFront else 0.18): b["roof"].append({ "kind": "dishSmall", "dx": 10 + random.random() * (b["w"] - 20), "dy": 6 })
    if random.random() < 0.25: b["roof"].append({ "kind": "pipe", "dx": 8 + random.random() * (b["w"] - 30), "dy": 2, "w": 24 + random.random() * 24 })
    if isFront and random.random() < 0.18: b["roof"].append({ "kind": "waterTower", "dx": 10 + random.random() * (b["w"] - 38), "dy": -6 })
    if isFront and random.random() < 0.26: b["roof"].append({ "kind": "hvac", "dx": 8 + random.random() * (b["w"] - 32), "dy": 2, "w": 18 + random.random() * 18 })
    if isFront and random.random() < 0.22: b["roof"].append({ "kind": "fan", "dx": 8 + random.random() * (b["w"] - 24), "dy": 0, "rot": random.random() * math.pi * 2, "rs": 0.8 + random.random() * 1.6 })
    if isFront and random.random() < 0.25: b["roof"].append({ "kind": "vent", "dx": 12 + random.random() * (b["w"] - 32), "dy": 4, "emit": 0 })

def makeBottomDetail(bw, bh):
    roofSteps = []
    x = 4.0
    stepCount = 1 + math.floor(random.random() * 3)
    for _ in range(stepCount):
        w = 12 + random.random() * min(48, bw * 0.35)
        h = 6 + random.random() * 16
        if x + w > bw - 6: break
        roofSteps.append({ "x": x, "w": w, "h": h })
        x += w + 4 + random.random() * 10

    vents = []
    ventCount = math.floor(random.random() * 3)
    for _ in range(ventCount):
        vents.append({ "x": 6 + random.random() * (bw - 18), "w": 6 + random.random() * 8, "h": 3 + random.random() * 4 })

    slits = []
    cols = max(2, math.floor(bw / 14))
    for c in range(cols):
        if random.random() < 0.18:
            sx = 6 + c * 14 + random.random() * 4
            sy = 10 + random.random() * max(6, bh - 28)
            slits.append({ "x": sx, "y": sy, "h": 6 + random.random() * 12 })

    pipe = ({ "y": bh - (8 + random.random() * 18), "w": 20 + random.random() * (bw * 0.5), "t": 3 } if random.random() < 0.35 else None)
    rail = ({ "x": 6, "w": max(0, bw - 12) } if random.random() < 0.25 else None)

    return { "roofSteps": roofSteps, "vents": vents, "slits": slits, "pipe": pipe, "rail": rail }

def makeWindows(bw, bh, scaleFlag):
    """Return cell sizes + nominal grid; override sets can be added later by twinkle."""
    cellX = 14 if scaleFlag == 2 else 12
    cellY = 18 if scaleFlag == 2 else 16
    cols  = max(3, math.floor(bw / cellX))
    rows  = max(4, math.floor(bh / cellY))
    return { "cols": cols, "rows": rows, "cellX": cellX, "cellY": cellY, "lit": set(), "warm": set(), "off": set() }

def makeClouds(canvas, reduceMotion):
    w, h, dpr = _canvas_dims(canvas)
    lst = []
    count = 3 if reduceMotion else 6
    for _ in range(count):
        lst.append({ "x": random.random() * w, "y": 40 + random.random() * 120, "s": 0.8 + random.random() * 1.6, "v": 12 + random.random() * 18, "a": 0.2 + random.random() * 0.15 })
    return lst

def makeStars(canvas, reduceMotion):
    w, h, dpr = _canvas_dims(canvas)
    lst = []
    n = 70 if reduceMotion else 120
    for _ in range(n):
        lst.append({ "x": random.random() * (h * 1.4), "y": random.random() * (h * 0.5), "a": 0.4 + random.random() * 0.6, "p": random.random() * math.pi * 2 })
    return lst

# ---------------------------------------------------------------------------
# drawing
# ---------------------------------------------------------------------------

def drawCloud(ctx, x, y, s=1.0, a=0.3):
    base = _get_cloud_surface(s)
    tmp  = base.copy()  # copy so per-draw alpha doesn’t mutate the cache
    tmp.set_alpha(int(max(0, min(1, a)) * 255))
    # use same anchor math as before
    r = int(30 * s + 26 * s)
    ctx.blit(tmp, (int(x - r - 5), int(y - r - 5)))

def drawBuilding(ctx, b, alpha_override=None):
    """Full-height building: body gradient, panel stripes, roof props, windows.
       All layers are cached in b['_cache'] and only rebuilt when inputs change.
    """
    cache = b.setdefault("_cache", {})
    bx, by = int(b["x"]), int(b["y"])
    bw, bh = int(b["w"]), int(b["h"])

    # ---- body gradient (cached) -------------------------------------------
    baseColor = b.get("baseColor") or (PALETTE["frontTall"] if b.get("layer") == "frontTall" else PALETTE["backTall"])
    gTop = baseColor
    gBot = shade(baseColor, -10)

    body_needs = (
        cache.get("_body_w") != bw or
        cache.get("_body_h") != bh or
        cache.get("_body_top") != gTop or
        cache.get("_body_bot") != gBot
    )
    if body_needs:
        body = get_linear_gradient(bw, bh, gTop, gBot, horizontal=False).convert_alpha()
        cache["_body"] = body
        cache["_body_w"], cache["_body_h"] = bw, bh
        cache["_body_top"], cache["_body_bot"] = gTop, gBot
        # invalidate pre-alpha’d copy
        cache.pop("_bodyA", None)
        cache.pop("_bodyA_alpha", None)

    # blit body (possibly with alpha override) using cached pre-alpha surface
    if alpha_override is None or alpha_override >= 0.999:
        ctx.blit(cache["_body"], (bx, by))
    else:
        a255 = int(alpha_override * 255)
        if cache.get("_bodyA_alpha") != a255 or "_bodyA" not in cache:
            s = cache["_body"].copy()
            s.set_alpha(a255)
            cache["_bodyA"] = s
            cache["_bodyA_alpha"] = a255
        ctx.blit(cache["_bodyA"], (bx, by))

    # ---- panel stripes (cached) -------------------------------------------
    if b.get("panelStep", 0) > 0:
        step = int(b["panelStep"]); alp = float(b["panelAlpha"])
        pnl_needs = (
            cache.get("_pnl_w") != bw or
            cache.get("_pnl_h") != bh or
            cache.get("_pnl_step") != step or
            cache.get("_pnl_alpha") != alp
        )
        if pnl_needs:
            layer = pygame.Surface((bw, bh), pygame.SRCALPHA)
            light = _parse_color(PALETTE["panelLight"])
            dark  = _parse_color(PALETTE["panelDark"])
            a1, a2 = int(alp * 255), int(alp * 0.7 * 255)
            y0, y1 = 6, bh - 6
            for yy in range(y0, y1, step):
                pygame.draw.line(layer, (*light[:3], a1), (2, yy), (bw-2, yy), 1)
                if yy + 2 < y1:
                    pygame.draw.line(layer, (*dark[:3], a2), (2, yy+2), (bw-2, yy+2), 1)
            cache["_pnl"] = layer.convert_alpha()
            cache["_pnl_w"], cache["_pnl_h"] = bw, bh
            cache["_pnl_step"], cache["_pnl_alpha"] = step, alp
        ctx.blit(cache["_pnl"], (bx, by))

    # ---- roof props --------------------------------------------------------
    if b.get("roof"):
        for rp in b["roof"]:
            drawRoofProp(ctx, b, rp)

    # ---- windows layer (cached, override-aware) ---------------------------
    win = b.get("windows")
    if not win:
        return

    # LOCAL coords inside the building layer
    padX, padY = 6, 8
    startX = padX
    startY = padY
    wW, wH = 3, 5

    # recompute rows/cols from *current* dimensions, so extended buildings
    # still get full-height windows
    cellX = int(win.get("cellX", 14 if b.get("scaleFlag") == 2 else 12))
    cellY = int(win.get("cellY", 18 if b.get("scaleFlag") == 2 else 16))
    colsLocal = max(3, bw // cellX)
    rowsLocal = max(4, (bh - padY * 2) // cellY)

    density  = 0.24 if b.get("scaleFlag") == 2 else 0.18
    warmProb = 0.80
    seedBase = int(b.get("seed", 0)) & 0xFFFFFFFF
    windowAlpha = (0.55 if b.get("layer") == "backTall" else 0.9)

    need_build = (
        cache.get("_win_w")      != bw or
        cache.get("_win_h")      != bh or
        cache.get("_win_cols")   != colsLocal or
        cache.get("_win_cellX")  != cellX or
        cache.get("_win_cellY")  != cellY or
        cache.get("_win_seed")   != seedBase or
        cache.get("_win_density")!= density or
        cache.get("_win_tv")     != win.get("_tv")  # twinkle invalidation token
    )

    if need_build:
        layer = pygame.Surface((bw, bh), pygame.SRCALPHA)

        lit_set  = win.get("lit", set())
        off_set  = win.get("off", set())
        warm_set = win.get("warm", set())
        has_warm_override = ("warm" in win)

        warm_rgb = _parse_color(PALETTE["windowWarm"])[:3]
        cool_rgb = _parse_color(PALETTE["windowCool"])[:3]
        a255 = int(windowAlpha * 255)

        for r in range(1, int(rowsLocal) - 1):
            cy = int(startY + r * cellY)
            for c in range(1, int(colsLocal) - 1):
                wid = r * 1000 + c

                # procedural baseline
                h1 = __rand01(seedBase ^ (r * 374761393) ^ (c * 668265263))
                base_lit = (h1 < density)
                h2 = __rand01(seedBase ^ 0x9e3779b9 ^ (r * 1274126177) ^ (c * 2246822519))
                base_warm = (h2 < warmProb)

                # overrides from twinkleWindows
                if wid in off_set:
                    lit = False
                else:
                    lit = base_lit or (wid in lit_set)

                if not lit:
                    continue

                warm = (wid in warm_set) if has_warm_override else base_warm
                cx = int(startX + c * cellX)
                col = (* (warm_rgb if warm else cool_rgb), a255)
                pygame.draw.rect(layer, col, pygame.Rect(cx, cy, wW, wH))

        cache["_windows_layer"] = layer.convert_alpha()
        cache["_win_w"], cache["_win_h"] = bw, bh
        cache["_win_cols"] = int(colsLocal)
        cache["_win_cellX"], cache["_win_cellY"] = cellX, cellY
        cache["_win_seed"], cache["_win_density"] = seedBase, density
        cache["_win_tv"] = win.get("_tv")

    ctx.blit(cache["_windows_layer"], (bx, by))

def drawRoofProp(ctx, b, rp):
    x = b["x"] + (rp.get("dx") or 0)
    y = b["y"] + (rp.get("dy") or 0)
    dim = (b.get("layer") == "backTall")

    if rp["kind"] == "tank":
        fill = shade(PALETTE["roofProp"], -10) if dim else PALETTE["roofProp"]
        roundRect(ctx, x, y, 22, 14, 3, True, fill=_parse_color(fill))
        band = shade(PALETTE["roofPropLight"], -20) if dim else PALETTE["roofPropLight"]
        pygame.draw.rect(ctx, _parse_color(band), pygame.Rect(int(x+4), int(y+10), 14, 2))

    elif rp["kind"] == "dishSmall":
        stroke = shade(PALETTE["roofPropLight"], -20) if dim else PALETTE["roofPropLight"]
        alpha = 0.7 if dim else 1.0
        arcSurf = pygame.Surface((int(12*2+6), int(12*2+6)), pygame.SRCALPHA)
        pygame.draw.arc(arcSurf, _parse_color(stroke), (3,3,24,24), math.pi*0.2, math.pi*1.2, 2)
        arcSurf.set_alpha(int(alpha*255))
        ctx.blit(arcSurf, (int(x-12), int(y-12)))
        stem = pygame.Surface((2, 6), pygame.SRCALPHA)
        stem.fill(_parse_color(stroke)); stem.set_alpha(int(alpha*255))
        ctx.blit(stem, (int(x), int(y)))

    elif rp["kind"] == "pipe":
        fill = shade(PALETTE["roofProp"], -10) if dim else PALETTE["roofProp"]
        roundRect(ctx, x, y, rp.get("w", 28), 6, 3, True, fill=_parse_color(fill))

    elif rp["kind"] == "fan":
        rot = rp.get("rot", 0.0)
        alpha = 0.6 if dim else 0.9
        hubCol = shade(PALETTE["roofPropLight"], -25) if dim else PALETTE["roofPropLight"]
        center = (int(x+10), int(y+4))
        pygame.draw.circle(ctx, _parse_color(hubCol), center, 3)
        blade = pygame.Surface((16, 10), pygame.SRCALPHA)
        pygame.draw.polygon(blade, _parse_color(hubCol), [(0,5),(12,7),(12,3)])
        blade.set_alpha(int(alpha*255))
        for i in range(3):
            angle = rot + i * (2*math.pi/3)
            rotBlade = pygame.transform.rotate(blade, -angle*180.0/math.pi)
            rrect = rotBlade.get_rect(center=center)
            ctx.blit(rotBlade, rrect.topleft)

    elif rp["kind"] == "vent":
        fill = shade(PALETTE["roofProp"], -10) if dim else PALETTE["roofProp"]
        roundRect(ctx, x, y, 10, 8, 2, True, fill=_parse_color(fill))

    elif rp["kind"] == "waterTower":
        alpha = 0.7 if dim else 1.0
        light = shade(PALETTE["roofPropLight"], -25) if dim else PALETTE["roofPropLight"]
        dark  = shade(PALETTE["roofProp"], -20) if dim else PALETTE["roofProp"]
        body = pygame.Surface((20, 20), pygame.SRCALPHA)
        roundRect(body, 0, 2, 20, 14, 4, True, fill=_parse_color(light))
        pygame.draw.polygon(body, _parse_color(light), [(0,2), (10,-4), (20,2)])
        body.set_alpha(int(alpha*255))
        ctx.blit(body, (int(x), int(y-10)))
        pygame.draw.rect(ctx, _parse_color(dark), pygame.Rect(int(x+2), int(y+16), 3, 6))
        pygame.draw.rect(ctx, _parse_color(dark), pygame.Rect(int(x+15), int(y+16), 3, 6))

def drawSilhouette(ctx, b):
    roundRect(ctx, b["x"], b["y"], b["w"], b["h"], 3, True, fill="#000000")
    d = b.get("silDetail")
    if not d:
        return
    rim = pygame.Surface((int(b["w"]-2), 1), pygame.SRCALPHA)
    rim.fill(_parse_color("#ffffff")); rim.set_alpha(int(0.10*255))
    ctx.blit(rim, (int(b["x"]+1), int(b["y"])))
    for s in d["roofSteps"]:
        rr = pygame.Surface((int(s["w"]), int(s["h"])), pygame.SRCALPHA)
        roundRect(rr, 0, 0, s["w"], s["h"], 2, True, fill="#ffffff")
        rr.set_alpha(int(0.18*255))
        ctx.blit(rr, (int(b["x"] + s["x"]), int(b["y"] - s["h"])))
    for v in d["vents"]:
        vv = pygame.Surface((int(v["w"]), int(v["h"])), pygame.SRCALPHA)
        roundRect(vv, 0, 0, v["w"], v["h"], 1, True, fill="#ffffff")
        vv.set_alpha(int(0.12*255))
        ctx.blit(vv, (int(b["x"] + v["x"]), int(b["y"] + 6)))
    for s in d["slits"]:
        sl = pygame.Surface((2, int(s["h"])), pygame.SRCALPHA)
        sl.fill(_parse_color("#ffffff")); sl.set_alpha(int(0.08*255))
        ctx.blit(sl, (int(b["x"] + s["x"]), int(b["y"] + s["y"])))
    if d.get("pipe"):
        p = d["pipe"]
        pr = pygame.Surface((int(p["w"]), int(p["t"])), pygame.SRCALPHA)
        roundRect(pr, 0, 0, p["w"], p["t"], 2, True, fill="#ffffff")
        pr.set_alpha(int(0.14*255))
        ctx.blit(pr, (int(b["x"] + 6), int(b["y"] + p["y"])))
    if d.get("rail"):
        r = d["rail"]
        rail = pygame.Surface((int(r["w"]), 1), pygame.SRCALPHA)
        rail.fill(_parse_color("#ffffff")); rail.set_alpha(int(0.12*255))
        ctx.blit(rail, (int(b["x"] + r["x"]), int(b["y"] - 2)))
