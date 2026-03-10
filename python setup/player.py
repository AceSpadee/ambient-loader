
# player.py — 1:1 remake of player.js
# Exposes: drawCat(surface, x, y, w, h, t, angle=0, earFlick=0)
# Depends on utils.roundRect and palette.PALETTE.

import math
import pygame
from utils import roundRect, _parse_color
from palette import PALETTE

def _blend_color(c, a_mul):
    r,g,b,a = _parse_color(c)
    A = max(0, min(255, int(round(a * float(a_mul)))))
    return (r, g, b, A)

def _draw_circle_rgba(surf, color, cx, cy, r):
    col = _parse_color(color)
    pygame.draw.circle(surf, col, (int(cx), int(cy)), int(r))

def _draw_line_rgba(surf, color, p1, p2, width=1):
    col = _parse_color(color)
    pygame.draw.line(surf, col,
                     (int(p1[0]), int(p1[1])),
                     (int(p2[0]), int(p2[1])),
                     int(max(1, width)))

def _draw_poly_rgba(surf, color, pts):
    col = _parse_color(color)
    pygame.draw.polygon(surf, col, [(int(x),int(y)) for (x,y) in pts])

def _quadratic_points(x1,y1, cx,cy, x2,y2, steps=22):
    pts=[]
    for i in range(steps+1):
        t = i / steps
        mt = 1 - t
        x = mt*mt*x1 + 2*mt*t*cx + t*t*x2
        y = mt*mt*y1 + 2*mt*t*cy + t*t*y2
        pts.append((x,y))
    return pts

def _stroke_poly_with_round_caps(surf, color, pts, width):
    if len(pts) < 2: return
    col = _parse_color(color)
    pygame.draw.lines(surf, col, False, [(int(x),int(y)) for (x,y) in pts], int(max(1,width)))
    r = max(1, int(width/2))
    _draw_circle_rgba(surf, col, pts[0][0], pts[0][1], r)
    _draw_circle_rgba(surf, col, pts[-1][0], pts[-1][1], r)

def _draw_tail(surf, baseX, baseY, length, lift):
    x1, y1 = baseX, baseY
    x2, y2 = baseX - length * 0.55, baseY - max(-2, lift * 0.6)
    x3, y3 = baseX - length,        baseY - max(0,  lift)

    roundRect(surf, x1 - 3, y1 - 3, 6, 6, 3, True, fill=_parse_color("rgba(169,230,255,0.25)"))

    pts = _quadratic_points(x1, y1, x2, y2, x3, y3, steps=28)

    # tight bounds for a smaller temp surface
    minx = int(min(p[0] for p in pts)) - 4
    miny = int(min(p[1] for p in pts)) - 4
    maxx = int(max(p[0] for p in pts)) + 4
    maxy = int(max(p[1] for p in pts)) + 4
    bw, bh = max(1, maxx - minx), max(1, maxy - miny)

    # shift points into local coords
    shifted = [(px - minx, py - miny) for (px, py) in pts]

    glow = pygame.Surface((bw, bh), pygame.SRCALPHA)
    _stroke_poly_with_round_caps(glow, _parse_color("rgba(180,205,245,0.55)"), shifted, 6)
    surf.blit(glow, (minx, miny))
    _stroke_poly_with_round_caps(surf, _parse_color("rgba(60,90,140,0.95)"), pts, 3)

def _ear_polygon(headAnchorX, headAnchorY, ang):
    pts = [(0,0), (6,-12), (12,0)]
    out = []
    ca = math.cos(ang); sa = math.sin(ang)
    for (x,y) in pts:
        xr = x*ca - y*sa
        yr = x*sa + y*ca
        out.append((headAnchorX + xr, headAnchorY + yr))
    return out

