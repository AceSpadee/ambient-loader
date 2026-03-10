# RooftopCat.py — 1:1 style port of RooftopCat.jsx, perf-tuned
# Requires: palette.py, utils.py, scenery.py, weather.py, effects.py, obstacles.py, player.py, drawDeck.py
import json, math, os, random, sys, tempfile, shutil
import pygame

from palette import PALETTE
from utils import clamp, lerpColor, hsl, centerText, overlap, roundRect, drawVerticalGradient
from scenery import makeScenery, drawBuilding
from weather import initWeather, advanceLightning, renderLightning
from effects import updateSteam, spawnPuffs, updatePuffs
from obstacles import spawnObstacle, drawObstacles, prewarm_obstacle_caches
from player import drawCat
from drawDeck import drawDeck, initUnderDeck

PREFS_PATH = os.path.join(os.path.dirname(__file__) if "__file__" in globals() else ".", "rc_prefs.json")
os.environ["SDL_HINT_VIDEO_MINIMIZE_ON_FOCUS_LOSS"] = "0"

# -------- UI helpers (overlay buttons / tabs) --------

def _ui_reset_hits(state):
    state["_ui_hits"] = {}

def _ui_add_hit(state, name, rect):
    # name: a string action id (e.g., "resume", "toggle_fullscreen")
    # rect: pygame.Rect
    state["_ui_hits"][name] = rect

def _ui_button(screen, state, x, y, w, h, label, *, active=False, disabled=False, hotkey=None):
    """Draws a rounded button. Returns its rect and registers it as hit via caller."""
    r = pygame.Rect(int(x), int(y), int(w), int(h))
    bg = (28, 38, 64, 240) if not disabled else (22, 28, 44, 180)
    if active: bg = (40, 60, 100, 255)
    roundRect(screen, r.x, r.y, r.w, r.h, 10, True, fill=bg, outline=(0,0,0,140), width=1)

    text = f"{label}  [{hotkey}]" if hotkey else label
    font = _get_font(22, bold=True)
    fg = font.render(text, True, (230, 238, 255))
    sh = font.render(text, True, (0, 0, 0))
    tx = r.x + (r.w - fg.get_width()) // 2
    ty = r.y + (r.h - fg.get_height()) // 2
    screen.blit(sh, (tx+1, ty+1))
    screen.blit(fg, (tx, ty))
    return r

