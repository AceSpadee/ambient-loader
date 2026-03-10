# drawDeck.py — 1:1-style remake of drawDeck.js for Pygame
# Public API:
#   initUnderDeck(state)
#   drawDeck(ctx, state, canvasOrW=None, maybeH=None)
# (internals kept the same naming as the JS where possible)
#
# Notes:
# - ctx is a pygame.Surface.
# - Gradients/composites are approximated with temp surfaces (no numpy).
# - Tile cache is synchronous (no requestIdleCallback); built when key changes.

import math
import random
import pygame

from palette import PALETTE
from utils import roundRect as rr  # basic rounded-rect fill/stroke helper
from utils import _parse_color

__all__ = ["initUnderDeck", "drawDeck"]

# -------------------------- small color helpers ---------------------------

# Pre-parsed palette entries used every frame
PA_LINE_TOP       = _parse_color(PALETTE["lineTop"])
PA_LINE_HIGHLIGHT = _parse_color(PALETTE["lineHighlight"])
PA_LINE_LIP       = _parse_color(PALETTE["lineLip"])
PA_OBS_OUTLINE    = _parse_color(PALETTE["obstacleOutline"])
COPING_DARK  = _parse_color("#13223a")
COPING_BLACK = _parse_color("#000000")

def _with_alpha(col, a):
    r,g,b,aa = _parse_color(col)
    return (r,g,b,int(aa * max(0,min(1,a))))

def _vgrad_rect(surf, x, y, w, h, c1, c2):
    # vertical gradient fill (top->bottom)
    C1 = _parse_color(c1); C2 = _parse_color(c2)
    rng = max(1, int(h)-1); x = int(x); y = int(y); w = int(w); h = int(h)
    for j in range(h):
        t = j / rng
        col = (
            int(C1[0] + (C2[0]-C1[0])*t),
            int(C1[1] + (C2[1]-C1[1])*t),
            int(C1[2] + (C2[2]-C1[2])*t),
            int(C1[3] + (C2[3]-C1[3])*t),
        )
        pygame.draw.line(surf, col, (x, y+j), (x+w-1, y+j))

def _hgrad_rect(surf, x, y, w, h, c1, c2):
    # horizontal gradient fill (left->right)
    C1 = _parse_color(c1); C2 = _parse_color(c2)
    rng = max(1, int(w)-1); x = int(x); y = int(y); w = int(w); h = int(h)
    for i in range(w):
        t = i / rng
        col = (
            int(C1[0] + (C2[0]-C1[0])*t),
            int(C1[1] + (C2[1]-C1[1])*t),
            int(C1[2] + (C2[2]-C1[2])*t),
            int(C1[3] + (C2[3]-C1[3])*t),
        )
        pygame.draw.line(surf, col, (x+i, y), (x+i, y+h-1))

def _fill_rect(surf, x, y, w, h, col, alpha_mul=1.0, add_mode=False):
    # direct fill, no temp surfaces
    rx = pygame.Rect(int(x), int(y), int(w), int(h))
    color = _with_alpha(col, alpha_mul)  # (r,g,b,alpha)
    if add_mode:
        surf.fill(color, rx, special_flags=pygame.BLEND_RGBA_ADD)
    else:
        surf.fill(color, rx)

def _stable_gap_gid(state, g):
    """Assign a unique id once per gap object; stored under __ud so it persists across frames."""
    if g.get("__gid") is None:
        ud = state["__ud"]
        next_id = int(ud.get("gapIdCounter", 0)) + 1
        ud["gapIdCounter"] = next_id
        g["__gid"] = next_id
    return g["__gid"]

def _get_wall_grad(ud, H):
    cache = ud.setdefault("wallGrad", {})
    surf = cache.get(H)
    if surf is None:
        s = pygame.Surface((1, H), pygame.SRCALPHA)
        # base gradient w/ a mid stop (~0.55) – matches your current look
        _vgrad_rect(s, 0, 0, 1, H, "#0c172a", "#091222")
        mid = int(H * 0.55)
        _vgrad_rect(s, 0, 0, 1, mid, "#0c172a", "#0a1424")
        _vgrad_rect(s, 0, mid, 1, H - mid, "#0a1424", "#091222")
        surf = s.convert_alpha()
        cache[H] = surf
    return surf

def _get_gap_returns(ud, H):
    cache = ud.setdefault("gapReturn", {})
    v = cache.get(H)
    if v: 
        return v
    left = pygame.Surface((8, H), pygame.SRCALPHA)
    _hgrad_rect(left, 0, 0, 8, H, "rgba(0,0,0,0.0)", "rgba(0,0,0,0.35)")
    right = pygame.Surface((8, H), pygame.SRCALPHA)
    _hgrad_rect(right, 0, 0, 8, H, "rgba(0,0,0,0.35)", "rgba(0,0,0,0.0)")
    v = (left.convert_alpha(), right.convert_alpha())
    cache[H] = v
    return v

def _get_rail(ud, H, color):
    mc = ud.setdefault("miscCache", {})
    key = ("rail", H, color[0], color[1], color[2])
    surf = mc.get(key)
    if surf is None:
        s = pygame.Surface((1, H), pygame.SRCALPHA)
        s.fill((color[0], color[1], color[2], int(0.42*255)))
        surf = s.convert_alpha()
        mc[key] = surf
    return surf

def _get_wall_full(ud, W, Hq, H_under):
    """
    Return a (W × H_under) surface with the vertical wall gradient.
    Keep only one entry (LRU=1) keyed by (W, Hq, H_under) so the cache
    never grows and always matches the current frame size.
    """

    key = (int(W), int(Hq), int(H_under))  # include H_under to rebuild if viewport height changes
    wf = ud.setdefault("_wallFullObj", {"key": None, "surf": None})
    if wf["key"] != key or wf["surf"] is None:
        base = _get_wall_grad(ud, int(Hq))  # 1×Hq strip (already cached elsewhere)
        surf = pygame.transform.scale(base, (int(W), int(H_under))).convert_alpha()
        wf["key"]  = key
        wf["surf"] = surf
    return wf["surf"]

# ----------------------- lightweight Canvas-like ctx ----------------------

