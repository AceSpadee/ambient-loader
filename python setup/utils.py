# utils.py — core helpers used across the Rooftop Cat port
# Exports: clamp, lerp, lerpColor, hsl, shade, pick, pickWeighted, overlap,
#          roundRect, roundRectPath, centerText, neonStrokePath, drawText,
#          get_linear_gradient, drawVerticalGradient

import random
import pygame

__all__ = [
    "clamp","lerp","lerpColor","hsl","shade","pick","pickWeighted","overlap",
    "roundRect","roundRectPath","centerText","neonStrokePath","drawText",
    "get_linear_gradient","drawVerticalGradient",
]

# ---------- simple math ----------

def clamp(v, a, b):
    return max(a, min(b, v))

def lerp(a, b, t):
    return a + (b - a) * t

def lerpColor(a, b, t):
    return {"h": lerp(a["h"], b["h"], t), "s": lerp(a["s"], b["s"], t), "l": lerp(a["l"], b["l"], t)}

# ---------- color helpers ----------

def hsl(c):
    return f"hsl({c['h']} {c['s']}% {c['l']}%)"

def shade(hex_or_rgb, delta):
    """Lighten/darken by percentage delta; returns same-ish type."""
    def adj(n): return max(0, min(255, int(round(n + 255 * (delta/100.0)))))
    if isinstance(hex_or_rgb, (tuple, list)):
        r,g,b = int(hex_or_rgb[0]), int(hex_or_rgb[1]), int(hex_or_rgb[2])
        return (adj(r), adj(g), adj(b))  # NOTE: keep original order below (r,g,b)
    s = str(hex_or_rgb)
    if s.startswith("#") and len(s) == 7:
        r = int(s[1:3], 16); g = int(s[3:5], 16); b = int(s[5:7], 16)
        return f"#{adj(r):02x}{adj(g):02x}{adj(b):02x}"
    r,g,b,a = _parse_color(hex_or_rgb)
    return (adj(r), adj(g), adj(b), a)

def pick(arr):
    # equivalent to random.choice but explicit and not raising on empty in this codebase
    return arr[int(random.random() * len(arr))]

def pickWeighted(pairs):
    total = sum(w for _, w in pairs)
    r = random.random() * total
    for val, w in pairs:
        r -= w
        if r <= 0:
            return val
    return pairs[0][0]

def overlap(x1,y1,w1,h1, x2,y2,w2,h2):
    return (x1 < x2 + w2) and (x1 + w1 > x2) and (y1 < y2 + h2) and (y1 + h1 > y2)

def _parse_color(c):
    if isinstance(c, (tuple, list)):
        if len(c) == 3: return (int(c[0]), int(c[1]), int(c[2]), 255)
        if len(c) == 4: return (int(c[0]), int(c[1]), int(c[2]), int(c[3]))
    s = str(c).strip()

    # ---- HEX forms: #RRGGBB, #RRGGBBAA, #RGB, #RGBA
    if s.startswith("#"):
        if len(s) == 7:  # #RRGGBB
            r = int(s[1:3], 16); g = int(s[3:5], 16); b = int(s[5:7], 16)
            return (r, g, b, 255)
        if len(s) == 9:  # #RRGGBBAA
            r = int(s[1:3], 16); g = int(s[3:5], 16); b = int(s[5:7], 16); a = int(s[7:9], 16)
            return (r, g, b, a)
        if len(s) == 4:  # #RGB
            r = int(s[1]*2, 16); g = int(s[2]*2, 16); b = int(s[3]*2, 16)
            return (r, g, b, 255)
        if len(s) == 5:  # #RGBA
            r = int(s[1]*2, 16); g = int(s[2]*2, 16); b = int(s[3]*2, 16); a = int(s[4]*2, 16)
            return (r, g, b, a)

    if s.startswith("rgba"):
        inside = s[s.find("(")+1:s.rfind(")")]
        pr = [p.strip() for p in inside.split(",")]
        r,g,b = int(pr[0]), int(pr[1]), int(pr[2]); a = float(pr[3])
        a = max(0.0, min(1.0, a))
        return (r,g,b,int(a*255))

    if s.startswith("rgb("):
        inside = s[s.find("(")+1:s.rfind(")")]
        pr = [p.strip() for p in inside.split(",")]
        r,g,b = int(pr[0]), int(pr[1]), int(pr[2])
        return (r,g,b,255)

    if s.startswith("hsl"):
        inside = s[s.find("(")+1:s.rfind(")")]
        parts = inside.replace("%","").split()
        H = float(parts[0]); S = float(parts[1]) / 100.0; L = float(parts[2]) / 100.0
        return _hsl_to_rgba(H,S,L,1.0)

    raise ValueError(f"Unsupported color: {c}")

def _hsl_to_rgba(h,s,l,a=1.0):
    h = (h % 360) / 360.0
    def hue2rgb(p,q,t):
        if t < 0: t += 1
        if t > 1: t -= 1
        if t < 1/6: return p + (q - p) * 6 * t
        if t < 1/2: return q
        if t < 2/3: return p + (q - p) * (2/3 - t) * 6
        return p
    if s == 0:
        r = g = b = l
    else:
        q = l * (1 + s) if l < 0.5 else (l + s - l * s)
        p = 2 * l - q
        r = hue2rgb(p, q, h + 1/3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1/3)
    return (int(round(r*255)), int(round(g*255)), int(round(b*255)), int(round(a*255)))