def _draw_tabs(screen, state, x, y, w, h, active="pause"):
    tabW = int(w // 2)
    tabs_rect = pygame.Rect(int(x), int(y), int(w), int(h))

    roundRect(screen, tabs_rect.x, tabs_rect.y, tabs_rect.w, tabs_rect.h, 10, True, fill=(20, 28, 48, 220))

    rP = pygame.Rect(tabs_rect.x, tabs_rect.y, tabW, tabs_rect.h)
    rS = pygame.Rect(tabs_rect.x + tabW, tabs_rect.y, tabW, tabs_rect.h)
    roundRect(screen, rP.x + 3, rP.y + 3, rP.w - 6, rP.h - 6, 8, True,
              fill=(44, 66, 110, 255) if active == "pause" else (28, 38, 64, 230))
    roundRect(screen, rS.x + 3, rS.y + 3, rS.w - 6, rS.h - 6, 8, True,
              fill=(44, 66, 110, 255) if active == "settings" else (28, 38, 64, 230))

    font = _get_font(22, bold=True)  # ← use global cache
    labP = font.render("Pause", True, (235, 240, 255))
    labS = font.render("Settings", True, (235, 240, 255))
    for r, lab in ((rP, labP), (rS, labS)):
        tx = r.x + (r.w - lab.get_width()) // 2
        ty = r.y + (r.h - lab.get_height()) // 2
        screen.blit(lab, (tx + 1, ty + 1))
        screen.blit(lab, (tx, ty))
    return rP, rS

WINDOW_FLAGS_SCALED = pygame.DOUBLEBUF | pygame.SCALED

# --- Spawn cadence normalization (JS parity) ---
TARGET_SPAWN_SPACING_PX = 520   # average world-space distance between spawn attempts
MIN_SPAWN_TIME          = 0.35   # never faster than this
MAX_SPAWN_TIME          = 1.10   # never slower than this

BASE_DIR   = os.path.dirname(__file__) if "__file__" in globals() else "."
ASSETS_DIR = os.path.join(BASE_DIR, "assets")


# ---------- Per-user, atomic prefs (Steam-safe) ----------
def _user_config_dir() -> str:
    """Return an OS-appropriate per-user config directory for RooftopCat."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "RooftopCat")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
        return os.path.join(base, "RooftopCat")
    else:
        # XDG on Linux; fall back to ~/.config
        base = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
        return os.path.join(base, "rooftopcat")

APP_DIR = _user_config_dir()
os.makedirs(APP_DIR, exist_ok=True)

# New location
PREFS_PATH = os.path.join(APP_DIR, "rc_prefs.json")

# Legacy location (adjust if your old code used a different filename/path)
LEGACY_PREFS_PATH = os.path.join(os.path.dirname(__file__), "rc_prefs.json")


def _maybe_migrate_legacy_prefs():
    """One-time move of old prefs (next to the EXE/py) into the per-user folder."""
    try:
        if os.path.isfile(LEGACY_PREFS_PATH) and not os.path.isfile(PREFS_PATH):
            shutil.copy2(LEGACY_PREFS_PATH, PREFS_PATH)
            # optional: leave the old file as a fallback; or uncomment to remove
            # os.remove(LEGACY_PREFS_PATH)
    except Exception:
        # Non-fatal: ignore migration problems
        pass


def _load_prefs() -> dict:
    """Load JSON prefs; return {} on any error."""
    try:
        with open(PREFS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_prefs(p: dict) -> None:
    """Atomic write of prefs to avoid partial/corrupted files."""
    try:
        fd, tmp = tempfile.mkstemp(prefix="rc_", suffix=".json", dir=APP_DIR)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(p, f, separators=(",", ":"))  # compact JSON
        os.replace(tmp, PREFS_PATH)  # atomic on Windows/macOS/Linux
    except Exception:
        # Non-fatal; prefer to keep the game running
        pass

# tiny cached sprites
_star_cache = {}
def _star(a: int):
    a = 0 if a < 0 else (255 if a > 255 else int(a))
    s = _star_cache.get(a)
    if s is None:
        s = pygame.Surface((2,2), pygame.SRCALPHA)
        s.fill((207,216,255, a))
        _star_cache[a] = s
    return s

_circle_cache = {}
def _circle(radius, rgba):
    key = (int(radius), tuple(rgba))
    s = _circle_cache.get(key)
    if s is None:
        d = int(radius*2 + 2)
        s = pygame.Surface((d, d), pygame.SRCALPHA)
        pygame.draw.circle(s, rgba, (d//2, d//2), int(radius))
        s = s.convert_alpha()
        _circle_cache[key] = s
    return s

# --- HUD text helper (shadowed text, cached fonts)
_hud_font_cache = {}
def _get_font(size, bold=True):
    key = (int(size), bool(bold))
    f = _hud_font_cache.get(key)
    if f is None:
        pygame.font.init()  # safe no-op if already init
        f = pygame.font.SysFont(None, int(size), bold=bold)
        _hud_font_cache[key] = f
    return f

def _make_text_surf(text, size, color, bold=True):
    f = _get_font(size, bold=bold)
    fg = f.render(text, True, color)
    sh = f.render(text, True, (0, 0, 0))
    s = pygame.Surface((fg.get_width() + 1, fg.get_height() + 1), pygame.SRCALPHA)
    s.blit(sh, (1, 1))
    s.blit(fg, (0, 0))
    return s

def _nice_weather_label(val):
    return {
        "none": "Clear",
        "rain": "Rain",
        "snow": "Snow",
        "fog":  "Fog",
        "storm":"Storm",
    }.get(val, str(val).title())

def _nice_time_label(val):
    return {
        "auto":  "Auto",
        "night": "Night",
        "dawn":  "Dawn",
        "day":   "Day",
    }.get(val, str(val).title())

TIME_ORDER    = ("auto", "night", "dawn", "day")
WEATHER_ORDER = ("none", "rain", "snow", "fog", "storm")

def _cycle_time(prefs, cycleModeRef):
    i = TIME_ORDER.index(cycleModeRef[0]) if cycleModeRef[0] in TIME_ORDER else -1
    cycleModeRef[0] = TIME_ORDER[(i + 1) % len(TIME_ORDER)]
    prefs["rc.cycle"] = cycleModeRef[0]

def _cycle_weather(prefs, weatherRef, state, screen, reduceMotion):
    i = WEATHER_ORDER.index(weatherRef[0]) if weatherRef[0] in WEATHER_ORDER else -1
    nxt = WEATHER_ORDER[(i + 1) % len(WEATHER_ORDER)]
    initWeather(nxt, state, screen, reduceMotion)
    weatherRef[0] = nxt
    prefs["rc.weather"] = nxt

if os.name == "nt":
    # Disable SDL's HiDPI logical scaling so window size == drawable size
    os.environ.setdefault("SDL_VIDEO_HIGHDPI_DISABLED", "1")
    try:
        import ctypes
        user32 = ctypes.windll.user32
        # Try PMv2 first (Win10+). Falls back progressively.
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4 & 0xFFFFFFFFFFFFFFFF)
        if hasattr(user32, "SetProcessDpiAwarenessContext"):
            user32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
        else:
            try:
                shcore = ctypes.windll.shcore
                shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
            except Exception:
                user32.SetProcessDPIAware()
    except Exception:
        pass

def _draw_key_badge(screen, label, x, y, *, pad_x=10, pad_y=6):
    """Small rounded pill with a key/mouse label, returns width/height used."""
    font = _get_font(16, bold=True)
    txt  = font.render(label, True, (230, 238, 255))
    w = txt.get_width() + pad_x * 2
    h = txt.get_height() + pad_y * 2
    roundRect(screen, int(x), int(y), int(w), int(h), 8, True,
              fill=(28, 38, 64, 230), outline=(0,0,0,140), width=1)
    screen.blit(txt, (int(x + pad_x), int(y + pad_y)))
    return w, h

def _draw_how_to_panel(screen, state, px, py, pw):
    """Left column: controls only (no tips)."""
    x = px + 24
    y = py
    # header
    header = _make_text_surf("How to play", 22, (235, 240, 255))
    screen.blit(header, (x, y))
    y += header.get_height() + 12

    # Jump
    line1 = _make_text_surf("Jump:", 18, (210, 220, 240))
    screen.blit(line1, (x, y + 2))
    bx = x + line1.get_width() + 10
    _draw_key_badge(screen, "Space", bx, y); bx += 90
    _draw_key_badge(screen, "Right-Click", bx, y)
    y += 40

    # Duck
    line2 = _make_text_surf("Duck (hold):", 18, (210, 220, 240))
    screen.blit(line2, (x, y + 2))
    bx = x + line2.get_width() + 10
    _draw_key_badge(screen, "Down / S", bx, y); bx += 100
    _draw_key_badge(screen, "Left-Click", bx, y)
    y += 40

    # Pause / Menu
    line3 = _make_text_surf("Pause / Menu:", 18, (210, 220, 240))
    screen.blit(line3, (x, y + 2))
    bx = x + line3.get_width() + 10
    _draw_key_badge(screen, "P", bx, y); bx += 58
    _draw_key_badge(screen, "Esc", bx, y)
    y += 40

    # Mobile
    lineM = _make_text_surf("Mobile:", 18, (210, 220, 240))
    screen.blit(lineM, (x, y + 2))
    bx = x + lineM.get_width() + 10
    _draw_key_badge(screen, "Tap right = Jump", bx, y); bx += 180
    _draw_key_badge(screen, "Tap left = Duck",  bx, y)
    y += 48

    # No tips here (right column owns them)
    return y

# Fill the screen when using SCALED (no letterbox). 0=letterbox, 1=overscan/stretch
os.environ.setdefault("SDL_HINT_RENDER_LOGICAL_SIZE_MODE", "1")

# Improve texture scaling quality for SDL’s renderer (0=nearest, 1=linear, 2=best)
os.environ.setdefault("SDL_RENDER_SCALE_QUALITY", "2")

def main():
    pygame.init()
    pygame.display.set_caption("Rooftop Cat")
    try:
        icon = pygame.image.load(os.path.join(ASSETS_DIR, "icon_256.png")).convert_alpha()
        pygame.display.set_icon(icon)
    except Exception:
        pass

    # --- CLI toggles (must be before set_mode to affect vsync)
    args = set(a.lower() for a in sys.argv[1:])

    if "--no-vsync" in args:
        os.environ["SDL_RENDER_VSYNC"] = "0"

    cli_fps = None
    for a in sys.argv[1:]:
        al = a.lower()
        if al.startswith("--fps="):
            try:
                cli_fps = int(al.split("=", 1)[1])
            except Exception:
                pass

    # limit event types (less queue churn)
    pygame.event.set_allowed([pygame.QUIT,
                              pygame.KEYDOWN, pygame.KEYUP,
                              pygame.MOUSEBUTTONDOWN, pygame.MOUSEBUTTONUP,
                              pygame.WINDOWFOCUSLOST, pygame.WINDOWFOCUSGAINED,
                            ])

    try:
        screen = pygame.display.set_mode((1280, 640), WINDOW_FLAGS_SCALED, vsync=1)
    except TypeError:
        screen = pygame.display.set_mode((1280, 640), WINDOW_FLAGS_SCALED)

    _maybe_migrate_legacy_prefs()
    prefs = _load_prefs()
    reduceMotion = prefs.get("rc.rm") == "1"
    bestRef = [int(prefs.get("rc.best", 0))]
    gameState = "ready"
    cycleMode = prefs.get("rc.cycle", "auto")
    weather = prefs.get("rc.weather", "none")

    # mirrors (like React refs)
    reduceMotionRef = [reduceMotion]
    gameStateRef = [gameState]
    cycleModeRef = [cycleMode]
    weatherRef = [weather]
    mobileZoomRef = [1.0]

    # world/state
    state = {
        "t": 0.0,
        "speed": 340.0, "baseSpeed": 340.0, "speedMax": 1200.0, "speedRamp": 36.0,
        "gravity": 2400.0, "jumpVel": -900.0,
        "deckH": 18.0, "deckLip": 4.0,
        "skyline": [], "backTall": [], "frontTall": [],
        "groundY": int(640 * 0.66),
        "obstacles": [], "stars": [], "clouds": [], "puffs": [], "steam": [],
        "rain": [], "snow": [], "fog": [], "fogTex": None,
        "score": 0.0,
        "shakeAmp": 0.0, "shakeT": 0.0, "shakeDur": 0.0,
        "spawnTimer": 0.0, "hitFxT": 0.0,
        "pausedOverlayAlpha": 0.0,
        "hintAlpha": 0.0 if prefs.get("rc.hintDone") == "1" else 1.0,
        "firstJumpDone": prefs.get("rc.hintDone") == "1",
        "playerCtx": {},
        "deckGaps": [], "deckScrollX": 0.0,
        "screen_w": screen.get_width(), "screen_h": screen.get_height(),
        # backbuffers / caches
        "_world": None, "_sky": None, "_sky_phase": None,
        "_starDims": None, "_starRM": None,
        "_cloudDims": None,
        "_df_top": None, "_df_top_w": 0, "_df_top_h": 0, "_df_top_gy": 0,

        "_hud_score": None, "_hud_score_val": -1,
        "_hud_best":  None, "_hud_best_val":  -1,
    }

    # Keep JS parity: tell spawners the logical canvas size they should use
    pc = state.get("playerCtx")
    if not isinstance(pc, dict):
        pc = {}
    pc["canvasW"] = screen.get_width()
    pc["canvasH"] = screen.get_height()
    state["playerCtx"] = pc

    def _recreate_backbuffers():
        w, h = state["screen_w"], state["screen_h"]
        state["_world"] = pygame.Surface((w, h), pygame.SRCALPHA).convert_alpha()
        state["_sky"]   = pygame.Surface((w, h)).convert()
        state["_sky_phase"] = None  # force first paint
        state["_df_top"] = None     # rebuild fog strip
        state["_df_top_w"] = w; state["_df_top_h"] = h; state["_df_top_gy"] = -1
        state["_overlay"]     = pygame.Surface((state["screen_w"], state["screen_h"]), pygame.SRCALPHA).convert_alpha()
        state["_weatherSurf"] = pygame.Surface((state["screen_w"], state["screen_h"]), pygame.SRCALPHA).convert_alpha()

    def _rebuild_after_resize(screen):
        state["screen_w"], state["screen_h"] = screen.get_width(), screen.get_height()
        syncGroundToCanvas()
        _recreate_backbuffers()
        initWeather(weatherRef[0], state, screen, reduceMotionRef[0])
        ensureStarFieldSized()
        ensureCloudBankSized()
        pc = state.get("playerCtx")
        if not isinstance(pc, dict):
            pc = {}
        pc["canvasW"] = screen.get_width()
        pc["canvasH"] = screen.get_height()
        state["playerCtx"] = pc
        _prepaint_sky(screen)
        try:
            import obstacles
            obstacles.get_linear_gradient.cache_clear()
            obstacles.rounded_rect_mask.cache_clear()
        except Exception:
            pass
            
    def enter_borderless_windowed(state):
        """Borderless window that fills the monitor (SDL desktop-fullscreen) without recreating the renderer."""

        # Toggle SDL's desktop-fullscreen on the existing window.
        pygame.display.toggle_fullscreen()

        # Rebuild caches to whatever size SDL picked for the monitor
        screen = pygame.display.get_surface()
        state["screen_w"], state["screen_h"] = screen.get_width(), screen.get_height()
        state["_sky_phase"] = None
        _rebuild_after_resize(screen)

        # Clear spurious resize events from the toggle
        pygame.event.set_blocked(pygame.VIDEORESIZE)
        pygame.event.clear(pygame.VIDEORESIZE)
        return screen

    def _ensure_df_top(w, h, gy):
        # Build depth-fog top strip once per size/gy
        rebuild = (state["_df_top"] is None) or state["_df_top_w"] != w or state["_df_top_h"] != h or state["_df_top_gy"] != gy
        if not rebuild:
            return state["_df_top"]
        surf = pygame.Surface((w, gy), pygame.SRCALPHA)
        # vertical fade (cheaper than per-line draw: fill bands)
        # still keep good gradient; chunk into ~64 steps
        steps = max(8, min(64, gy // 8))
        for i in range(steps):
            yy0 = int(gy * i / steps)
            yy1 = int(gy * (i+1) / steps)
            t = yy0 / max(1, gy-1)
            a = int((1.0 - t) * 0.38 * 255)
            rect = pygame.Rect(0, yy0, w, yy1 - yy0)
            surf.fill((12,18,30,a), rect)
        state["_df_top"] = surf
        state["_df_top_w"] = w; state["_df_top_h"] = h; state["_df_top_gy"] = gy
        return surf
    
    def _prepaint_sky(screen):
        w, h = screen.get_width(), screen.get_height()
        # allocate or resize the cached sky surface
        sky = state.get("_sky")
        if sky is None or sky.get_width() != w or sky.get_height() != h:
            state["_sky"] = pygame.Surface((w, h)).convert()

        # compute the same "phase" the render() uses
        if cycleModeRef[0] == "auto":
            phase = (math.sin(pygame.time.get_ticks() * 0.00005) + 1) / 2
        elif cycleModeRef[0] == "night":
            phase = 0.05
        elif cycleModeRef[0] == "dawn":
            phase = 0.35
        else:
            phase = 0.8

        skyA = hsl(lerpColor(PALETTE["skyA1"], PALETTE["skyA2"], phase))
        skyB = hsl(lerpColor(PALETTE["skyB1"], PALETTE["skyB2"], phase))
        drawVerticalGradient(state["_sky"], skyA, skyB)
        state["_sky_phase"] = phase

    def prewarm_everything(state, screen):
        """Build heavyweight caches up-front so first gameplay frames don’t stutter."""
        w, h = screen.get_width(), screen.get_height()

        # HUD text / overlays / weather surface
        state["_overlay"].fill((0,0,0,0))
        state["_weatherSurf"].fill((0,0,0,0))

        # Depth fog strip & star/cloud banks sized once
        _ = _ensure_df_top(w, h, state["groundY"])
        ensureStarFieldSized()
        ensureCloudBankSized()

        for arr in (state.get("backTall", []), state.get("frontTall", [])):
            for b in arr:
                win = b.get("windows")
                if not win: 
                    continue
                # ensure sets exist so update() never pays this conversion cost
                if not isinstance(win.get("lit"), set):
                    win["lit"] = set(win.get("lit") or [])
                if not isinstance(win.get("litLinear"), set):
                    win["litLinear"] = set(win.get("litLinear") or [])
                if not isinstance(win.get("warm"), set):
                    win["warm"] = set(win.get("warm") or [])

        # Under-deck: one off-screen draw to populate its caches/themes
        tmp = pygame.Surface((max(1, w//2), max(1, (h - state["groundY"])//2)), pygame.SRCALPHA).convert_alpha()
        _sw, _sh = state["screen_w"], state["screen_h"]
        state["screen_w"], state["screen_h"] = tmp.get_width(), tmp.get_height()
        drawDeck(tmp, state)
        state["screen_w"], state["screen_h"] = _sw, _sh

        # Obstacles: rounded-rect masks and type locals
        prewarm_obstacle_caches(screen)

        # Weather lightning internal state (no-op unless storm is active)
        if state.get("storm"):
            advanceLightning(state, 0.001, screen)

    def _clear_world():
        world = state["_world"]
        world.fill((0, 0, 0, 0))
        return world

    # player
    player = {"x":120.0, "y":0.0, "vy":0.0, "w":46.0, "h":36.0, "duckH":24.0, "onGround":True, "earFlickT":2+random.random()*4}

    # jump tuning
    COYOTE = 0.12
    JUMP_BUFFER = 0.12
    MAX_HOLD = 0.24              # was 0.22
    HOLD_GRAVITY_FACTOR = 0.52   # was 0.55 (slightly floatier while holding)
    CUT_GRAVITY_FACTOR  = 2.10   # now used in gravity to make short hops crisp

    inputState = {"duck": False, "jumpBufferT": 0.0, "coyoteT": 0.0, "jumpHeld": False, "jumpHoldT": 0.0,}

    _recreate_backbuffers()

    def calcGroundY():
        return int(screen.get_height() * 0.66)

    def ensureStarFieldSized():
        screenW = state["screen_w"]
        skyH = max(40, int(state["groundY"] - 10))
        prev = state.get("_starDims")
        if (not prev) or prev["w"] != screenW or prev["h"] != skyH or state.get("_starRM") != reduceMotionRef[0]:
            density = 0.5 if reduceMotionRef[0] else 1.0
            target = max(60, int((screenW * skyH)/9000 * density))
            stars = []
            for _ in range(target):
                stars.append({"x": random.random()*screenW, "y": random.random()*skyH, "a": random.random(), "p": random.random()*math.pi*2})
            state["stars"] = stars
            state["_starDims"] = {"w": screenW, "h": skyH}
            state["_starRM"] = reduceMotionRef[0]

    def ensureCloudBankSized():
        screenW = state["screen_w"]
        bandTop = 10
        bandH   = max(60, min(state["groundY"] * 0.35, 180))
        target  = max(4, int(screenW / 180 * 1.2))

        dimsChanged = (not state.get("_cloudDims")) or \
                      state["_cloudDims"]["w"] != screenW or \
                      state["_cloudDims"]["h"] != bandH or \
                      len(state["clouds"]) != target

        if dimsChanged:
            clouds = []
            for _ in range(target):
                s = 0.8 + random.random()*1.6
                w = int(80 + random.random()*180)
                h = int(24 + random.random()*18)
                a = 0.28 + random.random()*0.35

                surf = pygame.Surface((w, h), pygame.SRCALPHA)
                pygame.draw.ellipse(surf, (255, 255, 255, int(255*a)), (0, 0, w, h))
                surf = surf.convert_alpha()

                clouds.append({
                    "x": random.random() * (screenW + 300) - 150,
                    "y": bandTop + random.random() * bandH,
                    "v": 12 + random.random() * 18,
                    "s": s, "a": a,
                    "w": w, "h": h,
                    "surf": surf,
                })
            state["clouds"] = clouds
            state["_cloudDims"] = {"w": screenW, "h": bandH}

    def resetRun(keepScore=False):
        state["t"] = 0; state["speed"] = state["baseSpeed"]
        state["obstacles"].clear()
        if not keepScore: state["score"] = 0.0
        state["shakeAmp"] = state["shakeT"] = state["shakeDur"] = 0.0
        state["spawnTimer"] = 0.2; state["hitFxT"] = 0.0
        state["groundY"] = calcGroundY()
        state["deckGaps"].clear(); state["deckScrollX"] = 0.0

        player["x"] = 120; player["y"] = state["groundY"] - player["h"]; player["vy"] = 0; player["onGround"] = True

        s = makeScenery(state["screen_w"], state["groundY"], reduceMotionRef[0])
        state["stars"] = s["stars"]; state["clouds"] = s["clouds"]; state["skyline"] = s["skyline"]
        state["backTall"] = s["backTall"]; state["frontTall"] = s["frontTall"]
        state["_starDims"] = None; state["_starRM"] = None
        ensureStarFieldSized(); ensureCloudBankSized()

        initWeather(weatherRef[0], state, screen, reduceMotionRef[0])
        initUnderDeck(state)
        _prepaint_sky(screen)
        prewarm_everything(state, screen)

    def syncGroundToCanvas():
        newGY = calcGroundY(); oldGY = state["groundY"]
        if newGY == oldGY: return
        dy = newGY - oldGY
        state["groundY"] = newGY
        state["_starDims"] = None
        state["_df_top"] = None; state["_df_top_gy"] = -1
        ensureStarFieldSized(); ensureCloudBankSized()
        if player["onGround"]:
            targetH = player["duckH"] if inputState["duck"] else player["h"]
            player["y"] = newGY - targetH; player["vy"] = 0
        for o in state["obstacles"]:
            if isinstance(o.get("y"), (int,float)): o["y"] += dy
            if isinstance(o.get("baseY"), (int,float)): o["baseY"] += dy

    screen = enter_borderless_windowed(state)
    # initial scene
    resetRun(); syncGroundToCanvas()

    # Some drivers finalize borderless sizing on the next flip; re-query & rebuild if needed
    pygame.display.flip()
    screen = pygame.display.get_surface()
    if (state["screen_w"], state["screen_h"]) != (screen.get_width(), screen.get_height()):
        _rebuild_after_resize(screen)
    
    def fullyOverGap(px, pw, gaps, padL=10, padR=10):
        """Return True only if the whole bottom span (with padding) is inside ONE gap."""
        if not gaps: 
            return False
        left  = px + padL
        right = px + pw - padR
        for g in gaps:
            gl = g["x"] + padL
            gr = g["x"] + g["w"] - padR
            if left >= gl and right <= gr:
                return True
        return False

    def handleStartOrJump():
        nonlocal gameState
        if gameStateRef[0] == "dead":
            gameState = "playing"; gameStateRef[0] = gameState; resetRun(); return
        if gameStateRef[0] == "ready":
            gameState = "playing"; gameStateRef[0] = gameState
        inputState["jumpBufferT"] = JUMP_BUFFER
        if not state["firstJumpDone"]:
            state["firstJumpDone"] = True; prefs["rc.hintDone"] = "1"; _save_prefs(prefs)

    def update(dt):
        nonlocal gameState

        # --- time & viewport
        state["t"] += dt
        state["screen_w"], state["screen_h"] = screen.get_width(), screen.get_height()
        w, h = state["screen_w"], state["screen_h"]

        z = mobileZoomRef[0]
        worldW = w / z if z < 1 else w
        worldBottom = state["groundY"] + (h - state["groundY"]) / z if z < 1 else h

        # --- speed ramp
        rm = 0.5 if reduceMotionRef[0] else 1.0
        state["speed"] = min(state["speedMax"], state["speed"] + state["speedRamp"] * rm * dt)

        # --- jumping (buffer, coyote, hold)
        inputState["jumpBufferT"] = max(0, inputState["jumpBufferT"] - dt)

        if inputState["jumpBufferT"] > 0.0 and (player["onGround"] or inputState["coyoteT"] > 0.0):
            player["vy"] = state["jumpVel"]          # negative jump velocity
            player["onGround"] = False
            inputState["jumpBufferT"] = 0.0
            inputState["jumpHoldT"] = MAX_HOLD       # allow hold-to-float if they press again quickly
            inputState["coyoteT"] = 0.0

        if inputState.get("jumpHeld") and player["onGround"]:
            player["onGround"] = False
            player["vy"] = state["jumpVel"]
            inputState["jumpHoldT"] = MAX_HOLD
            inputState["jumpBufferT"] = 0
            inputState["coyoteT"] = 0

        # --- gravity with variable-jump shape (hold = floatier, release = sharper)
        baseG = state["gravity"]
        if inputState["duck"]:
            baseG *= 1.08  # slightly heavier while ducking

        effG = baseG
        if player["vy"] < 0:  # still rising
            if inputState.get("jumpHeld") and inputState["jumpHoldT"] > 0:
                # Holding: reduce gravity for a longer, floatier rise
                effG = baseG * HOLD_GRAVITY_FACTOR
                inputState["jumpHoldT"] = max(0.0, inputState["jumpHoldT"] - dt)
            elif not inputState.get("jumpHeld"):
                # Early release: short hop by increasing gravity
                effG = baseG * CUT_GRAVITY_FACTOR
            else:
                # Hold window ended but player is still holding: normal gravity (no extra push down)
                effG = baseG

        player["vy"] += effG * dt

        # --- ground / duck collision (robust; handles duck→stand without falling)
        prevDuck = inputState.get("_prevDuck", inputState["duck"])
        prevPh   = player["duckH"] if prevDuck else player["h"]
        ph       = player["duckH"] if inputState["duck"] else player["h"]

        prevY = player["y"]
        player["y"] += player["vy"] * dt

        prevFeetY = prevY + prevPh
        feetY     = player["y"] + ph

        # Only treat as gap if the whole foot span sits inside one gap
        overGap = fullyOverGap(player["x"], player["w"], state["deckGaps"], padL=12, padR=12)

        # Land only if we crossed the deck from above this step and we're not over a gap
        landingFromAbove = (prevFeetY <= state["groundY"]) and (feetY >= state["groundY"]) and (player["vy"] >= 0)
        canLand = landingFromAbove and (not overGap)

        # Tiny float-jitter catch near the surface
        if (not canLand) and (not overGap) and (player["vy"] >= 0):
            if feetY >= state["groundY"] - 1 and prevFeetY <= state["groundY"] + 10:
                canLand = True

        def _commit_landing():
            player["y"] = state["groundY"] - ph
            if not player["onGround"]:
                spawnPuffs(
                    state,
                    player["x"] + player["w"] * 0.6,
                    state["groundY"] + state["deckH"] - 6,
                    min(10 + abs(player["vy"]) * 0.01, 18),
                    reduceMotionRef[0],
                )
            player["onGround"] = True
            inputState["coyoteT"] = COYOTE
            player["vy"] = 0
            inputState["jumpHoldT"] = 0

        if canLand:
            _commit_landing()
        else:
            player["onGround"] = False

        # coyote runs down while airborne
        if not player["onGround"]:
            inputState["coyoteT"] = max(0, inputState["coyoteT"] - dt)

        # fall death (off-screen)
        if player["y"] > worldBottom + 20:
            gameState = "dead"; gameStateRef[0] = gameState; return

        # --- ambience/parallax/twinkle are part of scenery update

        def moveBuildings(arr, vel):
            for b in arr:
                b["x"] -= vel * dt
                if b["x"] + b["w"] < -80:
                    b["x"] = worldW + random.random() * 240

        def twinkleWindows(arr, dt_local, rateMul=1.0, flipsPerCycle=1, stride=3, phase=0):
            for i, b in enumerate(arr):
                win = b.get("windows")
                if not win:
                    continue

                # convert once, reuse
                lit_js = win.get("lit")
                if not isinstance(lit_js, set):
                    lit_js = set(lit_js or [])
                    win["lit"] = lit_js

                lit_lin = win.get("litLinear")
                if not isinstance(lit_lin, set):
                    lit_lin = set(lit_lin or [])
                    win["litLinear"] = lit_lin

                warm = win.get("warm")
                if not isinstance(warm, set):
                    warm = set(warm or [])
                    win["warm"] = warm

                # rows/cols from scenery; fallback if missing
                rows = int(win.get("rows", 0))
                cols = int(win.get("cols", 0))
                if rows <= 1 or cols <= 1:
                    cellX = int(win.get("cellX", 14 if b.get("scaleFlag") == 2 else 12))
                    cellY = int(win.get("cellY", 18 if b.get("scaleFlag") == 2 else 16))
                    padX, padY = 6, 8
                    rows = max(2, int((b["h"] - 20 - padY * 2) / cellY))
                    cols = max(2, int((b["w"] - 20 - padX * 2) / cellX))
                    win["rows"] = rows
                    win["cols"] = cols

                # rate & timer (with backoff on slow frames)
                base = float(b.get("twinkleRate", 1.6))
                period = max(0.2, base * rateMul)
                if int(state.get("_lastFrameMS", 16)) > 22:
                    period *= 1.25

                t = b.get("twinkleT", 0.0) + dt_local
                if not b.get("_twinkleInit"):
                    b["_twinkleInit"] = True
                    t = random.random() * period * 0.9
                b["twinkleT"] = t

                # spread work across frames
                if (i % max(1, stride)) != (phase % max(1, stride)):
                    continue
                if t < period:
                    continue

                # consume exactly one period
                b["twinkleT"] = t - period

                # flip a few interior cells
                flips = max(1, int(flipsPerCycle))
                if rows < 3 or cols < 3:
                    continue

                for _ in range(flips):
                    r = 1 + int(random.random() * (rows - 2))
                    c = 1 + int(random.random() * (cols - 2))
                    id_js  = r * 1000 + c
                    id_lin = r * cols + c

                    if id_js in lit_js:
                        lit_js.remove(id_js);  lit_lin.discard(id_lin)
                        warm.discard(id_js);   warm.discard(id_lin)
                    else:
                        lit_js.add(id_js);     lit_lin.add(id_lin)
                        if random.random() < 0.75:
                            warm.add(id_js)

                if "litList" in win:       win["litList"] = sorted(lit_js)
                if "litLinearList" in win: win["litLinearList"] = sorted(lit_lin)
                win["version"] = win.get("version", 0) + 1
                b["winStamp"]  = b.get("winStamp", 0) + 1

        # move far/mid/near buildings and twinkle
        moveBuildings(state["skyline"],  state["speed"] * 0.12)
        moveBuildings(state["backTall"], state["speed"] * 0.25)
        moveBuildings(state["frontTall"],state["speed"] * 0.42)

        # twinkle throttling
        last_ms = int(state.get("_lastFrameMS", 16))
        stride = 3 + (1 if last_ms > 22 else 0)
        state["_twk"] = (state.get("_twk", -1) + 1) % stride
        phaseIdx = state["_twk"]

        twinkleWindows(state["backTall"],  dt, rateMul=2.5, flipsPerCycle=1, stride=stride, phase=phaseIdx)
        twinkleWindows(state["frontTall"], dt, rateMul=1.8, flipsPerCycle=1, stride=stride, phase=phaseIdx)


        # --- spawn context for obstacles
        state["playerCtx"] = {
            "x": player["x"], "y": player["y"], "w": player["w"], "h": player["h"], "duckH": player["duckH"],
            "isDucking": bool(inputState["duck"]), "groundY": state["groundY"], "speed": state["speed"],
            "laneTop": state["groundY"] - 110, "laneBottom": state["groundY"] + state["deckH"],
            "canvasW": worldW, "canvasH": worldBottom
        }

        # --- spawn timer (spawns obstacles/gaps)
        state["spawnTimer"] -= dt
        if state["spawnTimer"] <= 0:
            nd = spawnObstacle(state, None)  # obstacles module decides what to spawn
            # nd = "next delay" in seconds (fallback to a sane default)
            if isinstance(nd, (int, float)) and nd > 0:
                state["spawnTimer"] += nd
            else:
                base = 1.08
                speedFactor = 1.0 - (state["speed"] - state["baseSpeed"]) / (state["speedMax"] - state["baseSpeed"] + 1e-6)
                state["spawnTimer"] += base * (0.55 + speedFactor * 0.8) * (0.8 + random.random() * 0.6)

        # --- move & cull obstacles (profiled)
        for o in state["obstacles"]:
            o["x"] -= state["speed"] * dt
        cut = 0
        for o in state["obstacles"]:
            if o["x"] + o["w"] < -80:
                cut += 1
            else:
                break
        if cut:
            del state["obstacles"][:cut]

        # --- under-deck scroll & gaps (profiled)
        state["deckScrollX"] += state["speed"] * dt
        for g in state["deckGaps"]:
            g["x"] -= state["speed"] * dt
        cut = 0
        for g in state["deckGaps"]:
            if g["x"] + g["w"] < -80:
                cut += 1
            else:
                break
        if cut:
            del state["deckGaps"][:cut]

        # --- obstacle collisions (unchanged)
        px, py = player["x"], player["y"]
        pw, ph_vis = player["w"], (player["duckH"] if inputState["duck"] else player["h"])
        prx, pry, prw, prh = px + 2, py + 2, pw - 4, ph_vis - 4

        def buildWTGColliders(o):
            inset = max(10, o["w"] * 0.18)
            legW  = max(4, min(7, o["w"] * 0.08))
            innerL = o["x"] + inset + legW + 2
            innerR = o["x"] + o["w"] - inset - legW - 2
            barW   = max(20, innerR - innerL)
            duckBar = {"x": innerL, "y": o["y"], "w": barW, "h": o["h"]}

            legH = o["clearance"] + o["h"] + (o.get("stem", o.get("stub", 0)))
            legTop    = state["groundY"] - legH
            legL = {"x": o["x"] + inset,            "y": legTop, "w": legW, "h": legH}
            legR = {"x": o["x"] + o["w"]-inset-legW,"y": legTop, "w": legW, "h": legH}
            return [duckBar, legL, legR]

        for o in list(state["obstacles"]):
            rects = (o["colliders"]() if callable(o.get("colliders")) else
                    (buildWTGColliders(o) if o.get("type") == "water_tower_gate"
                    else [{"x": o["x"], "y": o["y"], "w": o["w"], "h": o["h"]}]))
            if any(overlap(prx, pry, prw, prh, r["x"], r["y"], r["w"], r["h"]) for r in rects):
                state["shakeAmp"] = 3 if reduceMotionRef[0] else 6
                state["shakeT"] = 0; state["shakeDur"] = 0.45; state["hitFxT"] = 0.28
                gameState = "dead"; gameStateRef[0] = gameState; return

        # --- particles (safe pre-rails)
        updatePuffs(state, dt)
        updateSteam(state, dt)

        # --- under-deck rail (gap-wall) hitboxes — die if you hit the building below
        udTop = state["groundY"] + state["deckH"] + state["deckLip"]
        udH   = max(0, worldBottom - udTop)
        EDGE_W = 6
        for g in state.get("deckGaps", []):
            lx = g["x"] - EDGE_W
            rx = g["x"] + g["w"]
            if (overlap(prx, pry, prw, prh, lx, udTop, EDGE_W, udH) or
                overlap(prx, pry, prw, prh, rx, udTop, EDGE_W, udH)):
                state["shakeAmp"] = 3 if reduceMotionRef[0] else 6
                state["shakeT"] = 0; state["shakeDur"] = 0.45; state["hitFxT"] = 0.28
                gameState = "dead"; gameStateRef[0] = gameState
                return

        # --- weather step (animate particles + lightning)
        if state.get("storm"):
            advanceLightning(state, dt, screen)

        # Rain
        if state["rain"]:
            for r in state["rain"]:
                r["x"] += r.get("vx", 0.0) * dt
                r["y"] += r.get("vy", 420.0) * dt
                if r["y"] > h + 12:
                    r["x"] = random.random() * w
                    r["y"] = -random.random() * 80

        # Snow
        if state["snow"]:
            for s in state["snow"]:
                t = s.get("t")
                if t is None:
                    t = random.random() * 6.28318
                t += dt
                s["t"] = t
                vx = s.get("vx", 0.0)
                vy = s.get("vy", 36.0)
                sway = math.sin(t) * 18.0
                s["x"] += (vx + sway) * dt
                s["y"] += vy * dt
                if s["y"] > h + 8:
                    s["x"] = random.random() * w
                    s["y"] = -8
                    s["t"] = random.random() * 6.28318

        # --- score & HUD cache (cached text surfaces)
        srScore   = clamp((state["speed"] - state["baseSpeed"]) / (state["speedMax"] - state["baseSpeed"]), 0, 1)
        scoreMult = 0.85 + 1.3 * (srScore ** 1.15)
        state["score"] += dt * state["speed"] * 0.02 * scoreMult

        s = int(state["score"])
        if s != state["_hud_score_val"]:
            state["_hud_score_val"] = s
            # keep your original labels; change to f"{s:,}" if you want just the number
            state["_hud_score"] = _make_text_surf(f"score {s}", 16, (199, 210, 255))

        if s > bestRef[0]:
            bestRef[0] = s
            prefs["rc.best"] = str(s)
            _save_prefs(prefs)

        if bestRef[0] != state["_hud_best_val"]:
            state["_hud_best_val"] = int(bestRef[0])
            state["_hud_best"] = _make_text_surf(f"best {bestRef[0]}", 16, (199, 210, 255))

        # --- screenshake + hint/hit timers
        if state["shakeT"] <= state["shakeDur"]:
            state["shakeT"] += dt
        else:
            state["shakeAmp"] = 0.0

        if state["firstJumpDone"] and state["hintAlpha"] > 0:
            state["hintAlpha"] = max(0, state["hintAlpha"] - dt * 0.8)
        state["hitFxT"] = max(0, state["hitFxT"] - dt)

        # Remember duck state for next frame's landing calc
        inputState["_prevDuck"] = inputState["duck"]

    def render(t_render):
        w, h = screen.get_width(), screen.get_height()

        # day cycle phase
        if cycleModeRef[0] == "auto":
            phase = (math.sin(pygame.time.get_ticks()*0.00005)+1)/2
        elif cycleModeRef[0] == "night":
            phase = 0.05
        elif cycleModeRef[0] == "dawn":
            phase = 0.35
        else:
            phase = 0.8

        skyA = hsl(lerpColor(PALETTE["skyA1"], PALETTE["skyA2"], phase))
        skyB = hsl(lerpColor(PALETTE["skyB1"], PALETTE["skyB2"], phase))

        repaint = (state.get("_sky_phase") is None) or \
                (abs(phase - state["_sky_phase"]) > 0.02) or \
                (state["_sky"].get_width() != w or state["_sky"].get_height() != h)

        if repaint:
            sky = state.get("_sky")
            if sky is None or sky.get_size() != (w, h):
                sky = pygame.Surface((w, h)).convert()
                state["_sky"] = sky
            drawVerticalGradient(sky, skyA, skyB)
            state["_sky_phase"] = phase

        # background sky
        screen.blit(state["_sky"], (0, 0))

        # stars (screen-space)
        night = 1 - phase
        if night > 0.15 and not reduceMotionRef[0]:
            for s in state["stars"]:
                tw = 0.5 + 0.5 * math.sin(t_render*2 + s["p"])
                a = int(255 * (0.2 + s["a"] * tw * (night - 0.1)))
                screen.blit(_star(a), (int(s["x"]), int(s["y"])))

        # lightning
        if state.get("storm"):
            renderLightning(screen, state, screen)

        gy = state["groundY"]
        z = mobileZoomRef[0]
        wld_w = w / z if z < 1 else w
        worldBottom = gy + (h - gy) / z if z < 1 else h

        # depth fog top (cached)
        screen.blit(_ensure_df_top(w, h, gy), (0,0))

        # shake
        sx, sy = 0, 0
        if state["shakeAmp"] > 0 and state["shakeT"] <= state["shakeDur"]:
            k = state["shakeT"] / state["shakeDur"]
            ease = (1 - k) * (1 - k)
            sx = math.sin(state["shakeT"] * 40) * state["shakeAmp"] * ease
            sy = math.cos(state["shakeT"] * 32) * state["shakeAmp"] * 0.6 * ease

        # ===== world layer =====
        world = _clear_world()

        # --- SKY/BACKGROUND: clouds + skyline + window overlays + fog

        # clouds (draw to world; quick cull)
        if not reduceMotionRef[0]:
            for cl in state["clouds"]:
                x = int(cl["x"])
                if x > w or x + cl["w"] < -2:
                    continue
                world.blit(cl["surf"], (x, int(cl["y"])))


        # skyline silhouettes (extend)
        extendBy = worldBottom - gy
        for b in state["skyline"]:
            extH = b["h"] + extendBy; yExt = worldBottom - extH
            roundRect(world, b["x"], yExt, b["w"], extH, 6 if b.get("roof")=="spike" else 2, True, fill=(9,17,32))

        def _draw_window_overlay(world_surf, B, yExt, extH, strength=1.0):
            win = B.get("windows")
            if not win:
                return

            rows = int(win.get("rows", 0))
            cols = int(win.get("cols", 0))
            padX = int(win.get("padX", 6))
            padY = int(win.get("padY", 8))
            cellX = int(win.get("cellX", 14 if B.get("scaleFlag") == 2 else 12))
            cellY = int(win.get("cellY", 18 if B.get("scaleFlag") == 2 else 16))
            if rows <= 1 or cols <= 1:
                rows = max(2, (extH - padY * 2) // max(1, cellY))
                cols = max(2, (int(B["w"]) - padX * 2) // max(1, cellX))

            lit_lin = win.get("litLinear")
            lit_js  = win.get("lit")
            if isinstance(lit_lin, set) and lit_lin:
                ids = lit_lin; use_linear = True
            elif isinstance(lit_js, set) and lit_js:
                ids = lit_js;  use_linear = False
            else:
                return

            warm = win.get("warm") or set()

            startX, startY = padX, padY
            wW, wH = 3, 5
            k = float(strength)
            warm_col = (255, 186, 107, int(120 * k))
            cool_col = (170, 200, 255, int(80  * k))
            BLEND = pygame.BLEND_RGBA_ADD

            for idx in ids:
                if use_linear:
                    r = idx // cols; c = idx % cols
                    is_warm = (idx in warm) or ((r * 1000 + c) in warm)
                else:
                    r = idx // 1000; c = idx % 1000
                    is_warm = (idx in warm) or ((r * cols + c) in warm)

                if not (0 <= r < rows and 0 <= c < cols):
                    continue

                cx = int(B["x"] + startX + c * cellX)
                cy = int(yExt  + startY + r * cellY)

                world_surf.fill(
                    (warm_col if is_warm else cool_col),
                    pygame.Rect(cx, cy, wW, wH),
                    special_flags=BLEND
                )

        # back & front buildings (full-height)
        W = world.get_width()
        for b in state["backTall"]:
            if b["x"] + b["w"] < -2 or b["x"] > W + 2:
                continue
            extH = b["h"] + extendBy
            yExt = worldBottom - extH
            drawBuilding(world, {**b, "y": yExt, "h": extH, "winVer": b.get("winStamp", 0)},
                        alpha_override=0.46)
            _draw_window_overlay(world, b, yExt, extH, strength=0.55)

        for b in state["frontTall"]:
            if b["x"] + b["w"] < -2 or b["x"] > W + 2:
                continue
            extH = b["h"] + extendBy
            yExt = worldBottom - extH
            drawBuilding(world, {**b, "y": yExt, "h": extH, "winVer": b.get("winStamp", 0)},
                        alpha_override=0.95)
            _draw_window_overlay(world, b, yExt, extH, strength=1.0)

        # fog blobs (world-space)
        if state["fog"] and state["fogTex"]:
            for f in state["fog"]:
                top = gy - 180
                fade = clamp((f["y"] - top) / 220.0, 0, 1)
                a = f["a"] * fade * (0.9 if reduceMotionRef[0] else 1.0)
                if a <= 0.01: continue
                tex = state["fogTex"]
                tex.set_alpha(int(a*255))
                world.blit(tex, (int(f["x"]-f["r"]), int(f["y"]-f["r"])))
                tex.set_alpha(None)


        # --- DECK/FACADE
        _sw_prev, _sh_prev = state["screen_w"], state["screen_h"]
        state["screen_w"], state["screen_h"] = int(wld_w), int(worldBottom)
        drawDeck(world, state)
        state["screen_w"], state["screen_h"] = _sw_prev, _sh_prev

        # --- PARTICLES (world)
        for s in state["steam"]:
            if s["a"] <= 0: continue
            world.blit(_circle(s["r"], (207,230,255, int(255*max(0,min(1,s["a"]))))),
                    (int(s["x"]-s["r"]-1), int(s["y"]-s["r"]-1)))
        for p in state["puffs"]:
            if p["a"] <= 0: continue
            world.blit(_circle(p["r"], (159,180,216, int(255*max(0,min(1,p["a"]))))),
                    (int(p["x"]-p["r"]-1), int(p["y"]-p["r"]-1)))

        # --- OBSTACLES
        drawObstacles(world, state, t_render)

        # player
        ph = player["duckH"] if inputState["duck"] else player["h"]
        angle = clamp(player["vy"] * 0.0006, -0.25, 0.25)
        drawCat(world, player["x"], player["y"], player["w"], ph, t_render, angle, 1 if player["earFlickT"] < 0.2 else 0)

        # composite world with shake
        screen.blit(world, (int(sx), int(sy)))

        # --- WEATHER (screen-space)
        if state["rain"]:
            ws = state["_weatherSurf"]
            ws.set_alpha(None)
            ws.fill((0,0,0,0))
            for r in state["rain"]:
                x1,y1 = r["x"], r["y"]; x2,y2 = r["x"] + r["vx"]*0.02, r["y"] + r["vy"]*0.02
                pygame.draw.line(ws, (200,220,255, int(0.5*255)), (x1,y1), (x2,y2), 1)
            ws.set_alpha(int(0.65*255)); screen.blit(ws, (0,0)); ws.set_alpha(None)
        if state["snow"]:
            W, H = int(state["screen_w"]), int(state["screen_h"])
            rgba = (240, 246, 255, 230)
            for s in state["snow"]:
                r = int(s["r"])
                x = float(s["x"]); y = float(s["y"])
                if x < -r - 8 or x > W + r + 8 or y < -r - 8 or y > H + r + 8:
                    continue
                surf = s.get("surf")
                if (surf is None) or (s.get("surfKey") != r):
                    surf = _circle(r, rgba)
                    s["surf"] = surf; s["surfKey"] = r
                screen.blit(surf, (int(x - r), int(y - r)), special_flags=pygame.BLEND_RGBA_ADD)

        if state["hintAlpha"] > 0 and gameStateRef[0] == "playing":
            hintText = "Hold left click to duck • Right click / Space to jump"
            overlay = state["_overlay"]
            overlay.fill((0,0,0,0))
            overlay.set_alpha(int(state["hintAlpha"]*255))
            screen.blit(overlay, (0,0))
            overlay.set_alpha(None)
            centerText(screen, w, int(h*0.3), hintText, 18)

        elif gameStateRef[0] == "dead":
            overlay = state["_overlay"]
            overlay.fill((0,0,0,0))
            overlay.fill((6,9,19, int(0.35*255)))
            screen.blit(overlay, (0,0))
            finalScore = int(state["score"])
            deadText = f"Score: {finalScore}\nBest: {bestRef[0]}\nClick to retry / Space"
            centerText(screen, w, h, deadText, 18)

        if state["hitFxT"] > 0:
            flash = state["_overlay"]
            flash.fill((0,0,0,0))
            flash.fill((255,255,255, int(min(0.25, state["hitFxT"]*0.6) * 255)))
            screen.blit(flash, (0,0))

        # --- HUD: score + best (top-right, screen space)
        if gameStateRef[0] in ("playing", "paused"):
            score_surf = state.get("_hud_score")
            best_surf  = state.get("_hud_best")

            if score_surf or best_surf:
                pad = 14  # add a little breathing room from the edge

                sw = score_surf.get_width() if score_surf else 0
                bw = best_surf.get_width()  if best_surf  else 0
                y = pad

                if score_surf:
                    screen.blit(score_surf, (w - sw - pad, y))
                    y += score_surf.get_height() + 4  # stack best underneath

                if best_surf:
                    screen.blit(best_surf,  (w - bw - pad, y))

        # -------- Overlay UI: Start / Pause + Settings --------
        gs = gameStateRef[0]
        if gs in ("ready", "paused"):
            _ui_reset_hits(state)
            # Dim background
            if "_overlay" not in state or state["_overlay"].get_size() != screen.get_size():
                state["_overlay"] = pygame.Surface(screen.get_size(), pygame.SRCALPHA)
            overlay = state["_overlay"]; overlay.fill((0,0,0,0))
            overlay.fill((10,16,28, 180 if gs == "paused" else 210))
            screen.blit(overlay, (0,0))

            W, H = screen.get_width(), screen.get_height()
            # Panel
            panelW = min(720, int(W*0.86)); panelH = min(460, int(H*0.78))
            px = (W - panelW)//2; py = (H - panelH)//2
            roundRect(screen, px, py, panelW, panelH, 16, True, fill=(16,22,38,240), outline=(0,0,0,160), width=1)

            # Header
            title = state.get("_title_surf")
            if not title:
                title = _make_text_surf("Rooftop Cat", 28, (235,240,255))
                state["_title_surf"] = title
            screen.blit(title, (px + 18, py + 14))
            
            if gs == "ready":
                bx = px + 24
                bw = panelW - 48
                by = py + 84

                if state.get("_ready_settings"):
                    # ===============================
                    # START-SCREEN SETTINGS VIEW
                    # ===============================
                    # Back
                    r_back = _ui_button(screen, state, bx, by, bw, 46, "Back")
                    _ui_add_hit(state, "ready_settings_back", r_back)
                    by += 60

                    # Weather
                    label_w = f"Cycle Weather (R) — {_nice_weather_label(weatherRef[0])}"
                    r_weather = _ui_button(screen, state, bx, by, bw, 46, label_w)
                    _ui_add_hit(state, "toggle_weather", r_weather)
                    by += 54

                    # Time of day
                    label_t = f"Cycle Time of Day (T) — {_nice_time_label(cycleModeRef[0])}"
                    r_time = _ui_button(screen, state, bx, by, bw, 46, label_t)
                    _ui_add_hit(state, "toggle_time", r_time)
                    by += 54

                else:
                    # ===============================
                    # MAIN START SCREEN VIEW
                    # ===============================
                    # Play
                    r_play = _ui_button(screen, state, bx, by, bw, 64, "Play", active=True, hotkey="Enter")
                    _ui_add_hit(state, "play_from_ready", r_play)
                    by += 80

                    # Settings
                    r_settings = _ui_button(screen, state, bx, by, bw, 46, "Settings")
                    _ui_add_hit(state, "open_settings_from_ready", r_settings)
                    by += 60

                    # Exit Game
                    r_exit = _ui_button(screen, state, bx, by, bw, 46, "Exit Game")
                    _ui_add_hit(state, "exit_game", r_exit)
                    by += 60

                # Two-column content area — only on MAIN start screen
                if not state.get("_ready_settings"):
                    inner_l = px + 24
                    col_gap = 24
                    leftW  = int((panelW - 48 - col_gap) * 0.58)  # you can tweak 0.58
                    rightW = (panelW - 48 - col_gap) - leftW
                    leftX  = inner_l
                    rightX = inner_l + leftW + col_gap
                    contentTop = by

                    # LEFT: Controls (no tips)
                    _draw_how_to_panel(screen, state, leftX - 24, contentTop, leftW + 48)

                    # RIGHT: Tips & Scores
                    y = contentTop
                    head = _make_text_surf("Tips & scores", 22, (235, 240, 255))
                    screen.blit(head, (rightX, y))
                    y += head.get_height() + 12

                    tips = [
                        "Avoid obstacles • Jump gaps • Duck under low wires",
                        "T: Time of day • R: Weather • Best score is saved",
                    ]
                    for tip in tips:
                        tip_surf = _make_text_surf(tip, 16, (199, 210, 255))
                        if tip_surf.get_width() > rightW:
                            tip_surf = _make_text_surf(tip, 15, (199, 210, 255))
                        screen.blit(tip_surf, (rightX, y))
                        y += tip_surf.get_height() + 6

                    y += 10
                    curr_line = _make_text_surf(f"Score: {int(state['score']):,}", 18, (210, 220, 240))
                    best_line = _make_text_surf(f"Best:  {bestRef[0]:,}",       18, (210, 220, 240))
                    screen.blit(curr_line, (rightX, y)); y += curr_line.get_height() + 6
                    screen.blit(best_line, (rightX, y))

            else:
                # ===============================
                # PAUSE OVERLAY (with tabs)
                # ===============================
                bx = px + 24
                bw = panelW - 48
                by = py + 64

                # Tabs (Pause | Settings)
                active_tab = state.get("_ui_tab", "pause")
                rP, rS = _draw_tabs(screen, state, bx, by, bw, 40, active=active_tab)
                _ui_add_hit(state, "tab_pause",    rP)
                _ui_add_hit(state, "tab_settings", rS)
                by += 56  # below the tabs

                if active_tab == "pause":
                    # Resume
                    r_resume = _ui_button(screen, state, bx, by, bw, 46, "Resume", hotkey="P / Esc")
                    _ui_add_hit(state, "resume", r_resume)
                    by += 56

                    # Restart
                    r_restart = _ui_button(screen, state, bx, by, bw, 46, "Restart")
                    _ui_add_hit(state, "restart", r_restart)
                    by += 56

                    # Main Menu
                    r_menu = _ui_button(screen, state, bx, by, bw, 46, "Main Menu")
                    _ui_add_hit(state, "main_menu", r_menu)
                    by += 56

                else:
                    # SETTINGS TAB (same actions as start-screen settings)
                    label_w = f"Cycle Weather (R) — {_nice_weather_label(weatherRef[0])}"
                    r_weather = _ui_button(screen, state, bx, by, bw, 46, label_w)
                    _ui_add_hit(state, "toggle_weather", r_weather)
                    by += 54

                    label_t = f"Cycle Time of Day (T) — {_nice_time_label(cycleModeRef[0])}"
                    r_time = _ui_button(screen, state, bx, by, bw, 46, label_t)
                    _ui_add_hit(state, "toggle_time", r_time)
                    by += 54

    # main loop — fixed timestep update, render once per frame
    TARGET_FPS = cli_fps if (cli_fps and cli_fps > 0) else 60
    LOGIC_HZ   = 120
    FIXED_DT   = 1.0 / LOGIC_HZ
    clock = pygame.time.Clock()
    running = True
    state["_accum"] = 0.0
    USE_BUSY_LOOP = False 

    while running:
        # events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            elif event.type == pygame.KEYDOWN:
                k = event.key
                if gameStateRef[0] == "paused":
                    # resume keys
                    if k in (pygame.K_p, pygame.K_ESCAPE, pygame.K_RETURN):
                        gameStateRef[0] = "playing"
                    # tab switch
                    elif k == pygame.K_TAB:
                        state["_ui_tab"] = ("settings" if state.get("_ui_tab") == "pause" else "pause")
                    # swallow others while paused
                    continue
                else:
                    # start from ready with Enter
                    if gameStateRef[0] == "ready" and k in (pygame.K_RETURN, pygame.K_KP_ENTER):
                        gameStateRef[0] = "playing"
                        continue

                    # gameplay hotkeys
                    if k in (pygame.K_SPACE, pygame.K_UP, pygame.K_w):
                        handleStartOrJump(); inputState["jumpHeld"] = True
                    elif k in (pygame.K_DOWN, pygame.K_s):
                        inputState["duck"] = True
                    elif k in (pygame.K_p, pygame.K_ESCAPE):
                        # --- Pause / Unpause ---
                        if gameStateRef[0] == "playing":
                            gameStateRef[0] = "paused"
                            state["_ready_settings"] = False
                            state["_ui_tab"] = state.get("_ui_tab", "pause")
                        elif gameStateRef[0] == "paused":
                            gameStateRef[0] = "playing"
                    elif k == pygame.K_t:
                        _cycle_time(prefs, cycleModeRef); _save_prefs(prefs)
                    elif k == pygame.K_r:
                        _cycle_weather(prefs, weatherRef, state, screen, reduceMotionRef[0]); _save_prefs(prefs)
                        continue
            elif event.type == pygame.KEYUP:
                if event.key in (pygame.K_SPACE, pygame.K_UP, pygame.K_w):
                    inputState["jumpHeld"] = False
                if event.key in (pygame.K_DOWN, pygame.K_s):
                    inputState["duck"] = False
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if gameStateRef[0] in ("paused", "ready"):
                    pos = event.pos
                    hits = state.get("_ui_hits", {})
                    for name, rect in hits.items():
                        if rect.collidepoint(pos):
                            if name == "tab_pause":
                                state["_ui_tab"] = "pause"
                            elif name == "tab_settings":
                                state["_ui_tab"] = "settings"
                            elif name == "play_from_ready":
                                gameStateRef[0] = "playing"
                            elif name == "resume":
                                gameStateRef[0] = "playing"
                            elif name == "restart":
                                resetRun()
                                gameStateRef[0] = "playing"
                            elif name == "main_menu":
                                resetRun()
                                gameStateRef[0] = "ready"
                            elif name == "toggle_time":
                                _cycle_time(prefs, cycleModeRef); _save_prefs(prefs)
                            elif name == "toggle_weather":
                                _cycle_weather(prefs, weatherRef, state, screen, reduceMotionRef[0]); _save_prefs(prefs)
                            elif name == "open_settings_from_ready":
                                state["_ready_settings"] = True
                            elif name == "ready_settings_back":
                                state["_ready_settings"] = False
                            elif name == "exit_game":
                                pygame.event.post(pygame.event.Event(pygame.QUIT))
                            break

                    # clicks outside buttons do nothing while overlay is up
                    continue
            elif event.type == pygame.MOUSEBUTTONUP:
                if inputState["duck"]:
                    inputState["duck"] = False
                if inputState["jumpHeld"]:
                    inputState["jumpHeld"] = False
            elif event.type == pygame.WINDOWFOCUSLOST:
                # Auto-pause when the window loses focus (borderless-friendly)
                if gameStateRef[0] == "playing":
                    gameStateRef[0] = "paused"
                    state["_ready_settings"] = False
                    state["_ui_tab"] = state.get("_ui_tab", "pause")

            elif event.type == pygame.WINDOWFOCUSGAINED:
                # Don't auto-unpause; just leave the overlay up
                pass

        # timing
        # Clamp dt to avoid giant physics steps after stalls/alt-tab
        dt = (clock.tick_busy_loop(TARGET_FPS) if USE_BUSY_LOOP else clock.tick(TARGET_FPS)) / 1000.0
        dt = max(0.0, min(dt, 0.05))
        state["_lastFrameMS"] = clock.get_rawtime()
        state["_accum"] += min(dt, 0.25)
        while state["_accum"] >= FIXED_DT:
            if gameStateRef[0] == "playing":
                update(FIXED_DT)
            state["_accum"] -= FIXED_DT
        alpha    = state["_accum"] / FIXED_DT
        t_render = state["t"] + alpha * FIXED_DT
        render(t_render)
        pygame.display.flip()

    pygame.quit()

if __name__ == "__main__":
    import traceback, time
    try:
        main()
        sys.exit(0)  # explicit success exit for Steam
    except SystemExit as e:
        raise  # allow sys.exit() to work
    except Exception as ex:
        log = os.path.join(APP_DIR, "crash.log")
        with open(log, "a", encoding="utf-8") as f:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            f.write(f"\n[{ts}] {repr(ex)}\n{traceback.format_exc()}\n")
        # optional: show a very small msgbox or print path to log
        sys.exit(1)
