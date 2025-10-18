import React, { useEffect, useRef, useState } from "react";
import { PALETTE } from "./palette.js";
import { clamp, lerpColor, hsl, centerText, overlap, roundRect } from "./utils.js";
import { makeScenery, drawCloud, drawBuilding } from "./scenery.js";
import { initWeather, advanceLightning, renderLightning } from "./weather.js";
import { emitSteam, updateSteam, spawnPuffs, updatePuffs } from "./effects.js";
import { spawnObstacle, drawObstacles } from "./obstacles.js";
import { drawCat } from "./player.js";

// Modular deck + under-deck wall
import { drawDeck, initUnderDeck } from "./drawDeck.js";

const NO_SELECT = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
};

export default function RooftopCat() {
  const canvasRef = useRef(null);
  const effDprRef = useRef(1);
  const mobileZoomRef = useRef(1);
  const gameApiRef = useRef(null);

  // UI/state
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("rc.rm")==="1");
  const [best, setBest] = useState(() => Number(localStorage.getItem("rc.best") || 0));
  const [gameState, setGameState] = useState("ready"); // ready | playing | paused | dead
  const [cycleMode, setCycleMode] = useState(() => localStorage.getItem("rc.cycle") || "auto"); // auto|night|dawn|day
  const [weather, setWeather] = useState(() => localStorage.getItem("rc.weather") || "none"); // none|rain|snow|fog|storm
  const [isMobileUI, setIsMobileUI] = useState(false);

  const reduceMotionRef = useRef(reduceMotion);
  const gameStateRef = useRef(gameState);
  const cycleModeRef = useRef(cycleMode);
  const weatherRef = useRef(weather);

  // Live “best” mirror used by canvas HUD
  const bestRef = useRef(best);

  useEffect(() => { reduceMotionRef.current = reduceMotion; localStorage.setItem("rc.rm", reduceMotion? "1":"0"); }, [reduceMotion]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { cycleModeRef.current = cycleMode; localStorage.setItem("rc.cycle", cycleMode); }, [cycleMode]);
  useEffect(() => { weatherRef.current = weather; localStorage.setItem("rc.weather", weather); }, [weather]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function isMobileLike(){
      const hasMM = typeof window.matchMedia === "function";
      return (
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        (hasMM && window.matchMedia("(pointer: coarse)").matches) ||
        ("ontouchstart" in window)
      );
    }

    const MOBILE_EASE = 0.80;

    // ---------- sizing & DPR ----------
    function resize() {
      const vw = Math.floor(window.innerWidth);

      const vvH = window.visualViewport?.height || 0;
      const ih  = window.innerHeight || 0;
      const onMobile = isMobileLike();
      const vh = Math.floor(onMobile ? Math.max(ih, vvH) : ih);

      const rawDpr  = window.devicePixelRatio || 1;
      const dprCap  = onMobile ? 1.25 : 2.0;
      const quality = onMobile ? 0.80 : 1.00;
      const effDpr  = Math.max(1, Math.min(dprCap, rawDpr * quality));
      effDprRef.current = effDpr;

      // Mobile camera zoom (render-only)
      const vwForZoom = Math.min(vw, Math.floor(window.visualViewport?.width || vw));
      let z = 1;
      if (onMobile) {
        z = vwForZoom <= 360 ? 0.72
          : vwForZoom <= 420 ? 0.78
          : vwForZoom <= 480 ? 0.84
          : vwForZoom <= 560 ? 0.88
          : 0.92;

        // <-- difficulty knob applied for everyone on mobile
        z *= MOBILE_EASE;
      }
      mobileZoomRef.current = z;

      canvas.width  = Math.floor(vw * effDpr);
      canvas.height = Math.floor(vh * effDpr);
      canvas.style.width  = vw + "px";
      canvas.style.height = vh + "px";
      ctx.setTransform(effDpr, 0, 0, effDpr, 0, 0);

      setIsMobileUI(onMobile);
    }

    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    // ---------- world ----------
    const state = {
      t: 0,
      last: performance.now(),
      speed: 340,
      baseSpeed: 340,
      speedMax: 1200,
      speedRamp: 36,
      gravity: 2400,
      jumpVel: -900,
      deckH: 18,
      deckLip: 4,

      // scenery
      skyline: [],
      backTall: [],
      frontTall: [],
      groundY: 0,

      // entities
      obstacles: [],
      stars: [],
      clouds: [],
      puffs: [],
      steam: [],

      // weather
      rain: [],
      snow: [],
      fog: [],
      fogTex: null,

      score: 0,

      // camera shake
      shakeAmp: 0,
      shakeT: 0,
      shakeDur: 0,

      spawnTimer: 0,
      hitFxT: 0,
      pausedOverlayAlpha: 0,
      hintAlpha: localStorage.getItem("rc.hintDone")==="1" ? 0 : 1,
      firstJumpDone: localStorage.getItem("rc.hintDone")==="1",

      // fair-spawn context (filled every frame)
      playerCtx: null,

      // under-deck data (gaps, scroll)
      deckGaps: [],
      deckScrollX: 0,
    };

    // ---- Variable jump params ----
    const COYOTE = 0.12, JUMP_BUFFER = 0.12;
    const MAX_HOLD = 0.22;
    const HOLD_GRAVITY_FACTOR = 0.55;
    const CUT_GRAVITY_FACTOR  = 1.9;

    const input = {
      duck: false,
      jumpBufferT: 0,
      coyoteT: 0,
      jumpHeld: false,
      jumpHoldT: 0,
    };
    const touchState = { duckId: null, jumpId: null };

    const player = { x: 120, y: 0, vy: 0, w: 46, h: 36, duckH: 24, onGround: true, earFlickT: 2 + Math.random()*4 };

    function calcGroundY() {
      const dpr = effDprRef.current;
      const h = canvas.height / dpr;
      return Math.floor(h * 0.66);
    }

    function ensureStarFieldSized(){
      const dpr = effDprRef.current;
      const screenW = canvas.width / dpr;
      const skyH = Math.max(40, Math.floor(state.groundY - 10)); // sky = top to deck top

      if (
        !state._starDims ||
        state._starDims.w !== screenW ||
        state._starDims.h !== skyH ||
        state._starRM  !== reduceMotionRef.current
      ){
        const density = reduceMotionRef.current ? 0.5 : 1.0;
        const target = Math.max(60, Math.round((screenW * skyH) / 9000 * density));

        state.stars = Array.from({ length: target }, () => ({
          x: Math.random() * screenW,
          y: Math.random() * skyH,
          a: Math.random(),
          p: Math.random() * Math.PI * 2
        }));

        state._starDims = { w: screenW, h: skyH };
        state._starRM   = reduceMotionRef.current;
      }
    }
    function ensureCloudBankSized(){
      const dpr = effDprRef.current;
      const screenW = canvas.width / dpr;

      // clouds live in a band near the top of the sky (screen-space)
      const bandTop = 10;
      const bandH   = Math.max(60, Math.min(state.groundY * 0.35, 180));

      // target count scales with width (tweak to taste)
      const density = 1.0; // we don't draw when reduceMotion is true anyway
      const target  = Math.max(4, Math.round(screenW / 180 * 1.2 * density));

      const dimsChanged =
        !state._cloudDims ||
        state._cloudDims.w !== screenW ||
        state._cloudDims.h !== bandH ||
        state.clouds.length !== target;

      if (dimsChanged){
        state.clouds = Array.from({ length: target }, () => {
          const s = 0.8 + Math.random() * 1.6;        // scale
          return {
            x: Math.random() * (screenW + 300) - 150, // seed across (and slightly beyond) screen
            y: bandTop + Math.random() * bandH,
            v: 12 + Math.random() * 18,               // speed
            s,
            a: 0.28 + Math.random() * 0.35            // alpha
          };
        });
        state._cloudDims = { w: screenW, h: bandH };
      }
    }

    function resetRun(keepScore=false) {
      state.t = 0; state.speed = state.baseSpeed;
      state.obstacles.length = 0; if(!keepScore){ state.score = 0; }
      state.shakeAmp = 0; state.shakeT = 0; state.shakeDur = 0;
      state.spawnTimer = 0.2; state.hitFxT = 0;
      state.groundY = calcGroundY();
      state.deckGaps = [];
      state.deckScrollX = 0;

      player.x = 120; player.y = state.groundY - player.h; player.vy = 0; player.onGround = true;

      // scenery + weather
      const s = makeScenery(canvas, state.groundY, reduceMotionRef.current);
      state.stars   = s.stars;
      state.clouds  = s.clouds;
      state.skyline = s.skyline;
      state.backTall  = s.backTall;
      state.frontTall = s.frontTall;
      state._starDims = null;
      state._starRM   = undefined;
      ensureStarFieldSized(); // build stars immediately for the ready screen
      ensureCloudBankSized();

      initWeather(weatherRef.current, state, canvas, reduceMotionRef.current);

      // initialize under-deck columns & gap spans
      initUnderDeck(state, canvas);
    }

    function syncGroundToCanvas(){
      // Recompute groundY from the current canvas height
      const newGY = calcGroundY();
      const oldGY = state.groundY;
      if (newGY === oldGY) return;

      const dy = newGY - oldGY;
      state.groundY = newGY;
      state._starDims = null;
      ensureStarFieldSized(); // keep ready/paused screens correct after any resize
      ensureCloudBankSized();

      // Keep the player glued to the new ground if they were grounded
      if (player.onGround){
        const targetH = input.duck ? player.duckH : player.h;
        player.y = newGY - targetH;
        player.vy = 0;
      }

      // Keep existing obstacles visually anchored to the ground
      for (const o of state.obstacles){
        if (typeof o.y === "number") o.y += dy;
        if (typeof o.baseY === "number") o.baseY += dy;
      }
    }

    function onVisibilityLike() {
      if ((document.hidden || document.visibilityState !== "visible")
          && gameStateRef.current === "playing") {
        setGameState("paused");
      }
    }
    document.addEventListener("visibilitychange", onVisibilityLike);
    window.addEventListener("pagehide", onVisibilityLike);

    // first scene
    resetRun();
    syncGroundToCanvas();

    gameApiRef.current = {
      reset(keepScore = false) {
        // Clear any held inputs so we don't start in a duck/jump
        input.duck = false;
        input.jumpHeld = false;
        input.jumpBufferT = 0;
        input.coyoteT = 0;
        touchState.duckId = null;
        touchState.jumpId = null;

        // Go back to the ready screen (you can switch to "playing" if you prefer)
        setGameState("ready");

        // Rebuild the world
        resetRun(keepScore);
        syncGroundToCanvas();
      }
    };

    // ---------- input ----------
    function handleStartOrJump() {
      if (gameStateRef.current === "dead") { setGameState("playing"); resetRun(); return; }
      if (gameStateRef.current === "ready") { setGameState("playing"); }
      input.jumpBufferT = JUMP_BUFFER;
      if (!state.firstJumpDone) { state.firstJumpDone = true; localStorage.setItem("rc.hintDone","1"); }
    }

    function onKeyDown(e){
      if(e.repeat) return;
      const k=e.key.toLowerCase();

      // resume from pause on ANY key press
      if (gameStateRef.current === "paused") {
        e.preventDefault();
        setGameState("playing");
        return;
      }

      if(k===" "||k==="arrowup"||k==="w"){ e.preventDefault(); handleStartOrJump(); input.jumpHeld = true; }
      if(k==="arrowdown"||k==="s") input.duck=true;
      if(k==="p") setGameState(s => s==="paused" ? "playing" : (s==="playing" ? "paused" : s));
      if(k==="t") {
        const order = ["auto","night","dawn","day"];
        const idx = order.indexOf(cycleModeRef.current);
        setCycleMode(order[(idx+1)%order.length]);
      }
      if(k==="r"){
        const order = ["none","rain","snow","fog","storm"];
        const idx = order.indexOf(weatherRef.current);
        const next = order[(idx+1)%order.length];
        initWeather(next, state, canvas, reduceMotionRef.current);
        setWeather(next);
      }
    }

    function onKeyUp(e){
      const k=e.key.toLowerCase();
      if(k===" "||k==="arrowup"||k==="w"){ input.jumpHeld = false; if (player.vy < 0) player.vy *= 0.75; }
      if(k==="arrowdown"||k==="s") input.duck=false;
    }

    // Resume on click/tap while paused (pointerdown on the canvas)
    function onPointerDown(e){
      e.preventDefault();

      // Unpause on any touch
      if (gameStateRef.current === "paused") {
        setGameState("playing");
        input.duck = false;
        input.jumpHeld = false;
        touchState.duckId = null;
        touchState.jumpId = null;
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const half = rect.width * 0.5;

      if (x < half) {
        // LEFT: duck (hold)
        input.duck = true;
        touchState.duckId = e.pointerId;

        // if this same finger was jumping, stop the jump hold
        if (touchState.jumpId === e.pointerId) {
          input.jumpHeld = false;
          touchState.jumpId = null;
        }
      } else {
        // RIGHT: jump (tap/hold)
        handleStartOrJump();       // identical to desktop keydown: start/buffer the jump
        input.jumpHeld = true;     // identical to holding Space/Up
        input.jumpHoldT = 0;       // reset the hold timer
        touchState.jumpId = e.pointerId;

        // if they were ducking with this finger, clear it
        if (touchState.duckId === e.pointerId) {
          input.duck = false;
          touchState.duckId = null;
        }
      }

      // keep receiving events if finger leaves canvas
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    function onPointerUp(e){
      e.preventDefault();

      if (e.pointerId === touchState.duckId) {
        input.duck = false;
        touchState.duckId = null;
      }
      if (e.pointerId === touchState.jumpId) {
        // identical to desktop keyup: end hold + early-release velocity cut = short hop
        input.jumpHeld = false;
        if (player.vy < 0) player.vy *= 0.75;  // same “light jump” cut as desktop
        touchState.jumpId = null;
      }
    }
    function onPointerCancel(e){
      if (e.pointerId === touchState.duckId) {
        input.duck = false;
        touchState.duckId = null;
      }
      if (e.pointerId === touchState.jumpId) {
        if (player.vy < 0) player.vy *= 0.75; // same short-hop cut
        input.jumpHeld = false;
        touchState.jumpId = null;
      }
    }
    function onBlur(){ if(gameStateRef.current==="playing"){ setGameState("paused"); } }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("resize", syncGroundToCanvas);
    window.visualViewport?.addEventListener("resize", syncGroundToCanvas);
    window.addEventListener("orientationchange", syncGroundToCanvas);

    // ---------- loop ----------
    let raf=0; raf=requestAnimationFrame(step);
    function step(){
      const now=performance.now(); const dt=Math.min(0.032,(now-state.last)/1000); state.last=now;
      if(gameStateRef.current==="playing") update(dt);
      render();
      raf=requestAnimationFrame(step);
    }

    function centerOverGap(x, w, gaps, pad = 6){
      if (!gaps || !gaps.length) return false;
      const cx = x + w * 0.5;
      for (const g of gaps){
        const gl = g.x + pad;           // small inward pad for forgiveness
        const gr = g.x + g.w - pad;
        if (cx > gl && cx < gr) return true;
      }
      return false;
    }

    function update(dt){
      // time
      state.t += dt;

      // canvas dims (needed early)
      const dpr = effDprRef.current;
      const w   = canvas.width  / dpr;
      const h   = canvas.height / dpr;

      // zoom-aware "world" bounds (what the camera actually shows)
      const z = mobileZoomRef.current;
      const worldW = z < 1 ? w / z : w;
      const worldBottom = z < 1 ? state.groundY + (h - state.groundY) / z : h;

      // --- speed ramp
      const rm = reduceMotionRef.current ? 0.5 : 1;
      state.speed = Math.min(state.speedMax, state.speed + state.speedRamp * rm * dt);

      // --- variable jump
      input.jumpBufferT = Math.max(0, input.jumpBufferT - dt);
      input.coyoteT     = Math.max(0, input.coyoteT - dt);

      if (input.jumpBufferT > 0 && (player.onGround || input.coyoteT > 0)) {
        player.vy = state.jumpVel;
        player.onGround = false;
        input.jumpBufferT = 0;
        input.jumpHoldT = 0;
      }

      let g = state.gravity;
      if (player.vy < 0) {
        if (input.jumpHeld && input.jumpHoldT < MAX_HOLD) {
          g *= HOLD_GRAVITY_FACTOR;
          input.jumpHoldT += dt;
        } else if (!input.jumpHeld) {
          g *= CUT_GRAVITY_FACTOR;
        }
      }
      player.vy += g * dt;

      // --- GROUND / DUCK COLLISION -----------------------------------------------
      const targetH = input.duck ? player.duckH : player.h;
      player.y += player.vy * dt;

      const feetY   = player.y + targetH;
      const overGap = centerOverGap(player.x, player.w, state.deckGaps || [], 4);

      if (!overGap && feetY >= state.groundY) {
        // On solid deck → snap to ground
        player.y = state.groundY - targetH;

        if (!player.onGround) {
          // landing puff just once when transitioning to ground
          spawnPuffs(
            state,
            player.x + player.w * 0.6,
            state.groundY + state.deckH - 6,
            Math.min(10 + Math.abs(player.vy) * 0.01, 18),
            reduceMotionRef.current
          );
        }

        player.onGround   = true;
        input.coyoteT     = COYOTE;   // <- refresh every grounded frame
        player.vy         = 0;
        input.jumpHoldT   = 0;
      } else {
        // In air or over a gap → let gravity continue
        player.onGround = false;
      }

      // fall off-screen → game over (use world bottom with zoom)
      if (player.y > worldBottom + 20) {
        setGameState("dead");
        return;
      }

      // flavor
      player.earFlickT -= dt;
      if (player.earFlickT <= 0) player.earFlickT = 3 + Math.random() * 6;

      // --- ambience / parallax
      moveBuildings(state.backTall,  state.speed * 0.24, dt, worldW);
      moveBuildings(state.frontTall, state.speed * 0.90, dt, worldW);

      emitSteam(state, dt);
      twinkleWindows(state.backTall);
      twinkleWindows(state.frontTall);
      ensureCloudBankSized();

      // clouds (screen-space; unaffected by zoom)
      {
        const bandTop = 10;
        const bandH   = Math.max(60, Math.min(state.groundY * 0.35, 180));
        state.clouds.forEach(cl => {
          cl.x -= cl.v * dt;
          if (cl.x < -220) {
            cl.x = w + 80;
            cl.y = bandTop + Math.random() * bandH;
            cl.v = 12 + Math.random() * 18;
            cl.s = 0.8 + Math.random() * 1.6;
          }
        });
      }

      // weather — update in SCREEN SPACE so flakes/raindrops reach the real top
      if (state.rain.length){
        for (const r of state.rain) {
          r.x += r.vx * dt; 
          r.y += r.vy * dt;
          if (r.y > h + 20) { r.y = -10; r.x = Math.random() * w; }  // wrap using screen height
          if (r.x < -20)    { r.x = w + 10; }
          if (r.x >  w +20) { r.x = -10; }
        }
      }
      if (state.snow.length){
        for (const s of state.snow){
          s.sway += s.swaySpeed * dt;
          s.x += s.vx * dt + Math.sin(s.sway) * 6 * dt;
          s.y += s.vy * dt;
          if (s.y > h + 10) { s.y = -10; s.x = Math.random() * w; }  // wrap using screen height
          if (s.x < -15)    s.x = w + 10;
          if (s.x >  w +15) s.x = -10;
        }
      }
      if (state.fog.length){
        for (const f of state.fog){
          f.x += f.vx * dt;
          f.y += Math.sin(state.t * f.swaySpeed + f.phi) * 4 * dt;
          if (f.x + f.r < -80) {
            f.x = worldW + 60;
            f.y = (state.groundY - 170) + Math.random() * (state.groundY + 36 - (state.groundY - 170));
          }
        }
      }

      advanceLightning(state, dt, canvas);

      // --- fair-spawn context (use world-sized bounds)
      state.playerCtx = {
        x: player.x, y: player.y, w: player.w,
        h: player.h, duckH: player.duckH,
        isDucking: !!input.duck,
        groundY: state.groundY,
        speed: state.speed,
        laneTop: state.groundY - 110,
        laneBottom: state.groundY + state.deckH,
        canvasW: worldW,
        canvasH: worldBottom,
      };

      // --- spawns
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const nextDelay = spawnObstacle(state, canvas);
        if (typeof nextDelay === "number" && Number.isFinite(nextDelay)) {
          state.spawnTimer = nextDelay;
        } else {
          const base = 1.08;
          const speedFactor = 1 - (state.speed - state.baseSpeed) /
                                (state.speedMax - state.baseSpeed + 1e-6);
          state.spawnTimer = base
            * (0.55 + speedFactor * 0.8)
            * (0.8 + Math.random() * 0.6);
        }
      }

      // --- move & cull obstacles
      for (const o of state.obstacles) o.x -= state.speed * dt;
      while (state.obstacles.length && state.obstacles[0].x + state.obstacles[0].w < -80)
        state.obstacles.shift();

      // --- under-deck world scroll & gap bookkeeping
      state.deckScrollX += state.speed * dt; // pattern scroll in world space
      if (!state.deckGaps) state.deckGaps = [];
      for (const gSpan of state.deckGaps) gSpan.x -= state.speed * dt;
      while (state.deckGaps.length && state.deckGaps[0].x + state.deckGaps[0].w < -80)
        state.deckGaps.shift();

      // --- collisions with regular obstacles
      const px = player.x, py = player.y;
      const pw = player.w, ph = input.duck ? player.duckH : player.h;
      const prx = px + 2, pry = py + 2, prw = pw - 4, prh = ph - 4;

      const buildWTGColliders = (o) => {
        const inset = Math.max(10, o.w * 0.18);
        const legW  = Math.max(4, Math.min(7, o.w * 0.08));
        const innerL = o.x + inset + legW + 2;
        const innerR = o.x + o.w - inset - legW - 2;
        const barW   = Math.max(20, innerR - innerL);
        const duckBar = { x: innerL, y: o.y, w: barW, h: o.h };

        const legH      = o.clearance + o.h + o.stem;
        const platformY = o.baseY - legH;
        const tankPad   = 6;
        const tankTopY  = platformY - tankPad - o.tankH;
        const capExtra  = 12;
        const towerTopY = tankTopY - capExtra;
        const towerH    = o.y - towerTopY;

        const tower = { x: o.x, y: towerTopY, w: o.w, h: Math.max(0, towerH) };
        return [duckBar, tower];
      };

      for (const o of state.obstacles){
        const rects = (typeof o.colliders === "function")
          ? o.colliders()
          : (o.type === "water_tower_gate"
              ? buildWTGColliders(o)
              : [{ x: o.x, y: o.y, w: o.w, h: o.h }]);

        let hit = false;
        for (const r of rects){
          if (overlap(prx, pry, prw, prh, r.x, r.y, r.w, r.h)) { hit = true; break; }
        }

        if (hit){
          state.shakeAmp = reduceMotionRef.current ? 3 : 6;
          state.shakeT = 0; state.shakeDur = 0.45; state.hitFxT = 0.28;

          setGameState("dead");
          return;
        }
      }

      // --- under-deck rail (gap-wall) hitboxes — lose if you hit the wall
      {
        const udTop = state.groundY + state.deckH + state.deckLip; // top of under-deck wall
        const udH   = Math.max(0, worldBottom - udTop);            // use worldBottom with zoom
        const EDGE_W = 6;

        for (const gSpan of state.deckGaps){
          const leftRect  = { x: gSpan.x - EDGE_W, y: udTop, w: EDGE_W, h: udH };
          const rightRect = { x: gSpan.x + gSpan.w, y: udTop, w: EDGE_W, h: udH };

          if (overlap(prx, pry, prw, prh, leftRect.x, leftRect.y, leftRect.w, leftRect.h) ||
              overlap(prx, pry, prw, prh, rightRect.x, rightRect.y, rightRect.w, rightRect.h)) {
            state.shakeAmp = reduceMotionRef.current ? 3 : 6;
            state.shakeT = 0; state.shakeDur = 0.45; state.hitFxT = 0.28;

            setGameState("dead");
            return;
          }
        }
      }

      // --- particles & scoring
      updatePuffs(state, dt);
      updateSteam(state, dt);

      const srScore = clamp(
        (state.speed - state.baseSpeed) / (state.speedMax - state.baseSpeed),
        0, 1
      );
      const scoreMult = 0.85 + 1.3 * Math.pow(srScore, 1.15);
      state.score += dt * state.speed * 0.02 * scoreMult;

      const s = Math.floor(state.score);

      // Live best update
      if (s > bestRef.current) {
        bestRef.current = s;
        localStorage.setItem("rc.best", String(s));
        setBest(s);
      }

      // camera shake progress
      if (state.shakeT <= state.shakeDur) state.shakeT += dt;
      else state.shakeAmp = 0;

      if (state.firstJumpDone && state.hintAlpha > 0)
        state.hintAlpha = Math.max(0, state.hintAlpha - dt * 0.8);

      state.hitFxT = Math.max(0, state.hitFxT - dt);
    }

    function moveBuildings(arr, vel, dt, w){
      for(const b of arr){
        b.x -= vel * dt;
        if (b.x + b.w < -80) {
          // Re-spawn just beyond the right edge
          b.x = w + Math.random() * 240;
        }
      }
    }
    function twinkleWindows(arr){
      for(const b of arr){
        if(!b.windows) continue;
        b.twinkleT += 0.016;
        if (b.twinkleT > b.twinkleRate){
          b.twinkleT = 0;
          for (let k = 0; k < 3; k++){
            const r = 1 + Math.floor(Math.random() * (b.windows.rows - 2));
            const c = 1 + Math.floor(Math.random() * (b.windows.cols - 2));
            const id = r * 1000 + c;
            if (b.windows.lit.has(id)) b.windows.lit.delete(id);
            else b.windows.lit.add(id);
          }
        }
      }
    }

    function render(){
      const dpr = effDprRef.current;
      const w = canvas.width / dpr, h = canvas.height / dpr;

      // hit flash filter
      ctx.filter = (state.hitFxT>0) ? "grayscale(60%) contrast(110%)" : "none";

      // time of day
      let phase;
      if (cycleModeRef.current === "auto") phase = (Math.sin(performance.now()*0.00005)+1)/2;
      else if (cycleModeRef.current === "night") phase = 0.05;
      else if (cycleModeRef.current === "dawn")  phase = 0.35;
      else                                       phase = 0.8;

      // sky
      const skyA = hsl(lerpColor(PALETTE.skyA1, PALETTE.skyA2, phase));
      const skyB = hsl(lerpColor(PALETTE.skyB1, PALETTE.skyB2, phase));
      const grad = ctx.createLinearGradient(0,0,0,h);
      grad.addColorStop(0, skyA); grad.addColorStop(1, skyB);
      ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

      // stars + clouds
      const night = 1 - phase;
      if (night > 0.15 && !reduceMotionRef.current){
        ctx.globalAlpha = 0.5*(night - 0.15);
        ctx.fillStyle = "#cfd8ff";
        for (const s of state.stars){
          const tw = 0.5 + 0.5 * Math.sin(state.t*2 + s.p);
          ctx.globalAlpha = 0.2 + s.a * tw * (night - 0.1);
          ctx.fillRect(s.x, s.y, 1.2, 1.2);
        }
        ctx.globalAlpha = 1;
      }
      if (!reduceMotionRef.current){
        for (const cl of state.clouds) drawCloud(ctx, cl.x, cl.y, cl.s, cl.a);
      }

      // lightning (render-only; advance happens in update)
      renderLightning(ctx, state, canvas);

      const gy = state.groundY;

      // zoom-aware world bounds for rendering
      const z = mobileZoomRef.current;
      const worldW = z < 1 ? w / z : w;
      const worldBottom = z < 1 ? gy + (h - gy) / z : h;

      // subtle depth fog above the deck
      const df = ctx.createLinearGradient(0, 0, 0, gy);
      df.addColorStop(0.00, "rgba(12,18,30,0.38)");
      df.addColorStop(0.55, "rgba(12,18,30,0.18)");
      df.addColorStop(1.00, "rgba(12,18,30,0.0)");
      ctx.fillStyle = df; ctx.fillRect(0,0,w,gy);

      // calm shake
      let sx = 0, sy = 0;
      if (state.shakeAmp > 0 && state.shakeT <= state.shakeDur){
        const k = state.shakeT / state.shakeDur;
        const ease = (1 - k) * (1 - k);
        sx = Math.sin(state.shakeT * 40) * state.shakeAmp * ease;
        sy = Math.cos(state.shakeT * 32) * state.shakeAmp * 0.6 * ease;
      }

      ctx.save();
      ctx.translate(sx, sy);

      // ---- mobile "camera zoom" (render-only)
      // anchor at left edge (x=0) and deck top (y=gy) to avoid side/bottom gaps
      if (z < 1) {
        ctx.translate(0, gy);
        ctx.scale(z, z);
        ctx.translate(0, -gy);
      }
      // ---------------------------------------

      /* ---------------- Buildings (single pass, bottom-anchored, behind deck) ---------------- */
      const extendBy = (worldBottom - gy);

      // Skyline silhouettes (extended)
      ctx.fillStyle = "#091120"; ctx.globalAlpha = 0.6;
      for (const b of state.skyline){
        const extH = b.h + extendBy;
        const yExt = worldBottom - extH;
        roundRect(ctx, b.x, yExt, b.w, extH, b.roof === "spike" ? 6 : 2, true);
      }
      ctx.globalAlpha = 1;

      // Back layer (extended)
      ctx.globalAlpha = 0.46;
      for (const b of state.backTall){
        const extH = b.h + extendBy;
        const yExt = worldBottom - extH;
        drawBuilding(ctx, { ...b, y: yExt, h: extH });
      }
      ctx.globalAlpha = 1;

      // Front layer (extended)
      ctx.globalAlpha = 0.95;
      for (const b of state.frontTall){
        const extH = b.h + extendBy;
        const yExt = worldBottom - extH;
        drawBuilding(ctx, { ...b, y: yExt, h: extH });
      }
      ctx.globalAlpha = 1;

      // mid fog blobs
      if (state.fog.length && state.fogTex){
        for (const f of state.fog){
          const top = gy - 180;
          const fade = clamp((f.y - top) / 220, 0, 1);
          const a = f.a * fade * (reduceMotionRef.current ? 0.9 : 1);
          if (a <= 0.01) continue;
          ctx.globalAlpha = a;
          ctx.drawImage(state.fogTex, f.x - f.r, f.y - f.r, f.r*2, f.r*2);
        }
        ctx.globalAlpha = 1;
      }
      /* -------------------------------------------------------------------------------------- */

      // deck + under-deck (on top; already punched at gaps)
      drawDeck(ctx, state, worldW, worldBottom);

      // steam
      for (const s of state.steam){
        ctx.save(); ctx.globalAlpha = s.a; ctx.fillStyle = "#cfe6ff";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); ctx.restore();
      }

      // obstacles
      drawObstacles(ctx, state, state.t);

      // particles
      for (const p of state.puffs){
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.a)); ctx.fillStyle = "#9fb4d8";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill(); ctx.restore();
      }

      // player
      const ph = input.duck ? player.duckH : player.h;
      const angle = clamp(player.vy * 0.0006, -0.25, 0.25);
      drawCat(ctx, player.x, player.y, player.w, ph, state.t, angle, player.earFlickT < 0.2 ? 1 : 0);

      ctx.restore(); // end shake

      // WEATHER DRAW — screen space so it reaches the literal top of the canvas
      if (state.rain.length){
        ctx.save(); 
        ctx.globalAlpha = 0.65; 
        ctx.strokeStyle = "rgba(200,220,255,0.5)";
        ctx.lineWidth = 1; 
        ctx.beginPath();
        for (const r of state.rain){ 
          ctx.moveTo(r.x, r.y); 
          ctx.lineTo(r.x + r.vx*0.02, r.y + r.vy*0.02); 
        }
        ctx.stroke(); 
        ctx.restore();
      }
      if (state.snow.length){
        ctx.save(); 
        ctx.fillStyle = "rgba(240,246,255,0.9)";
        for (const s of state.snow){ 
          ctx.beginPath(); 
          ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); 
          ctx.fill(); 
        }
        ctx.restore();
      }

      // UI & overlays
      ctx.fillStyle="#c7d2ff"; ctx.font="600 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(`score ${Math.floor(state.score)}`,16,28);
      ctx.fillText(`best ${bestRef.current}`,16,48);

      const touch = isMobileUI;

      if (state.hintAlpha>0 && gameStateRef.current==="playing"){
        const hintText = "Hold left to duck • Tap/hold right to jump";
        
        ctx.save(); ctx.globalAlpha = state.hintAlpha;
        centerText(ctx, w, h*0.3, hintText, 18);
        ctx.restore();
      }

      if (gameStateRef.current === "ready") {
        const startText = "Tap/hold right to jump\nHold left to duck";
        centerText(ctx, w, h, startText, 18);
      } else if (gameStateRef.current === "dead") {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#060913";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        const finalScore = Math.floor(state.score);
        const deadHint = touch ? "Tap to retry" : "Press Space/Click to retry";
        const deadText = `Score: ${finalScore}\nBest: ${bestRef.current}\n${deadHint}`;
        centerText(ctx, w, h, deadText, 18);
      }

      if (gameStateRef.current === "paused"){
        state.pausedOverlayAlpha = Math.min(0.75, state.pausedOverlayAlpha + 0.08);
        ctx.save(); ctx.globalAlpha = state.pausedOverlayAlpha; ctx.fillStyle = "#060913cc";
        ctx.fillRect(0,0,w,h); ctx.globalAlpha = 1;
        const pausedText = touch ? "Paused\nTap to resume" : "Paused\nPress any key or Click to resume";
        centerText(ctx, w, h, pausedText, 20);
        ctx.restore();
      } else {
        state.pausedOverlayAlpha = 0;
      }

      if (state.hitFxT>0){
        ctx.save(); ctx.globalAlpha = Math.min(0.25, state.hitFxT*0.6);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,w,h); ctx.restore();
      }
    }

    // cleanup
    return () => {
      cancelAnimationFrame(raf);

      // remove the *sizing* listeners too
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);

      // existing removals
      window.removeEventListener("resize", syncGroundToCanvas);
      window.visualViewport?.removeEventListener("resize", syncGroundToCanvas);
      window.removeEventListener("orientationchange", syncGroundToCanvas);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityLike);
      window.removeEventListener("pagehide", onVisibilityLike);
    };
  }, []);

  function handleReset(){ gameApiRef.current?.reset(false); }
  const prettyWeather = (w) => w[0].toUpperCase()+w.slice(1);

  // Direct Pause/Resume toggle (mirrors the P key)
  const handlePauseToggle = () => {
    setGameState(s => (s === "paused" ? "playing" : (s === "playing" ? "paused" : s)));
  };

  return (
    <div style={wrap}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", touchAction: "none", ...NO_SELECT }}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div style={{ ...(isMobileUI ? hudMobile : hud) }}>
        <button
          title="Toggle time of day (T)"
          style={{ ...(isMobileUI ? chipMobile : chip) }}
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }))
          }
        >
          Time: T
        </button>

        <button
          title="Cycle weather (R)"
          style={{ ...(isMobileUI ? chipMobile : chip) }}
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }))
          }
        >
          Weather: {prettyWeather(weather)} (R)
        </button>

        <button
          title="Pause/Resume (P)"
          style={{ ...(isMobileUI ? chipMobile : chip) }}
          onClick={handlePauseToggle}
        >
          {gameState === "paused" ? "Resume: Click/P" : "Pause: P"}
        </button>

        <label style={{ ...(isMobileUI ? toggleLabelMobile : toggleLabel) }}>
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
          />{" "}
          Reduce motion
        </label>

        <button style={{ ...(isMobileUI ? btnMobile : btn) }} onClick={handleReset}>
          Reset
        </button>
      </div>
    </div>
  );
}