def drawCat(ctx, x, y, w, h, t, angle=0, earFlick=0):
    W, H = int(max(1,w)), int(max(1,h))
    local = pygame.Surface((W, H), pygame.SRCALPHA)

    baseH = 36
    scale = max(0.75, min(1.35, H / baseH))

    bodyW = max(26, int(W * 0.66))
    bodyH = max(18, int(H * 0.72))
    bodyX = 0
    bodyY = H - bodyH

    headW  = max(14, int(W - bodyW + 8))
    headH  = max(12, int(bodyH * 0.58))
    headX  = W - headW - 2
    headY  = bodyY - max(2, int(headH * 0.25))

    legH = max(5, int(H * 0.18))
    legY = H - legH
    stride = math.sin(t * 10.0) * min(2.5 * scale, 3.0)

    blink = 1 if ((t * 0.5) % 5) < 0.12 else 0

    flickK = (0.5 - 0.5 * math.cos(t * 22)) if earFlick else 0.0
    earA = flickK * 0.5

    tailLift = max(-6, min(10, -angle * 40)) + math.sin(t * 4.0) * 2.0

    roundRect(local, -1, 5, W + 2, H - 4, 6, False,
              outline=_parse_color("rgba(0,0,0,0.6)"), width=2)

    roundRect(local, bodyX, bodyY, bodyW, bodyH, 6, True, fill=_parse_color(PALETTE["catMid"]))

    bh_x = bodyX + 4
    bh_y = bodyY + max(2, int(bodyH * 0.35))
    bh_w = max(8, int(bodyW * 0.45))
    bh_h = int(bodyH * 0.45)
    belly = pygame.Surface((bh_w, bh_h), pygame.SRCALPHA)
    pygame.draw.rect(belly, _blend_color(PALETTE["catBody"], 0.25), pygame.Rect(0,0,bh_w,bh_h))
    local.blit(belly, (bh_x, bh_y))

    _draw_tail(local, bodyX + 4, bodyY + int(bodyH * 0.55), max(16, int(18 * scale)), tailLift)

    roundRect(local, headX, headY, headW, headH, 6, True, fill=_parse_color(PALETTE["catBody"]))

    left_anchor = (headX + headW * 0.25, headY + 2)
    right_anchor = (headX + headW * 0.75, headY + 2)
    _draw_poly_rgba(local, PALETTE["catBody"], _ear_polygon(left_anchor[0], left_anchor[1], -earA))
    _draw_poly_rgba(local, PALETTE["catBody"], _ear_polygon(right_anchor[0], right_anchor[1], earA))

    eyeY = headY + int(headH * 0.45)
    eyeR = max(1, int(1.2 * scale))
    eyeLx = headX + int(headW * 0.35)
    eyeRx = headX + int(headW * 0.65)

    if not blink:
        _draw_circle_rgba(local, "rgba(255,255,255,0.9)", eyeLx, eyeY, eyeR)
        _draw_circle_rgba(local, "rgba(255,255,255,0.9)", eyeRx, eyeY, eyeR)
        _draw_circle_rgba(local, "rgba(10,20,30,0.9)", eyeLx, eyeY, max(1, int(eyeR * 0.6)))
        _draw_circle_rgba(local, "rgba(10,20,30,0.9)", eyeRx, eyeY, max(1, int(eyeR * 0.6)))
    else:
        _draw_line_rgba(local, "rgba(10,20,30,0.95)", (eyeLx - eyeR, eyeY), (eyeLx + eyeR, eyeY), width=2)
        _draw_line_rgba(local, "rgba(10,20,30,0.95)", (eyeRx - eyeR, eyeY), (eyeRx + eyeR, eyeY), width=2)

    nose = pygame.Surface((2, 2), pygame.SRCALPHA)
    nose.fill(_parse_color("rgba(250,180,180,0.9)"))
    local.blit(nose, (int(headX + headW * 0.5 - 0.8), int(eyeY + 2)))

    whisk_col = "rgba(200,220,255,0.6)"
    _draw_line_rgba(local, whisk_col, (headX + headW * 0.2, eyeY + 2), (headX - 3, eyeY + 1), width=1)
    _draw_line_rgba(local, whisk_col, (headX + headW * 0.2, eyeY + 4), (headX - 2, eyeY + 4), width=1)
    _draw_line_rgba(local, whisk_col, (headX + headW * 0.8, eyeY + 2), (headX + headW + 3, eyeY + 1), width=1)
    _draw_line_rgba(local, whisk_col, (headX + headW * 0.8, eyeY + 4), (headX + headW + 2, eyeY + 4), width=1)

    col_leg = _parse_color(PALETTE["catLeg"])
    roundRect(local, bodyX + 8,  legY - stride, 10, legH, 3, True, fill=col_leg)
    roundRect(local, bodyX + 20, legY + stride, 10, legH, 3, True, fill=col_leg)

    leg_mid = pygame.Surface((10, int(legH)), pygame.SRCALPHA)
    leg_mid.fill(col_leg); leg_mid.set_alpha(int(0.75 * 255))
    local.blit(leg_mid, (int(bodyX + 32), int(legY + stride * 0.7)))

    deg = (angle * 180.0 / math.pi) if angle else 0.0
    rotated = pygame.transform.rotate(local, -deg)
    rect = rotated.get_rect(center=(x + W * 0.5, y + H * 0.5))
    ctx.blit(rotated, rect.topleft)
