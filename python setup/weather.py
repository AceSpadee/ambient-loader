
# weather.py — ambience & weather effects
# Modes: none | rain | snow | fog | storm
# Exports:
#   initWeather(mode, state, canvas, reduceMotion)
#   advanceLightning(state, dt, canvas)
#   renderLightning(ctx, state, canvas)
#
# Notes:
# - 'canvas' may be a pygame.Surface, a dict with width/height/dpr, an (w,h) tuple,
#   or just a width (int). We map to CSS-like pixels similarly to the JS viewSize().

import math
import random
import pygame

__all__ = ["initWeather", "advanceLightning", "renderLightning"]

_FOG_TEX = None

def _get_fog_texture():
    global _FOG_TEX
    if _FOG_TEX is None:
        _FOG_TEX = _make_fog_texture()
    return _FOG_TEX

# ---------------- view size helper ----------------

def _view_size(canvas):
    # Returns (w, h, dpr)
    # pygame.Surface
    try:
        w = int(canvas.get_width())
        h = int(canvas.get_height())
        return w, h, 1.0
    except AttributeError:
        pass

    # dict with width/height/dpr
    if isinstance(canvas, dict):
        cssW = int(canvas.get("clientWidth") or max(1, round(canvas["width"] / max(1.0, float(canvas.get("dpr", 1.0))))))
        effDpr = max(1.0, float(canvas["width"]) / cssW) if cssW else 1.0
        w = int(canvas["width"] / effDpr)
        h = int(canvas.get("height", 0) / effDpr)
        return w, h, effDpr

    # (w,h) tuple
    if isinstance(canvas, (tuple, list)) and len(canvas) >= 2:
        return int(canvas[0]), int(canvas[1]), 1.0

    # single width
    if isinstance(canvas, (int, float)):
        w = int(canvas)
        h = 720
        return w, h, 1.0

    # fallback
    return 1280, 720, 1.0

# ---------------- API ----------------

def initWeather(mode, state, canvas, reduceMotion=False):
    state["rain"] = []
    state["snow"] = []
    state["fog"]  = []
    state["fogTex"] = None

    # lightning / storm state
    state["lightning"] = []
    state["storm"] = None

    if mode == "rain":
        _init_rain(state, canvas, reduceMotion)
    elif mode == "snow":
        _init_snow(state, canvas, reduceMotion)
    elif mode == "fog":
        _init_fog(state, canvas, reduceMotion)
    elif mode == "storm":
        _init_storm(state, canvas, reduceMotion)
    # else: none

# ---------------- Rain / Snow / Fog ----------------

def _init_rain(state, canvas, reduceMotion):
    w, h, _ = _view_size(canvas)
    overscan = int(max(80, w * 0.08))

    baselineArea = 1280 * 720
    k = (w * h) / baselineArea
    baseCount = 80 if reduceMotion else 160
    count = max(30, int(baseCount * k))

    state["rain"].clear()
    for _ in range(count):
        z = random.random()
        state["rain"].append({
            "x": random.random() * (w + overscan) - overscan,
            "y": random.random() * (h + 120) - 120,
            "vx": -40 - 40 * z,
            "vy": 320 + 380 * z,
            "z": z
        })

def _init_snow(state, canvas, reduceMotion):
    w, h, _ = _view_size(canvas)
    overscan = int(max(80, w * 0.08))

    baselineArea = 1280 * 720
    k = (w * h) / baselineArea
    baseCount = 80 if reduceMotion else 140
    count = max(20, int(baseCount * k))

    state["snow"].clear()
    for _ in range(count):
        size = 1 + random.random() * 2.2
        state["snow"].append({
            "x": random.random() * (w + overscan) - overscan,
            "y": random.random() * (h + 80) - 80,
            "vx": -14 - random.random() * 10,
            "vy": 18 + random.random() * 28,
            "sway": random.random() * math.pi * 2,
            "swaySpeed": 0.6 + random.random() * 1.2,
            "r": size
        })

def _make_fog_texture():
    # Build a 256x256 radial gradient surface like the Canvas version
    c = pygame.Surface((256, 256), pygame.SRCALPHA)
    cx = cy = 128
    max_r = 128
    # Approx radial gradient by drawing concentric circles from center outward
    # Stops: 0.0: 0.30, 0.50: 0.20, 1.0: 0.00
    for i in range(max_r, 0, -1):
        t = i / max_r
        # piecewise lerp of alpha across stops
        if t >= 0.5:
            # between 0.5 .. 1.0 -> alpha 0.20 .. 0.00
            a = (t - 0.5) / 0.5
            alpha = (0.20 * (1 - a) + 0.00 * a)
        else:
            # between 0.0 .. 0.5 -> alpha 0.30 .. 0.20
            a = t / 0.5
            alpha = (0.30 * a + 0.20 * (1 - a))
        col = (220,235,255, int(alpha * 255))
        pygame.draw.circle(c, col, (cx, cy), i)
    return c

def _init_fog(state, canvas, reduceMotion):
    w, h, _ = _view_size(canvas)
    overscan = int(max(120, w * 0.12))
    yTop = max(0, int(state.get("groundY", h - 220) - 170))
    yBottom = int(state.get("groundY", h - 220) + 36)
    fogBandH = max(100, yBottom - yTop)

    count = max(6, int(w / 140))
    state["fogTex"] = _get_fog_texture()
    state["fog"].clear()

    for _ in range(count):
        r = 80 + random.random() * 160
        state["fog"].append({
            "x": random.random() * (w + overscan) - overscan * 0.5,
            "y": yTop + random.random() * fogBandH,
            "r": r,
            "vx": -20 - random.random() * 25,
            "a": 0.35 + random.random() * 0.25,
            "phi": random.random() * math.pi * 2,
            "swaySpeed": 0.8 + random.random() * 1.2
        })