// ---- tiny styles ----
const wrap={ position:"relative", minHeight:"100dvh", background:"#070a14" };
const hud={ position:"absolute", top:12, right:12, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" };
const toggleLabel={ fontSize:12, color:"#d6dcff", display:"flex", alignItems:"center", gap:6, background:"rgba(7,10,20,0.4)", padding:"6px 10px", borderRadius:10 };
const btn={ background:"linear-gradient(90deg, #4f67ff, #8a6cff)", color:"white", border:"none", padding:"8px 10px", borderRadius:10, fontWeight:600, cursor:"pointer", boxShadow:"0 2px 10px rgba(0,0,0,0.25)" };
const chip={ background:"rgba(16,22,40,0.6)", color:"#cfe0ff", border:"1px solid rgba(120,150,255,0.25)", padding:"6px 8px", borderRadius:999, fontSize:12, cursor:"pointer" };

const hudMobile = {
  position: "absolute",
  top: 12,              // ⬅️ move to top
  right: 12,
  bottom: "auto",
  left: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 6,
  flexWrap: "nowrap",
  maxWidth: "70vw",     // keep it narrow so it never reaches left edge
  zIndex: 10,
  // Optional: add a little notch padding for iOS
  paddingTop: "env(safe-area-inset-top, 0)"
};

const chipMobile = {
  ...chip,
  fontSize: 11,
  padding: "6px 8px",
  borderRadius: 999,
};

const toggleLabelMobile = {
  ...toggleLabel,
  fontSize: 11,
  padding: "6px 8px",
};

const btnMobile = {
  ...btn,
  padding: "6px 10px",
  fontSize: 12,
};