# ---------- gradients ----------

_GRAD_CACHE = {}

def get_linear_gradient(w, h, c1, c2, horizontal=False):
    key = (int(w), int(h), str(c1), str(c2), 1 if horizontal else 0)
    surf = _GRAD_CACHE.get(key)
    if surf is not None:
        return surf
    surf = pygame.Surface((int(w), int(h)), pygame.SRCALPHA)
    C1 = _parse_color(c1); C2 = _parse_color(c2)
    if horizontal:
        rng = max(1, int(w) - 1)
        for i in range(int(w)):
            t = i / rng
            col = (
                int(C1[0] + (C2[0]-C1[0])*t),
                int(C1[1] + (C2[1]-C1[1])*t),
                int(C1[2] + (C2[2]-C1[2])*t),
                int(C1[3] + (C2[3]-C1[3])*t),
            )
            pygame.draw.line(surf, col, (i, 0), (i, int(h)-1))
    else:
        rng = max(1, int(h) - 1)
        for j in range(int(h)):
            t = j / rng
            col = (
                int(C1[0] + (C2[0]-C1[0])*t),
                int(C1[1] + (C2[1]-C1[1])*t),
                int(C1[2] + (C2[2]-C1[2])*t),
                int(C1[3] + (C2[3]-C1[3])*t),
            )
            pygame.draw.line(surf, col, (0, j), (int(w)-1, j))
    # convert after display init; safe during runtime usage
    try:
        surf = surf.convert_alpha()
    except pygame.error:
        pass
    _GRAD_CACHE[key] = surf
    # soft-cap & prune a small batch to avoid churn
    if len(_GRAD_CACHE) > 256:
        for _ in range(32):
            try:
                _GRAD_CACHE.pop(next(iter(_GRAD_CACHE)))
            except StopIteration:
                break
    return surf

def clear_gradient_cache():
    """Clear cached gradient surfaces."""
    _GRAD_CACHE.clear()

# expose a familiar API so callers can do get_linear_gradient.cache_clear()
get_linear_gradient.cache_clear = clear_gradient_cache

def drawVerticalGradient(surface, c1, c2):
    """Fill an existing surface with a vertical gradient from c1->c2."""
    w, h = surface.get_width(), surface.get_height()
    g = get_linear_gradient(w, h, c1, c2, horizontal=False)
    surface.blit(g, (0, 0))

# ---------- text & shapes ----------

_FONT_CACHE = {}
def _get_font(size, bold=True):
    key = (int(size), bool(bold))
    f = _FONT_CACHE.get(key)
    if f is None:
        if not pygame.font.get_init():
            pygame.font.init()
        f = pygame.font.SysFont(None, int(size), bold=bold)
        _FONT_CACHE[key] = f
    return f

def drawText(surface, text, x, y, size=18, color=(220,225,255)):
    font = _get_font(size, bold=True)
    lines = str(text).split("\n")
    dy = 0
    for line in lines:
        surf = font.render(line, True, color[:3])
        surface.blit(surf, (int(x), int(y + dy)))
        dy += int(size) + 6

def roundRect(ctx, x, y, w, h, r, do_fill=True, fill=None, outline=None, width=1, **kwargs):
    if fill is None and "fill_color" in kwargs:
        fill = kwargs["fill_color"]
    rect = pygame.Rect(int(x), int(y), int(w), int(h))
    r = max(0, int(r))
    if do_fill:
        col = (255,255,255,255) if fill is None else _parse_color(fill)
        pygame.draw.rect(ctx, col, rect, border_radius=r)
    if outline is not None:
        col = _parse_color(outline)
        pygame.draw.rect(ctx, col, rect, int(max(1, width)), border_radius=r)

def roundRectPath(ctx, x, y, w, h, r):
    return pygame.Rect(int(x), int(y), int(w), int(h)), int(max(0,r))

def centerText(ctx, w, h, txt, size=18):
    font = _get_font(size, bold=True)
    color = (217,224,255)
    lines = str(txt).split("\n")
    total_h = len(lines) * (size + 6) - 6
    y0 = h/2 - total_h/2
    for i, line in enumerate(lines):
        surf = font.render(line, True, color)
        rect = surf.get_rect(center=(w/2, y0 + i*(size+6) + size/2))
        ctx.blit(surf, rect.topleft)

def neonStrokePath(ctx, _color, _coreW, _glowW, alpha, makePath):
    """Very lightweight 'neon' look: call makePath(surface) to draw the path twice.
       Note: _color/coreW/glowW are unused by design; the closure should draw styling."""
    W,H = ctx.get_width(), ctx.get_height()
    glow = pygame.Surface((W,H), pygame.SRCALPHA)
    makePath(glow)
    glow.set_alpha(int(alpha*255))
    ctx.blit(glow, (0,0))
    core = pygame.Surface((W,H), pygame.SRCALPHA)
    makePath(core)
    core.set_alpha(255)
    ctx.blit(core, (0,0))