class LinearGradient:
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = float(x0), float(y0), float(x1), float(y1)
        self.stops = []  # list of (offset, rgba)
    def addColorStop(self, t, col):
        t = max(0.0, min(1.0, float(t)))
        self.stops.append((t, _parse_color(col)))
        self.stops.sort(key=lambda z: z[0])
    def color_at_t(self, t):
        if not self.stops:
            return (255,255,255,255)
        if t <= self.stops[0][0]: return self.stops[0][1]
        if t >= self.stops[-1][0]: return self.stops[-1][1]
        for i in range(1, len(self.stops)):
            t0,c0 = self.stops[i-1]; t1,c1 = self.stops[i]
            if t <= t1:
                k = (t - t0) / max(1e-6, (t1 - t0))
                return (
                    int(c0[0] + (c1[0]-c0[0])*k),
                    int(c0[1] + (c1[1]-c0[1])*k),
                    int(c0[2] + (c1[2]-c0[2])*k),
                    int(c0[3] + (c1[3]-c0[3])*k),
                )
        return self.stops[-1][1]

class CanvasCtx:
    '''
    Minimal subset of Canvas2D used by drawDeck themes, backed by pygame.Surface.
    Supports: save/restore, globalAlpha, globalCompositeOperation ('source-over'|'lighter'),
              fillStyle (solid/LinearGradient), strokeStyle, lineWidth, beginPath/moveTo/lineTo/closePath/fill/stroke,
              rect (as path), clip (rect only), fillRect, roundRect (fills current fillStyle).
    '''
    def __init__(self, surface):
        self.surf = surface
        self.state = [{
            "alpha": 1.0,
            "stroke": (255,255,255,255),
            "fill": (255,255,255,255),
            "lw": 1,
            "clip": None,
            "comp": "source-over",
        }]
        self.path = []  # list of points
        self.path_is_rect = None

    # state
    def save(self): self.state.append(self.state[-1].copy())
    def restore(self): 
        if len(self.state) > 1: self.state.pop()
    # styles
    @property
    def globalAlpha(self): return self.state[-1]["alpha"]
    @globalAlpha.setter
    def globalAlpha(self, v): self.state[-1]["alpha"] = max(0.0, min(1.0, float(v)))
    @property
    def strokeStyle(self): return self.state[-1]["stroke"]
    @strokeStyle.setter
    def strokeStyle(self, v): self.state[-1]["stroke"] = _parse_color(v)
    @property
    def fillStyle(self): return self.state[-1]["fill"]
    @fillStyle.setter
    def fillStyle(self, v): self.state[-1]["fill"] = v  # allow LinearGradient or color
    @property
    def lineWidth(self): return self.state[-1]["lw"]
    @lineWidth.setter
    def lineWidth(self, v): self.state[-1]["lw"] = max(1, int(round(v)))
    @property
    def globalCompositeOperation(self): return self.state[-1]["comp"]
    @globalCompositeOperation.setter
    def globalCompositeOperation(self, v): self.state[-1]["comp"] = ("lighter" if v == "lighter" else "source-over")

    # path
    def beginPath(self): self.path = []; self.path_is_rect = None
    def moveTo(self, x, y): self.path = [(float(x), float(y))]
    def lineTo(self, x, y): self.path.append((float(x), float(y)))
    def closePath(self):
        if self.path and self.path[0] != self.path[-1]:
            self.path.append(self.path[0])
    def rect(self, x, y, w, h):
        x,y,w,h = float(x),float(y),float(w),float(h)
        self.path = [(x,y),(x+w,y),(x+w,y+h),(x,y+h)]
        self.path_is_rect = pygame.Rect(int(round(x)), int(round(y)), int(round(w)), int(round(h)))
    def clip(self, mode=None):
        # only rectangular clips used in themes; store rect on state
        if self.path_is_rect is not None:
            self.state[-1]["clip"] = self.path_is_rect.copy()

    # primitives
    def createLinearGradient(self, x0, y0, x1, y1):
        return LinearGradient(x0,y0,x1,y1)

    def _apply_clip_and_blit(self, tmp, topleft):
        clip = self.state[-1]["clip"]
        if clip is None:
            self.surf.blit(tmp, topleft, special_flags=(pygame.BLEND_ADD if self.state[-1]["comp"]=="lighter" else 0))
        else:
            prev = self.surf.get_clip()
            self.surf.set_clip(clip)
            self.surf.blit(tmp, topleft, special_flags=(pygame.BLEND_ADD if self.state[-1]["comp"]=="lighter" else 0))
            self.surf.set_clip(prev)

    def fillRect(self, x, y, w, h):
        x=int(round(x)); y=int(round(y)); w=int(round(w)); h=int(round(h))
        a = self.state[-1]["alpha"]
        fs = self.state[-1]["fill"]
        if isinstance(fs, LinearGradient):
            tmp = pygame.Surface((w,h), pygame.SRCALPHA)
            # Detect axis: if |dy| > |dx| -> vertical, else horizontal (approx)
            dx = fs.x1 - fs.x0; dy = fs.y1 - fs.y0
            if abs(dy) > abs(dx):  # vertical-ish
                rng = max(1, h-1)
                for j in range(h):
                    t = j / rng
                    col = fs.color_at_t(t)
                    pygame.draw.line(tmp, col, (0,j), (w-1,j))
            elif abs(dx) > 1e-6:   # horizontal-ish
                rng = max(1, w-1)
                for i in range(w):
                    t = i / rng
                    col = fs.color_at_t(t)
                    pygame.draw.line(tmp, col, (i,0), (i,h-1))
            else:
                tmp.fill(fs.color_at_t(0))
            if a < 1.0: tmp.set_alpha(int(255*a))
            self._apply_clip_and_blit(tmp, (x,y))
        else:
            _fill_rect(self.surf, x,y,w,h, fs, alpha_mul=a, add_mode=(self.state[-1]["comp"]=="lighter"))

    def _fill_polygon(self, pts, color_or_grad):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        minx, maxx = int(math.floor(min(xs))), int(math.ceil(max(xs)))
        miny, maxy = int(math.floor(min(ys))), int(math.ceil(max(ys)))
        W = max(1, maxx - minx); H = max(1, maxy - miny)
        # mask
        mask = pygame.Surface((W,H), pygame.SRCALPHA)
        pygame.draw.polygon(mask, (255,255,255,255), [(int(px-minx), int(py-miny)) for (px,py) in pts])

        if isinstance(color_or_grad, LinearGradient):
            tmp = pygame.Surface((W,H), pygame.SRCALPHA)
            dx = color_or_grad.x1 - color_or_grad.x0
            dy = color_or_grad.y1 - color_or_grad.y0
            if abs(dy) > abs(dx):  # vertical-ish
                rng = max(1, H-1)
                for j in range(H):
                    t = j / rng
                    col = color_or_grad.color_at_t(t)
                    pygame.draw.line(tmp, col, (0,j), (W-1,j))
            elif abs(dx) > 1e-6:
                rng = max(1, W-1)
                for i in range(W):
                    t = i / rng
                    col = color_or_grad.color_at_t(t)
                    pygame.draw.line(tmp, col, (i,0), (i,H-1))
            else:
                tmp.fill(color_or_grad.color_at_t(0))
            tmp.blit(mask, (0,0), special_flags=pygame.BLEND_RGBA_MULT)
        else:
            tmp = pygame.Surface((W,H), pygame.SRCALPHA)
            tmp.fill(_parse_color(color_or_grad))
            tmp.blit(mask, (0,0), special_flags=pygame.BLEND_RGBA_MULT)

        a = self.state[-1]["alpha"]
        if a < 1.0: tmp.set_alpha(int(255*a))
        self._apply_clip_and_blit(tmp, (minx, miny))

    def fill(self):
        if not self.path: return
        self._fill_polygon(self.path, self.state[-1]["fill"])

    def stroke(self):
        if len(self.path) < 2: return
        a = self.state[-1]["alpha"]; lw = max(1, int(self.state[-1]["lw"]))
        color = self.state[-1]["stroke"]
        tmp = pygame.Surface(self.surf.get_size(), pygame.SRCALPHA)
        pygame.draw.lines(tmp, (color[0],color[1],color[2],int(color[3]*a)), False, [(int(x),int(y)) for (x,y) in self.path], lw)
        self._apply_clip_and_blit(tmp, (0,0))

    def roundRect(self, x, y, w, h, r, doFill=True):
        if not doFill: return
        fs = self.state[-1]["fill"]
        if isinstance(fs, LinearGradient):
            tmp = pygame.Surface((int(w), int(h)), pygame.SRCALPHA)
            dx = fs.x1 - fs.x0; dy = fs.y1 - fs.y0
            if abs(dy) > abs(dx):  # vertical-ish
                _vgrad_rect(tmp, 0, 0, int(w), int(h), fs.color_at_t(0.0), fs.color_at_t(1.0))
            else:
                _hgrad_rect(tmp, 0, 0, int(w), int(h), fs.color_at_t(0.0), fs.color_at_t(1.0))
            mask = pygame.Surface((int(w), int(h)), pygame.SRCALPHA)
            rr(mask, 0,0,int(w),int(h), int(r), True, fill_color=(255,255,255,255))
            tmp.blit(mask, (0,0), special_flags=pygame.BLEND_RGBA_MULT)
            a = self.state[-1]["alpha"]
            if a < 1.0: tmp.set_alpha(int(255*a))
            self._apply_clip_and_blit(tmp, (int(x), int(y)))
        else:
            a = self.state[-1]["alpha"]
            col = _with_alpha(fs, a)
            rr(self.surf, x,y,w,h,r, True, fill_color=col)