# ---------------- Storm (heavier rain + lightning) ----------------

def _init_storm(state, canvas, reduceMotion):
    w, h, _ = _view_size(canvas)
    overscan = int(max(80, w * 0.08))

    baselineArea = 1280 * 720
    k = (w * h) / baselineArea
    baseCount = 180 if reduceMotion else 320
    count = max(60, int(baseCount * k))

    state["rain"].clear()
    for _ in range(count):
        z = random.random()
        state["rain"].append({
            "x": random.random() * (w + overscan) - overscan,
            "y": random.random() * (h + 120) - 120,
            "vx": -80 - 70 * z,
            "vy": 420 + 520 * z,
            "z": z
        })

    state["lightning"] = []
    state["storm"] = {
        "rm": bool(reduceMotion),
        "flash": 0.0,
        "nextBolt": (3.5 if reduceMotion else 3.0) + random.random() * (4.5 if reduceMotion else 3.5),
    }

# ---------------- Lightning (schedule + drawing) ----------------

def advanceLightning(state, dt, canvas):
    if not state.get("storm"):
        return

    # spawn schedule
    state["storm"]["nextBolt"] -= dt
    if state["storm"]["nextBolt"] <= 0:
        _spawn_lightning(state, canvas)
        minGap = 3.0 if state["storm"]["rm"] else 2.5
        maxGap = 6.0 if state["storm"]["rm"] else 5.0
        state["storm"]["nextBolt"] = minGap + random.random() * (maxGap - minGap)

    # fade flash
    if state["storm"]["flash"] > 0:
        state["storm"]["flash"] = max(0.0, state["storm"]["flash"] - dt * 0.6)

    # age + cull
    for b in state["lightning"]:
        b["age"] += dt
    while state["lightning"] and state["lightning"][0]["age"] > state["lightning"][0]["life"]:
        state["lightning"].pop(0)

def renderLightning(ctx, state, canvas):
    if not state.get("storm"):
        return

    w, h, _ = _view_size(canvas)
    W, H = int(w), int(h)

    # --- reuse bolt layer
    layer = state.get("_stormLayer")
    if layer is None or layer.get_width() != W or layer.get_height() != H:
        layer = pygame.Surface((W, H), pygame.SRCALPHA)
        state["_stormLayer"] = layer
    else:
        layer.fill((0, 0, 0, 0))  # clear

    # bolts
    if state["lightning"]:
        for bolt in state["lightning"]:
            k = 1.0 - (bolt["age"] / bolt["life"])
            jitter = 0.75 + random.random() * 0.25
            _stroke_path(layer, bolt["pts"], color=(0x8b,0xd3,0xff, int(0.55 * k * jitter * 255)), width=6)
            _stroke_path(layer, bolt["pts"], color=(0xee,0xf7,0xff, int(0.90 * k * 255)), width=3)
            for br in bolt["branches"]:
                _stroke_path(layer, br, color=(0xee,0xf7,0xff, int(0.85 * k * 255)), width=2)

        ctx.blit(layer, (0, 0))

    # --- reuse flash layer
    if state["storm"]["flash"] > 0:
        flash = state.get("_stormFlash")
        if flash is None or flash.get_width() != W or flash.get_height() != H:
            flash = pygame.Surface((W, H), pygame.SRCALPHA)
            state["_stormFlash"] = flash
        else:
            flash.fill((0, 0, 0, 0))
        flash.fill((180, 205, 245, int(min(0.45, state["storm"]["flash"]) * 255)))
        ctx.blit(flash, (0, 0))

# ---------------- internals ----------------

def _stroke_path(surface, pts, color=(255,255,255,255), width=2):
    if not pts or len(pts) < 2:
        return
    # draw to a temp small surface for per-primitive alpha
    col = color
    # Convert to integer points
    ipts = [(int(p[0]), int(p[1])) for p in pts]
    # pygame can draw lines with alpha directly on SRCALPHA surface
    pygame.draw.lines(surface, col, False, ipts, int(max(1, width)))

def _spawn_lightning(state, canvas):
    w, h, _ = _view_size(canvas)
    gy = state.get("groundY", int(h * 0.66))

    x0 = 40 + random.random() * (w - 80)
    y0 = 30 + random.random() * 120
    y1 = gy - (140 + random.random() * 100)
    steps = 10 + int(random.random() * 5)

    pts = []
    x = x0
    for i in range(steps + 1):
        t = i / steps
        ny = y0 + (y1 - y0) * t + (random.random() * 8 - 4)
        jitter = (1 - t) * 28
        x += (random.random() * 2 - 1) * jitter * 0.6
        pts.append((x, ny))

    # small downward branches
    branches = []
    for i in range(2, len(pts) - 2):
        if random.random() < 0.25:
            b = [pts[i]]
            bx, by = pts[i]
            length = 2 + int(random.random() * 3)
            for _ in range(length):
                bx += (random.random() * 14 - 7)
                by += (random.random() * 20 + 10)
                b.append((bx, by))
            branches.append(b)

    state["lightning"].append({"pts": pts, "branches": branches, "life": 0.22, "age": 0.0})
    state["storm"]["flash"] = max(state["storm"]["flash"], 0.35)
