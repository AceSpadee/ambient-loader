
# roofBlocks.py — 1:1 remake of roofBlocks.js
# (data + splitting logic only; no drawing here)
#
# API:
#   randomTheme() -> { base: str, variants: [str,str,str] }
#   pickVariant(theme) -> str
#   initRoofBlocks(state, canvas)
#   updateRoofBlocks(state, dt, canvas)
#
# Notes:
# - canvas is optional in Python; if None, we use state['screen_w'].
# - We keep the exact field names used in JS: roofBlocks, roofTheme, roofSeams.
# - Colors remain hex strings; we rely on utils.shade for variant generation.

import random

from utils import shade

__all__ = [
    "randomTheme",
    "pickVariant",
    "initRoofBlocks",
    "updateRoofBlocks",
]

# ---- themes ---------------------------------------------------------------

BASES = (
    "#121a2c","#0f1628","#10182b","#141c30",
    "#0e1526","#121a2b","#0d1323",
)

def randomTheme():
    base = random.choice(BASES)
    return { "base": base, "variants": [base, shade(base, -8), shade(base, -14)] }

def pickVariant(theme):
    vs = theme.get("variants") if isinstance(theme, dict) else None
    if not vs:
        base = theme.get("base") if isinstance(theme, dict) else "#121a2c"
        vs = [base]
    return random.choice(vs)

# ---- helpers --------------------------------------------------------------
def _canvas_width_from_arg_or_state(canvas, state):
    # JS divides by DPR; here we assume DPR ≈ 1. If a pygame.Surface is passed, use get_width().
    if canvas is None:
        return int(state.get("screen_w", 1280))
    # pygame.Surface
    try:
        return int(canvas.get_width())
    except AttributeError:
        pass
    # dict-like with 'width'
    try:
        w = canvas["width"]
        # If caller provided raw pixel width at high-DPI and a 'dpr', divide it.
        dpr = canvas.get("dpr", 1) if isinstance(canvas, dict) else 1
        return int(w / max(1, dpr))
    except (TypeError, KeyError):
        pass
    # numeric
    if isinstance(canvas, (int, float)):
        return int(canvas)
    return int(state.get("screen_w", 1280))

# ---- init -----------------------------------------------------------------
def initRoofBlocks(state, canvas=None):
    w = _canvas_width_from_arg_or_state(canvas, state)

    state["roofBlocks"] = []
    state["roofTheme"]  = randomTheme()
    state["roofSeams"]  = []  # moving seam markers dropped by skylights

    # prefill across screen
    x = -40.0
    while x < w + 260.0:
        bw = 90.0 + random.random()*160.0
        state["roofBlocks"].append({ "x": x, "w": bw, "col": pickVariant(state["roofTheme"]), "panels": True })
        x += bw

# ---- update (move, split at seams, then fill right) -----------------------
def updateRoofBlocks(state, dt, canvas=None):
    blocks = state.get("roofBlocks") or []
    seams  = state.get("roofSeams")  or []
    state["roofBlocks"] = blocks
    state["roofSeams"]  = seams

    speed  = state.get("speed", 300.0)

    # move world
    for b in blocks:
        b["x"] = b.get("x", 0.0) - speed * dt
    for s in seams:
        s["x"] = s.get("x", 0.0) - speed * dt

    # --- split any block a seam falls inside
    seamW  = 4.0   # visual “gap” width
    minSeg = 8.0   # don't create slivers

    i = len(seams) - 1
    while i >= 0:
        sx = seams[i].get("x", 0.0)

        # find containing block
        bi = -1
        for j, b in enumerate(blocks):
            bx = b.get("x", 0.0); bw = b.get("w", 0.0)
            if sx > bx and sx < bx + bw:
                bi = j
                break
        if bi == -1:
            i -= 1
            continue

        b = blocks[bi]
        bx = b.get("x", 0.0); bw = b.get("w", 0.0)
        leftW  = max(0.0, sx - bx)
        rightW = max(0.0, (bx + bw) - sx)

        # If either side would be a tiny sliver, skip this seam gracefully.
        if leftW < minSeg or rightW < minSeg:
            seams.pop(i)
            i -= 1
            continue

        # Clamp seam strip to the available right side
        seamWidth = min(seamW, rightW)

        # new pieces replacing block b
        pieces = []

        # left piece (same theme)
        pieces.append({ "x": bx, "w": leftW, "col": b.get("col"), "panels": b.get("panels", True) })

        # seam strip (dark, no panels)
        seamX = bx + leftW
        pieces.append({ "x": seamX, "w": seamWidth, "col": "#0a0f1a", "panels": False })

        # right piece (switch to a new theme color)
        remain = rightW - seamWidth
        if remain >= minSeg:
            state["roofTheme"] = randomTheme()  # switch building style
            pieces.append({ "x": seamX + seamWidth, "w": remain, "col": pickVariant(state["roofTheme"]), "panels": True })

        # replace original with pieces
        blocks[bi:bi+1] = pieces

        # consume this seam
        seams.pop(i)
        i -= 1

    # cull left
    while blocks and (blocks[0].get("x",0.0) + blocks[0].get("w",0.0) < -80.0):
        blocks.pop(0)
    j = len(seams) - 1
    while j >= 0:
        if seams[j].get("x", 0.0) < -120.0:
            seams.pop(j)
        j -= 1

    # fill right
    canvasW = _canvas_width_from_arg_or_state(canvas, state)
    rightX = (blocks[-1]["x"] + blocks[-1]["w"]) if blocks else -40.0

    FILL_MARGIN = 260.0
    while rightX < canvasW + FILL_MARGIN:
        bw = 90.0 + random.random()*160.0
        blocks.append({ "x": rightX, "w": bw, "col": pickVariant(state["roofTheme"]), "panels": True })
        rightX += bw