# ----------------------------- THEMES -------------------------------------

def _theme_ribs_skyscraper(ctx, x, w, topY, botY):
    padX, padTop, padBot = 9, 14, 48
    gx = round(x + padX); gw = round(w - padX * 2)
    gy = round(topY + padTop); gh = round((botY - topY) - (padTop + padBot))
    if gw < 80 or gh < 48: return

    g = ctx.createLinearGradient(gx, gy, gx, gy + gh)
    for t,c in [(0.00,"rgba(9,18,32,1.00)"),
                (0.25,"rgba(15,26,44,1.00)"),
                (0.50,"rgba(24,44,74,0.95)"),
                (0.55,"rgba(140,190,255,0.18)"),
                (1.00,"rgba(8,16,28,1.00)")]: g.addColorStop(t,c)
    ctx.fillStyle = g; ctx.roundRect(gx, gy, gw, gh, 3, True)

    # vertical ribs
    ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle = "#162a44"; ctx.lineWidth = 1
    x2 = gx + 8.5
    while x2 < gx + gw - 8.5:
        ctx.beginPath(); ctx.moveTo(x2, gy + 3); ctx.lineTo(x2, gy + gh - 3); ctx.stroke()
        x2 += 14
    ctx.restore()

    # mullions
    ctx.save(); ctx.globalAlpha = 0.13; ctx.strokeStyle = "#1a2f4f"
    mL = gx + math.floor(gw * 0.28) + 0.5
    mR = gx + math.floor(gw * 0.72) + 0.5
    ctx.beginPath(); ctx.moveTo(mL, gy + 2); ctx.lineTo(mL, gy + gh - 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(mR, gy + 2); ctx.lineTo(mR, gy + gh - 2); ctx.stroke()
    ctx.restore()

    # specular bars
    ctx.save(); ctx.globalCompositeOperation = "lighter"
    bars = [
        {"x": gx + math.floor(gw * 0.18), "w": 6, "a": 0.10},
        {"x": gx + math.floor(gw * 0.52), "w": 8, "a": 0.08},
        {"x": gx + math.floor(gw * 0.82), "w": 5, "a": 0.10},
    ]
    for b in bars:
        gb = ctx.createLinearGradient(b["x"], gy, b["x"] + b["w"], gy)
        gb.addColorStop(0,   "rgba(190,220,255,0.00)")
        gb.addColorStop(0.5, f"rgba(190,220,255,{b['a']})")
        gb.addColorStop(1,   "rgba(190,220,255,0.00)")
        ctx.fillStyle = gb
        ctx.fillRect(b["x"], gy + 5, b["w"], gh - 10)
    ctx.restore()

    # bottom mech strip
    pw, ph, px, py = gw - 20, 16, gx + 10, botY - 26
    pg = ctx.createLinearGradient(px, py - ph, px, py)
    pg.addColorStop(0, "#0d1a2e"); pg.addColorStop(1, "#0a1626")
    ctx.fillStyle = pg; ctx.roundRect(px, py - ph, pw, ph, 2, True)

    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = "#0c223c"
    y = py - ph + 4
    while y < py - 3:
        ctx.fillRect(px + 6, math.floor(y), pw - 12, 1)
        y += 4
    ctx.restore()

def _theme_glazed_tokyo(ctx, x, w, topY, botY):
    padX, padTop, padBot = 10,16,56
    gx = round(x + padX); gw = round(w - padX*2)
    gy = round(topY + padTop); gh = round((botY-topY) - (padTop+padBot))
    if gw < 90 or gh < 52: return

    g = ctx.createLinearGradient(gx, gy, gx, gy + gh)
    for t,c in [(0.00,"rgba(10,20,36,1.00)"),
                (0.20,"rgba(16,28,48,1.00)"),
                (0.45,"rgba(26,50,86,0.95)"),
                (0.50,"rgba(170,220,255,0.22)"),
                (0.55,"rgba(24,46,78,0.92)"),
                (1.00,"rgba(8,16,30,1.00)")]: g.addColorStop(t,c)
    ctx.fillStyle = g; ctx.roundRect(gx, gy, gw, gh, 3, True)

    # side vignettes
    ctx.save(); ctx.globalAlpha = 0.12
    edge = ctx.createLinearGradient(gx, 0, gx + 12, 0)
    edge.addColorStop(0, "rgba(0,0,0,0.55)"); edge.addColorStop(1, "rgba(0,0,0,0.0)")
    ctx.fillStyle = edge; ctx.fillRect(gx, gy + 6, 12, gh - 12)
    edge = ctx.createLinearGradient(gx + gw - 12, 0, gx + gw, 0)
    edge.addColorStop(0, "rgba(0,0,0,0.0)"); edge.addColorStop(1, "rgba(0,0,0,0.55)")
    ctx.fillStyle = edge; ctx.fillRect(gx + gw - 12, gy + 6, 12, gh - 12)
    ctx.restore()

    # faint vertical mullions
    ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = "#1f3556"
    mL = gx + math.floor(gw * 0.28) + 0.5
    mR = gx + math.floor(gw * 0.72) + 0.5
    ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke()
    ctx.restore()

    # reflective diagonal wedges (clipped to bay rect)
    def clipRect():
        ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip()
    ctx.save(); clipRect()
    def diag(x0,y0,x1,y1, a=0.06):
        gD = ctx.createLinearGradient(x0,y0,x1,y1)
        gD.addColorStop(0.0,"rgba(210,235,255,0.0)")
        gD.addColorStop(0.5,f"rgba(210,235,255,{a})")
        gD.addColorStop(1.0,"rgba(210,235,255,0.0)")
        return gD

    ctx.fillStyle = diag(gx, gy, gx + gw, gy + gh, 0.07)
    ctx.beginPath()
    ctx.moveTo(gx + 18, gy + 20)
    ctx.lineTo(gx + 34, gy + 20)
    ctx.lineTo(gx + gw - 46, gy + gh - 14)
    ctx.lineTo(gx + gw - 62, gy + gh - 14)
    ctx.closePath(); ctx.fill()

    ctx.fillStyle = diag(gx + gw, gy, gx, gy + gh, 0.05)
    ctx.beginPath()
    ctx.moveTo(gx + gw - 18, gy + 16)
    ctx.lineTo(gx + gw - 34, gy + 16)
    ctx.lineTo(gx + 56,      gy + gh - 10)
    ctx.lineTo(gx + 72,      gy + gh - 10)
    ctx.closePath(); ctx.fill()
    ctx.restore()

    # vertical lightbox sign (looks like a sign)
    sx, sy, sw, sh = gx + gw - 26, gy + 12, 12, gh - 24
    ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#081426"; ctx.roundRect(sx - 2, sy - 2, sw + 4, sh + 4, 2, True); ctx.restore()

    sg = ctx.createLinearGradient(sx, sy, sx + sw, sy)
    sg.addColorStop(0.00, "rgba(120,190,255,0.25)")
    sg.addColorStop(0.50, "rgba(210,245,255,0.60)")
    sg.addColorStop(1.00, "rgba(120,190,255,0.25)")
    ctx.fillStyle = sg; ctx.roundRect(sx, sy, sw, sh, 2, True)

    ctx.save(); ctx.globalAlpha = 0.30; ctx.fillStyle = "#d8f3ff"
    y = sy + 6
    while y < sy + sh - 6:
        cellW = (sw - 4) if int(y) % 24 == 0 else (sw - 6)
        bx = sx + (2 if int(y) % 24 == 0 else 3)
        ctx.fillRect(bx, math.floor(y), cellW, 2)
        y += 12
    ctx.restore()

    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = "#8fbaff"; ctx.fillRect(gx + 3, gy + 7, gw - 6, 1); ctx.restore()

def _theme_diagrid_skyscraper(ctx, x, w, topY, botY):
    padX, padTop, padBot = 10,16,56
    gx = round(x + padX); gw = round(w - padX*2)
    gy = round(topY + padTop); gh = round((botY-topY) - (padTop+padBot))
    if gw < 90 or gh < 52: return

    g = ctx.createLinearGradient(gx, gy, gx, gy + gh)
    for t,c in [(0.00,"rgba(10,20,36,1.00)"),
                (0.22,"rgba(15,28,48,1.00)"),
                (0.44,"rgba(28,52,88,0.95)"),
                (0.50,"rgba(120,180,255,0.18)"),
                (0.56,"rgba(24,46,78,0.92)"),
                (1.00,"rgba(8,16,30,1.00)")]: g.addColorStop(t,c)
    ctx.fillStyle = g; ctx.roundRect(gx, gy, gw, gh, 3, True)

    ctx.save(); ctx.globalAlpha = 0.11; ctx.strokeStyle = "#1f3556"; ctx.lineWidth = 1
    mL = gx + math.floor(gw * 0.28) + 0.5
    mR = gx + math.floor(gw * 0.72) + 0.5
    ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke()

    stepX = 22; x0 = gx + 8
    while x0 < gx + gw - 8:
        xa = x0 + 0.5
        ctx.beginPath(); ctx.moveTo(xa, gy + 10); ctx.lineTo(xa + 34, gy + gh - 12); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(xa + 34, gy + 10); ctx.lineTo(xa, gy + gh - 12); ctx.stroke()
        x0 += stepX
    ctx.restore()

    ctx.save(); ctx.globalCompositeOperation = "lighter"
    bars = [
        {"x": gx + math.floor(gw * 0.18), "w": 6, "a": 0.10},
        {"x": gx + math.floor(gw * 0.53), "w": 10, "a": 0.08},
        {"x": gx + math.floor(gw * 0.80), "w": 5, "a": 0.10},
    ]
    for b in bars:
        gBar = ctx.createLinearGradient(b["x"], gy, b["x"] + b["w"], gy)
        gBar.addColorStop(0, "rgba(190,220,255,0.00)")
        gBar.addColorStop(0.5, f"rgba(190,220,255,{b['a']})")
        gBar.addColorStop(1, "rgba(190,220,255,0.00)")
        ctx.fillStyle = gBar; ctx.fillRect(b["x"], gy + 5, b["w"], gh - 10)
    ctx.restore()

    sx, sy, sw, sh = gx + gw - 24, gy + 12, 10, gh - 24
    ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#081426"; ctx.roundRect(sx - 2, sy - 2, sw + 4, sh + 4, 2, True); ctx.restore()
    sg = ctx.createLinearGradient(sx, sy, sx + sw, sy)
    sg.addColorStop(0.00, "rgba(100,180,255,0.25)")
    sg.addColorStop(0.50, "rgba(190,240,255,0.55)")
    sg.addColorStop(1.00, "rgba(100,180,255,0.25)")
    ctx.fillStyle = sg; ctx.roundRect(sx, sy, sw, sh, 2, True)

    # bottom spandrel
    pw, ph, px2, py2 = gw - 22, 18, gx + 11, botY - 28
    pg = ctx.createLinearGradient(px2, py2 - ph, px2, py2)
    pg.addColorStop(0, "#0d1a2e"); pg.addColorStop(1, "#0a1626")
    ctx.fillStyle = pg; ctx.roundRect(px2, py2 - ph, pw, ph, 2, True)
    ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#0c223c"
    y = py2 - ph + 4
    while y < py2 - 3:
        ctx.fillRect(px2 + 6, math.floor(y), pw - 12, 1)
        y += 5
    ctx.restore()

def _theme_glazed_skyscraper(ctx, x, w, topY, botY):
    padX, padTop, padBot = 12,16,52
    gx = round(x + padX); gw = round(w - padX*2)
    gy = round(topY + padTop); gh = round((botY-topY) - (padTop+padBot))
    if gw < 92 or gh < 48: return

    g = ctx.createLinearGradient(gx, gy, gx, gy + gh)
    for t,c in [(0.00,"rgba(13,24,40,1.00)"),
                (0.28,"rgba(16,30,50,1.00)"),
                (0.42,"rgba(30,56,92,0.92)"),
                (0.50,"rgba(92,148,220,0.22)"),
                (0.58,"rgba(28,54,88,0.90)"),
                (1.00,"rgba(10,22,40,1.00)")]: g.addColorStop(t,c)
    ctx.fillStyle = g; ctx.roundRect(gx, gy, gw, gh, 3, True)

    ctx.save(); ctx.globalAlpha = 0.12
    edge = ctx.createLinearGradient(gx, 0, gx + 12, 0)
    edge.addColorStop(0, "rgba(0,0,0,0.55)"); edge.addColorStop(1, "rgba(0,0,0,0.0)")
    ctx.fillStyle = edge; ctx.fillRect(gx, gy + 6, 12, gh - 12)
    edge = ctx.createLinearGradient(gx + gw - 12, 0, gx + gw, 0)
    edge.addColorStop(0, "rgba(0,0,0,0.0)"); edge.addColorStop(1, "rgba(0,0,0,0.55)")
    ctx.fillStyle = edge; ctx.fillRect(gx + gw - 12, gy + 6, 12, gh - 12)
    ctx.restore()

    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = "#8fbaff"; ctx.fillRect(gx + 3, gy + 6, gw - 6, 1)
    ctx.globalAlpha = 0.10; ctx.fillStyle = "#92b8ff"
    ctx.fillRect(gx + 2,      gy + 10, 1, gh - 20)
    ctx.fillRect(gx + gw - 3, gy + 10, 1, gh - 20)
    ctx.restore()

    # Mullions
    ctx.save(); ctx.globalAlpha = 0.13; ctx.strokeStyle = "#102138"; ctx.lineWidth = 1
    mL = gx + math.floor(gw * 0.28) + 0.5
    mR = gx + math.floor(gw * 0.72) + 0.5
    ctx.beginPath(); ctx.moveTo(mL, gy + 4); ctx.lineTo(mL, gy + gh - 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(mR, gy + 4); ctx.lineTo(mR, gy + gh - 4); ctx.stroke()
    ctx.restore()

    # Dense spandrels
    ctx.save(); ctx.globalAlpha = 0.11; ctx.strokeStyle = "#12243e"; ctx.lineWidth = 1
    step = 22; y = gy + 18
    while y < gy + gh - 14:
        yy = math.floor(y) + 0.5
        ctx.beginPath(); ctx.moveTo(gx + 6, yy);     ctx.lineTo(gx + gw - 6, yy);     ctx.stroke()
        ctx.globalAlpha = 0.08
        ctx.beginPath(); ctx.moveTo(gx + 6, yy + 2); ctx.lineTo(gx + gw - 6, yy + 2); ctx.stroke()
        ctx.globalAlpha = 0.11
        y += step
    ctx.restore()

    # Specular stripes + diagonals (lighter)
    ctx.save(); ctx.globalCompositeOperation = "lighter"
    bars = [
        {"x": gx + math.floor(gw * 0.18), "w": 6, "a": 0.10},
        {"x": gx + math.floor(gw * 0.48), "w": 10, "a": 0.08},
        {"x": gx + math.floor(gw * 0.78), "w": 5, "a": 0.10},
    ]
    for b in bars:
        gBar = ctx.createLinearGradient(b["x"], gy, b["x"] + b["w"], gy)
        gBar.addColorStop(0, "rgba(180,210,255,0.00)")
        gBar.addColorStop(0.5, f"rgba(180,210,255,{b['a']})")
        gBar.addColorStop(1, "rgba(180,210,255,0.00)")
        ctx.fillStyle = gBar; ctx.fillRect(b["x"], gy + 4, b["w"], gh - 8)

    # Clip to glass
    ctx.beginPath(); ctx.rect(gx, gy, gw, gh); ctx.clip()
    def diag(x0,y0,x1,y1,a=0.055):
        gD = ctx.createLinearGradient(x0,y0,x1,y1)
        gD.addColorStop(0.00, "rgba(200,230,255,0.0)")
        gD.addColorStop(0.50, f"rgba(200,230,255,{a})")
        gD.addColorStop(1.00, "rgba(200,230,255,0.0)")
        return gD
    ctx.fillStyle = diag(gx, gy, gx + gw, gy + gh, 0.055)
    ctx.beginPath()
    ctx.moveTo(gx + 12, gy + 8)
    ctx.lineTo(gx + 24, gy + 8)
    ctx.lineTo(gx + gw - 36, gy + gh - 10)
    ctx.lineTo(gx + gw - 52, gy + gh - 10)
    ctx.closePath(); ctx.fill()

    ctx.fillStyle = diag(gx + gw, gy, gx, gy + gh, 0.04)
    ctx.beginPath()
    ctx.moveTo(gx + gw - 18, gy + 10)
    ctx.lineTo(gx + gw - 30, gy + 10)
    ctx.lineTo(gx + 46, gy + gh - 12)
    ctx.lineTo(gx + 60, gy + gh - 12)
    ctx.closePath(); ctx.fill()
    ctx.restore()

    # billboard strip
    bh = 12; bw = gw - 32; bx = gx + 16; by = gy + math.floor(gh * 0.26)
    gg = ctx.createLinearGradient(bx, by, bx + bw, by)
    gg.addColorStop(0.00, "#ff5aa3"); gg.addColorStop(1.00, "#ffd66b")
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = gg; ctx.roundRect(bx, by, bw, bh, 2, True); ctx.restore()

    ctx.save(); ctx.globalAlpha = 0.30; ctx.fillStyle = "#ffffff22"
    cell, pad, gx0, gx1 = 10, 6, bx + 6, bx + bw - 6
    x2 = gx0
    while x2 <= gx1 - 4:
        tall = (((int(x2) >> 3) & 1) == 0)
        h2 = (bh - 6) if tall else max(4, bh - 8)
        ctx.fillRect(x2, by + ((bh - h2) >> 1), 4, h2)
        x2 += cell
    ctx.restore()

    ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = "#111c30"
    ctx.roundRect(bx, by - 2, bw, 2, 1, True)
    ctx.roundRect(bx, by + bh, bw, 2, 1, True)
    ctx.restore()

    # vertical lightbox signs
    def drawSign(sx, sy, sw, sh, hue):
        ctx.save()
        ctx.fillStyle = "#0b1422"; ctx.roundRect(sx - 2, sy - 2, sw + 4, sh + 4, 3, True)
        ctx.globalAlpha = 0.20; ctx.fillStyle = "#000000"; ctx.roundRect(sx - 1, sy - 1, sw + 2, sh + 2, 2, True)
        ctx.globalAlpha = 1.0
        glass = ctx.createLinearGradient(sx, sy, sx, sy + sh)
        cTop = "#0e2b48" if hue == "cyan" else "#2a0d2b"
        cBot = "#0b2038" if hue == "cyan" else "#200a21"
        glass.addColorStop(0, cTop); glass.addColorStop(1, cBot)
        ctx.fillStyle = glass; ctx.roundRect(sx, sy, sw, sh, 2, True)

        ctx.globalCompositeOperation = "lighter"
        halo = ctx.createLinearGradient(sx - 6, sy, sx + sw + 6, sy + sh)
        glow = "rgba(120,200,255" if hue == "cyan" else "rgba(255,120,200"
        halo.addColorStop(0.00, f"{glow},0.00)")
        halo.addColorStop(0.50, f"{glow},0.22)")
        halo.addColorStop(1.00, f"{glow},0.00)")
        ctx.fillStyle = halo; ctx.roundRect(sx - 3, sy + 2, sw + 6, sh - 4, 3, True)

        ctx.globalCompositeOperation = "source-over"
        ctx.globalAlpha = 0.85; ctx.fillStyle = ("#87d2ff" if hue == "cyan" else "#ff6bc2")
        segH, gap, padX = 9, 11, 3
        yy = sy + 6
        while yy + segH < sy + sh - 6:
            ctx.fillRect(sx + padX, yy, sw - padX*2, segH)
            yy += segH + gap

        ctx.globalAlpha = 0.25; ctx.fillStyle = ("#9dd8ff" if hue == "cyan" else "#ffc1e9")
        ctx.fillRect(sx, sy, 1, sh)
        ctx.fillRect(sx + sw - 1, sy, 1, sh)

        ctx.globalAlpha = 0.35; ctx.fillStyle = "#0e1b2e"
        brW, brH = 6, 4
        yy = sy + 6
        while yy < sy + sh - 6:
            ctx.fillRect(sx - brW, yy, brW, brH)
            ctx.fillRect(sx + sw,  yy, brW, brH)
            yy += 22

        ctx.globalAlpha = 0.45; ctx.fillStyle = "#17263e"
        for px,py in [(sx - 1, sy - 1),(sx + sw - 1, sy - 1),(sx - 1, sy + sh - 1),(sx + sw - 1, sy + sh - 1)]:
            ctx.fillRect(px, py, 2, 2)
        ctx.restore()

    # left cyan
    sw, sx, sy, sh = 14, gx + math.floor(gw * 0.17), gy + 10, gh - 20
    drawSign(sx, sy, sw, sh, "cyan")

    if gw >= 140:
        sw, sx, sy, sh = 10, gx + math.floor(gw * 0.79), gy + 14, gh - 28
        drawSign(sx, sy, sw, sh, "magenta")

    # bottom louver
    pw, ph, px2, py2 = gw - 24, 22, gx + 12, botY - 28
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = "#0a172a"; ctx.roundRect(px2, py2 - ph, pw, ph, 2, True); ctx.restore()
    pg = ctx.createLinearGradient(px2, py2 - ph, px2, py2); pg.addColorStop(0, "#0d1a2e"); pg.addColorStop(1, "#0a1626")
    ctx.fillStyle = pg; ctx.roundRect(px2, py2 - ph, pw, ph, 2, True)
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = "#0c223c"
    y = py2 - ph + 4
    while y < py2 - 2:
        ctx.fillRect(px2 + 6, math.floor(y), pw - 12, 2)
        y += 6
    ctx.restore()

THEME_REGISTRY = [
    {"name":"RibsSkyscraper",    "draw": _theme_ribs_skyscraper},
    {"name":"GlazedTokyo",       "draw": _theme_glazed_tokyo},
    {"name":"DiagridSkyscraper", "draw": _theme_diagrid_skyscraper},
    {"name":"GlazedSkyscraper",  "draw": _theme_glazed_skyscraper},
]

# ------------------------------ INIT --------------------------------------

def initUnderDeck(state):
    state["deckScrollX"] = 0
    state["deckGaps"] = []

    # run-scoped theme seed & counts
    state["__themeSalt"]  = random.randint(0, 0x7fffffff)
    state["__themeCount"] = len(THEME_REGISTRY)
    state["__firstSpanTheme"] = int(random.random() * state["__themeCount"])

    # optional (current-frame convenience): top-level carry
    state["__carryLeftTheme"] = state["__firstSpanTheme"]

    pilasterW, bayW = 18, 148
    state["__ud"] = {
        "pilasterW": pilasterW,
        "bayW": bayW,
        "period": pilasterW + bayW,
        "tileH": 0,
        "cache": [None] * state["__themeCount"],
        "ready": False,
        "buildRequested": False,
        "key": "",
        # ✅ persistent, frame-safe state (survives {**state, ...} shallow copies)
        "gapIdCounter": 0,
        "carryLeftTheme": state["__firstSpanTheme"],
        "_wallFullObj": {"key": None, "surf": None},
    }

# ------------------------------ DRAW --------------------------------------

def _segments_excluding_gaps(W, gaps):
    # Return list of (x,w) segments in [0,W] that are NOT inside any gap
    spans = []
    cur = 0
    for g in sorted(gaps, key=lambda G: G["x"]):
        L = int(round(g["x"])); R = int(round(g["x"] + g["w"]))
        if R <= 0 or L >= W: continue
        L = max(0, L); R = min(W, R)
        if L > cur: spans.append( (cur, L - cur) )
        cur = max(cur, R)
        if cur >= W: break
    if cur < W: spans.append( (cur, W - cur) )
    if not spans: spans = [(0, W)]
    return spans

def drawDeck(ctx, state):
    """
    Draws the deck line, under-deck wall, neon gap rails, then the facade.
    """

    W = int(state["screen_w"])
    H = int(state["screen_h"])

    gy     = float(state["groundY"])
    deckH  = float(state.get("deckH", 10))
    lipH   = float(state.get("deckLip", 4))
    topY   = gy + deckH + lipH
    botY   = float(H)
    gaps   = state.get("deckGaps", []) or []

    if botY <= topY:
        return  # nothing to draw below deck

    # Quantize under-deck height to reduce cache churn on tiny resizes/zoom jitter
    H_under = int(botY - topY)
    QUANT   = 2
    Hq      = H_under - (H_under % QUANT)

    # Make sure the facade tile cache matches current tile height/period (quantized)
    ensureUDCache(state, Hq)

    # Precompute gap-free screen segments once and reuse
    segments = _segments_excluding_gaps(W, gaps)

    # 1) Deck strip (top line, highlight, lip) over each solid segment
    for (sx, sw) in segments:
        sx_i, sw_i = int(sx), int(sw)
        _fill_rect(ctx, sx_i, int(gy),      sw_i, int(deckH), PA_LINE_TOP)
        _fill_rect(ctx, sx_i, int(gy),      sw_i, 2,          PA_LINE_HIGHLIGHT)
        _fill_rect(ctx, sx_i, int(gy+deckH),sw_i, int(lipH),  PA_LINE_LIP)

    # 2) Under-deck wall gradient + coping lines (pre-scale once per frame)
    gradFull = _get_wall_full(state["__ud"], W, Hq, H_under)
    topY_i   = int(topY)

    for (sx, sw) in segments:
        sx_i, sw_i = int(sx), int(sw)
        # sub-blit a slice of the full-width gradient (no per-span scaling)
        ctx.blit(gradFull, (sx_i, topY_i), area=pygame.Rect(sx_i, 0, sw_i, H_under))
        # coping lines at the top of the wall
        _fill_rect(ctx, sx_i, topY_i,     sw_i, 2, COPING_DARK,  alpha_mul=0.35)
        _fill_rect(ctx, sx_i, topY_i + 2, sw_i, 2, COPING_BLACK, alpha_mul=0.18)

    # 3) Neon gap rails (cached 1×H rail per height+color) — batch blits
    rail  = _get_rail(state["__ud"], int(botY - gy), PA_OBS_OUTLINE)

    blits = []
    gy_i  = int(gy)
    for g in gaps:
        L = int(round(g["x"]))
        R = int(round(g["x"] + g["w"]))
        if R < 0 or L > W:
            continue
        blits.append((rail, (L, gy_i)))
        blits.append((rail, (R, gy_i)))
    if blits:
        ctx.blits(blits)

    # 4) Facade spans & gap returns (uses cached tiles and player-anchored theme carry)
    drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, SAFE_MARGIN=16)

# --------------------- CACHE + SPANS (ported 1:1) -------------------------

def ensureUDCache(state, tileH):
    ud = state["__ud"]
    key = f"{tileH}|{ud['period']}|{state['__themeCount']}"
    if ud.get("key") == key and ud.get("ready"):
        return
    ud["key"]   = key
    ud["tileH"] = int(tileH)
    # lazy: mark all entries “not built yet”
    ud["cache"] = [None] * state["__themeCount"]
    ud["ready"] = True

def buildTileCanvas(periodW, tileH, themeIdx):
    c = pygame.Surface((int(periodW), int(tileH)), pygame.SRCALPHA)
    g = CanvasCtx(c)

    pilasterW, bayW = 18, 148
    topY, botY = 0, int(tileH)
    # pilaster
    px = 0
    pGrad = g.createLinearGradient(px, topY, px, botY)
    pGrad.addColorStop(0.00, "#0b1526"); pGrad.addColorStop(1.00, "#0b1422")
    g.fillStyle = pGrad; g.fillRect(px, topY, pilasterW, botY - topY)

    # bright edges
    g.save(); g.globalAlpha = 0.18; g.strokeStyle = "#8ab7ff"; g.lineWidth = 1
    g.beginPath(); g.moveTo(px + 0.5, topY); g.lineTo(px + 0.5, botY); g.stroke()
    g.beginPath(); g.moveTo(px + pilasterW - 0.5, topY); g.lineTo(px + pilasterW - 0.5, botY); g.stroke()
    g.restore()

    # bay background
    bx = px + pilasterW; bw = bayW
    bGrad = g.createLinearGradient(bx, topY, bx, botY)
    bGrad.addColorStop(0.00, "#0e1c30"); bGrad.addColorStop(0.30, "#0e1b2e"); bGrad.addColorStop(1.00, "#0a1526")
    g.fillStyle = bGrad; g.fillRect(bx, topY, bw, botY - topY)

    # mullions shared
    g.save(); g.globalAlpha = 0.14; g.strokeStyle = "#10213a"; g.lineWidth = 1
    m1 = bx + math.floor(bw * 0.28) + 0.5; m2 = bx + math.floor(bw * 0.72) + 0.5
    g.beginPath(); g.moveTo(m1, topY); g.lineTo(m1, botY); g.stroke()
    g.beginPath(); g.moveTo(m2, topY); g.lineTo(m2, botY); g.stroke()
    g.restore()

    theme = THEME_REGISTRY[max(0, min(themeIdx, len(THEME_REGISTRY)-1))]
    theme["draw"](g, bx, bw, topY, botY)

    return c

def rand01(n):
    n = (n ^ 61) ^ (n >> 16)
    n = (n + (n << 3)) & 0xffffffff
    n = n ^ (n >> 4)
    n = (n * 0x27d4eb2d) & 0xffffffff
    n = n ^ (n >> 15)
    return (n & 0xffffffff) / 4294967295.0

def pickThemeIndex(state, gapId):
    salt = int(state["__themeSalt"]) & 0xffffffff
    r = rand01( ((gapId ^ salt) & 0xffffffff) * 0x9e3779b1 & 0xffffffff )
    return int(math.floor(r * state["__themeCount"]))

def _spans_from_sorted_gaps(W, sorted_gaps, margin):
    """
    Build visible solid spans from a *pre-sorted* gap list (sorted by gap["x"]).
    Returns a list of dicts: {"x", "w", "leftGap", "rightGap"} clipped to [0,W].
    """
    if not sorted_gaps:
        return [{"x": 0, "w": int(W), "leftGap": None, "rightGap": None}]

    spans = []
    cursor = -10_000_000  # far left in world coords
    prev_gap = None

    for g in sorted_gaps:
        Lw = int(round(g["x"])) - margin
        Rw = int(round(g["x"] + g["w"])) + margin
        if Lw > cursor:
            spans.append({
                "xw": cursor,
                "ww": Lw - cursor,
                "leftGap": prev_gap,
                "rightGap": g
            })
        cursor = max(cursor, Rw)
        prev_gap = g

    # trailing span to +inf
    spans.append({"xw": cursor, "ww": 10_000_000, "leftGap": prev_gap, "rightGap": None})

    # clip to [0, W]
    visible = []
    for s in spans:
        vx = max(0, s["xw"])
        vw = min(int(W), s["xw"] + s["ww"]) - vx
        if vw > 0:
            visible.append({
                "x": int(vx),
                "w": int(vw),
                "leftGap": s["leftGap"],
                "rightGap": s["rightGap"],
            })
    if not visible:
        visible.append({"x": 0, "w": int(W), "leftGap": prev_gap, "rightGap": None})
    return visible

def drawGapReturns(ctx, state, gaps, topY, botY):
    if not gaps:
        return
    H = int(botY - topY)
    left, right = _get_gap_returns(state["__ud"], H)

    W = ctx.get_width()
    blits = []
    top_i = int(topY)

    for g in gaps:
        L = int(round(g["x"]))
        R = int(round(g["x"] + g["w"]))

        # cull completely off-screen returns
        if R < -8 or L > W:
            continue

        blits.append((left,  (L - 8, top_i)))
        blits.append((right, (R,     top_i)))

    if blits:
        ctx.blits(blits)

def drawUnderdeckFacadeBySpan(ctx, state, topY, botY, W, SAFE_MARGIN=16):
    """
    JS-equivalent behavior:
      • Each gap owns a deterministic g["__theme"].
      • The 'current building' (first span) is the span the player is on (margin=0).
      • We draw with SAFE_MARGIN, but the first span’s theme is locked from the
        no-margin span under the player.
      • IMPORTANT: persist carry theme inside state["__ud"] so it survives the
        shallow copy ({**state, ...}).
    """
    gaps = state.get("deckGaps", []) or []

    # Assign stable ids & themes once per gap
    for g in gaps:
        _stable_gap_gid(state, g)
        if g.get("__theme") is None:
            g["__theme"] = pickThemeIndex(state, g["__gid"])

    ud = state["__ud"]
    prior_carry = ud.get("carryLeftTheme", state.get("__firstSpanTheme", 0))
    carry = prior_carry

    # Sort once; reuse for both span passes
    sgaps = sorted(gaps, key=lambda g: g["x"])

    # Lock carry to the span under the player (no margin)
    pctx = state.get("playerCtx")
    if isinstance(pctx, dict) and ("x" in pctx):
        px = float(pctx["x"])
        spans0 = _spans_from_sorted_gaps(W, sgaps, margin=0)  # no margin for locking
        player_span = None
        for s in spans0:
            if px >= s["x"] and px < (s["x"] + s["w"]):
                player_span = s
                break
        if player_span is not None and player_span["leftGap"] is not None:
            carry = player_span["leftGap"]["__theme"]
        # else: keep prior_carry (e.g., before the first gap)

    # Persist carry so next frame sees it even after gaps get culled
    ud["carryLeftTheme"] = carry
    state["__carryLeftTheme"] = carry  # current-frame convenience

    # Draw visible spans with SAFE_MARGIN (using the same sorted gap list)
    spans = _spans_from_sorted_gaps(W, sgaps, margin=SAFE_MARGIN)
    for span in spans:
        if span["leftGap"] is not None:
            themeIdx = span["leftGap"]["__theme"]
        else:
            # First visible span: use persisted carry
            themeIdx = ud.get("carryLeftTheme", carry)

        # ✅ Always draw when ready; drawSpanFromCache will lazily build the tile if needed.
        if ud.get("ready", False):
            drawSpanFromCache(ctx, state, topY, span["x"], span["w"], themeIdx)
        else:
            # Tiny fallback stripe while cache is initializing
            _fill_rect(ctx, span["x"], topY + 8, span["w"], 2, "#89b2ff", alpha_mul=0.06)

    # Soft returns at gap edges
    drawGapReturns(ctx, state, gaps, topY, botY)

def drawSpanFromCache(ctx, state, topY, startX, spanW, themeIdx):
    ud = state["__ud"]
    tile = ud["cache"][themeIdx]
    if tile is None:
        # build just this theme the first time we need it
        tile = buildTileCanvas(ud["period"], ud["tileH"], themeIdx).convert_alpha()
        ud["cache"][themeIdx] = tile

    period = ud["period"]
    clip_rect = pygame.Rect(int(startX), int(topY), int(spanW), int(ud["tileH"]))
    prev_clip = ctx.get_clip()
    ctx.set_clip(clip_rect)
    try:
        offset = ((state.get("deckScrollX",0) + startX) % period + period) % period
        x = startX - offset - period
        while x < startX + spanW + period:
            ctx.blit(tile, (int(x), int(topY)))
            x += period
    finally:
        ctx.set_clip(prev_clip)