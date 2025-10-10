import React, { useEffect, useRef, useState } from "react";
import { PALETTE } from "./palette.js";
import { clamp, lerpColor, hsl, centerText, overlap, roundRect } from "./utils.js";
import { makeScenery, drawCloud, drawBuilding, drawSilhouette } from "./scenery.js";
import { initWeather } from "./weather.js";
import { emitSteam, updateSteam, spawnPuffs, updatePuffs } from "./effects.js";
import { spawnObstacle, drawObstacles } from "./obstacles.js";
import { drawCat } from "./player.js";

export default function RooftopCat() {
  const canvasRef = useRef(null);

  // UI/state
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("rc.rm")==="1");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem("rc.best") || 0));
  const [gameState, setGameState] = useState("ready"); // ready | playing | paused | dead
  const [cycleMode, setCycleMode] = useState(() => localStorage.getItem("rc.cycle") || "auto"); // auto|night|dawn|day
  const [weather, setWeather] = useState(() => localStorage.getItem("rc.weather") || "none"); // none|rain|snow|fog

  const reduceMotionRef = useRef(reduceMotion);
  const gameStateRef = useRef(gameState);
  const cycleModeRef = useRef(cycleMode);
  const weatherRef = useRef(weather);
  useEffect(() => { reduceMotionRef.current = reduceMotion; localStorage.setItem("rc.rm", reduceMotion? "1":"0"); }, [reduceMotion]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { cycleModeRef.current = cycleMode; localStorage.setItem("rc.cycle", cycleMode); }, [cycleMode]);
  useEffect(() => { weatherRef.current = weather; localStorage.setItem("rc.weather", weather); }, [weather]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // ---------- sizing & DPR ----------
    function resize() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.floor(window.innerWidth);
      const h = Math.floor(window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // ---------- world ----------
    const state = {
      t: 0,
      last: performance.now(),
      speed: 340,
      baseSpeed: 340,
      speedMax: 780,
      speedRamp: 32,
      gravity: 2400,
      jumpVel: -900,
      deckH: 18,
      deckLip: 4,

      // scenery
      skyline: [],
      backTall: [],
      frontTall: [],
      backSmallBottom: [],
      frontSmallBottom: [],
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

      // calm shake
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
    };

    // ---- Variable jump params ----
    const COYOTE = 0.12, JUMP_BUFFER = 0.12;
    const MAX_HOLD = 0.22;
    const HOLD_GRAVITY_FACTOR = 0.55;
    const CUT_GRAVITY_FACTOR  = 1.9;

    const input = { 
      duck: false, 
      tapDownAt: 0, 
      jumpBufferT: 0, 
      coyoteT: 0,
      jumpHeld: false,
      jumpHoldT: 0
    };

    const player = { x: 120, y: 0, vy: 0, w: 46, h: 36, duckH: 24, onGround: true, anim: 0, earFlickT: 2 + Math.random()*4 };

    function calcGroundY() {
      const dpr = (window.devicePixelRatio || 1);
      const h = canvas.height / dpr;
      return Math.floor(h * 0.66);
    }

    function resetRun(keepScore=false) {
      state.t = 0; state.speed = state.baseSpeed;
      state.obstacles.length = 0; if(!keepScore){ state.score = 0; setScore(0); }
      state.shakeAmp = 0; state.shakeT = 0; state.shakeDur = 0;
      state.spawnTimer = 0.2; state.hitFxT = 0;
      state.groundY = calcGroundY();

      player.x = 120; player.y = state.groundY - player.h; player.vy = 0; player.onGround = true; player.anim = 0;

      // scenery + weather
      const s = makeScenery(canvas, state.groundY, reduceMotionRef.current);
      state.stars = s.stars; state.clouds = s.clouds; state.skyline = s.skyline;
      state.backTall = s.backTall; state.frontTall = s.frontTall;
      state.backSmallBottom = s.backSmallBottom; state.frontSmallBottom = s.frontSmallBottom;
      initWeather(weatherRef.current, state, canvas, reduceMotionRef.current);
    }

    // first scene
    resetRun();

    // ---------- input ----------
    function handleStartOrJump() {
      if (gameStateRef.current === "dead") { setGameState("playing"); resetRun(); return; }
      if (gameStateRef.current === "ready") { setGameState("playing"); }
      input.jumpBufferT = JUMP_BUFFER;
      if (!state.firstJumpDone) { state.firstJumpDone = true; localStorage.setItem("rc.hintDone","1"); }
    }
    function onKeyDown(e){
      if(e.repeat) return; const k=e.key.toLowerCase();
      if(k===" "||k==="arrowup"||k==="w"){ e.preventDefault(); handleStartOrJump(); input.jumpHeld = true; }
      if(k==="arrowdown"||k==="s") input.duck=true;
      if(k==="p") setGameState(s => s==="paused" ? "playing" : (s==="playing" ? "paused" : s));
      if(k==="t") {
        const order = ["auto","night","dawn","day"];
        const idx = order.indexOf(cycleModeRef.current);
        setCycleMode(order[(idx+1)%order.length]);
      }
      if(k==="r"){
        const order = ["none","rain","snow","fog"];
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
    function onPointerDown(e){ e.preventDefault(); input.tapDownAt=performance.now(); }
    function onPointerUp(e){ e.preventDefault(); const held=performance.now()-input.tapDownAt; if(held<160) handleStartOrJump(); else input.duck=false; input.tapDownAt=0; }
    function onPointerCancel(){ input.duck=false; input.tapDownAt=0; }
    function onBlur(){ if(gameStateRef.current==="playing"){ setGameState("paused"); } }

    const pressPoll=setInterval(()=>{ if(!input.tapDownAt) return; if(performance.now()-input.tapDownAt>160) input.duck=true; },50);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    // ---------- loop ----------
    let raf=0; raf=requestAnimationFrame(step);
    function step(){
      const now=performance.now(); const dt=Math.min(0.032,(now-state.last)/1000); state.last=now;
      if(gameStateRef.current==="playing") update(dt);
      render(dt);
      raf=requestAnimationFrame(step);
    }

    function update(dt){
      state.t+=dt; const rm=reduceMotionRef.current?0.5:1;
      state.speed=Math.min(state.speedMax,state.speed+state.speedRamp*rm*dt);

      // variable jump
      input.jumpBufferT=Math.max(0,input.jumpBufferT-dt); input.coyoteT=Math.max(0,input.coyoteT-dt);
      if(input.jumpBufferT>0&&(player.onGround||input.coyoteT>0)){
        player.vy=state.jumpVel; player.onGround=false; input.jumpBufferT=0;
        input.jumpHoldT = 0;
      }
      let g = state.gravity;
      if (player.vy < 0) {
        if (input.jumpHeld && input.jumpHoldT < MAX_HOLD) { g *= 0.55; input.jumpHoldT += dt; }
        else if (!input.jumpHeld) { g *= CUT_GRAVITY_FACTOR; }
      }
      player.vy += g*dt;

      // ground
      const targetH=input.duck?player.duckH:player.h;
      player.y+=player.vy*dt;
      if(player.y+targetH>=state.groundY){
        player.y=state.groundY-targetH;
        if(!player.onGround){
          spawnPuffs(state, player.x+player.w*0.6, state.groundY+state.deckH-6, Math.min(10 + Math.abs(player.vy)*0.01, 18), reduceMotionRef.current);
          input.coyoteT=COYOTE;
        }
        player.onGround=true; player.vy=0; input.jumpHoldT = 0;
      } else { player.onGround=false; }

      player.earFlickT -= dt; if (player.earFlickT <= 0) player.earFlickT = 3 + Math.random()*6;

      const dpr = (window.devicePixelRatio || 1);
      const w=canvas.width/dpr, h=canvas.height/dpr;

      // parallax move
      moveBuildings(state.backTall, state.speed*0.24, dt, w);
      moveBuildings(state.frontTall, state.speed*0.9, dt, w);
      moveBuildings(state.backSmallBottom, state.speed*0.18, dt, w);
      moveBuildings(state.frontSmallBottom, state.speed*0.6, dt, w);

      emitSteam(state, dt);
      twinkleWindows(state.backTall); twinkleWindows(state.frontTall);

      state.clouds.forEach(cl=>{ cl.x-=cl.v*dt; if(cl.x<-220){ cl.x=w+80; cl.y=40+Math.random()*120; cl.v=12+Math.random()*18; cl.s=0.8+Math.random()*1.6; }});

      // weather particles
      if (state.rain.length){
        for (const r of state.rain) { r.x += r.vx*dt; r.y += r.vy*dt; if (r.y > h+20) { r.y = -10; r.x = (Math.random()*w); } if (r.x < -20) { r.x = w + 10; } }
      }
      if (state.snow.length){
        for (const s of state.snow){ s.sway += s.swaySpeed*dt; s.x += s.vx*dt + Math.sin(s.sway)*6*dt; s.y += s.vy*dt; if (s.y > h+10) { s.y = -10; s.x = Math.random()*w; } if (s.x < -15) s.x = w + 10; }
      }
      if (state.fog.length){
        for (const f of state.fog){
          f.x += f.vx*dt; f.y += Math.sin(state.t * f.swaySpeed + f.phi) * 4 * dt;
          if (f.x + f.r < -80) { f.x = w + 60; f.y = (state.groundY - 170) + Math.random()*(state.groundY + 36 - (state.groundY - 170)); }
        }
      }

      // ---------- fair spawn context (updated every frame) ----------
      state.playerCtx = {
        x: player.x,
        y: player.y,
        w: player.w,
        h: player.h,
        duckH: player.duckH,
        isDucking: !!input.duck,
        groundY: state.groundY,
        speed: state.speed,
        laneTop: state.groundY - 110,
        laneBottom: state.groundY + state.deckH,
        canvasW: w,
        canvasH: h,
      };

      // obstacles
      state.spawnTimer-=dt;
      if(state.spawnTimer<=0){
        // Let obstacles.js decide the next fair delay (so it can avoid impossible combos).
        const nextDelay = spawnObstacle(state, canvas);
        if (typeof nextDelay === "number" && Number.isFinite(nextDelay)) {
          state.spawnTimer = nextDelay;
        } else {
          // Fallback (in case older obstacles.js is loaded)
          const base=1.08;
          const speedFactor=1-(state.speed-state.baseSpeed)/(state.speedMax-state.baseSpeed+1e-6);
          state.spawnTimer=base*(0.55+speedFactor*0.8)*(0.8+Math.random()*0.6);
        }
      }
      for(const o of state.obstacles) o.x-=state.speed*dt;
      while(state.obstacles.length&&state.obstacles[0].x+state.obstacles[0].w<-80) state.obstacles.shift();

      // collisions
      const px=player.x, py=player.y, pw=player.w, ph=input.duck?player.duckH:player.h;
      for(const o of state.obstacles){
        if(overlap(px+2,py+2,pw-4,ph-4,o.x,o.y,o.w,o.h)){
          state.shakeAmp = reduceMotionRef.current ? 3 : 6;
          state.shakeT = 0; state.shakeDur = 0.45; state.hitFxT = 0.28;
          setGameState("dead");
          const final=Math.floor(state.score);

          // best-score: functional update to avoid stale closure
          setBest(prev => {
            if (final > prev) {
              localStorage.setItem("rc.best", String(final));
              return final;
            }
            return prev;
          });

          break;
        }
      }

      updatePuffs(state, dt);
      updateSteam(state, dt);

      state.score+=dt*(state.speed*0.02);
      const s=Math.floor(state.score); if(s!==score) setScore(s);

      if (state.firstJumpDone && state.hintAlpha>0) state.hintAlpha=Math.max(0, state.hintAlpha - dt*0.8);
      state.hitFxT = Math.max(0, state.hitFxT - dt);
    }

    function moveBuildings(arr, vel, dt, w){
      for(const b of arr){
        b.x-=vel*dt;
        if(b.x+b.w<-80){
          const nx = w + Math.random()*240;
          const dx = nx - (b.x + b.w);
          b.x += dx + b.w;
        }
      }
    }
    function twinkleWindows(arr){
      for(const b of arr){
        if(!b.windows) continue;
        b.twinkleT+=0.016;
        if(b.twinkleT>b.twinkleRate){
          b.twinkleT=0;
          for(let k=0;k<3;k++){
            const r=1+Math.floor(Math.random()*(b.windows.rows-2));
            const c=1+Math.floor(Math.random()*(b.windows.cols-2));
            const id=r*1000+c;
            if(b.windows.lit.has(id)) b.windows.lit.delete(id); else b.windows.lit.add(id);
          }
        }
      }
    }

    function render(dt){
      const dpr = (window.devicePixelRatio || 1);
      const w=canvas.width/dpr, h=canvas.height/dpr;

      // hit flash filter
      ctx.filter = (state.hitFxT>0) ? "grayscale(60%) contrast(110%)" : "none";

      // time-of-day
      let phase;
      if (cycleModeRef.current === "auto") phase = (Math.sin(performance.now()*0.00005)+1)/2;
      else if (cycleModeRef.current === "night") phase = 0.05;
      else if (cycleModeRef.current === "dawn") phase = 0.35;
      else phase = 0.8;

      // sky
      const skyA=hsl(lerpColor(PALETTE.skyA1, PALETTE.skyA2, phase));
      const skyB=hsl(lerpColor(PALETTE.skyB1, PALETTE.skyB2, phase));
      const grad=ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,skyA); grad.addColorStop(1,skyB); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);

      // stars + clouds
      const night=1-phase; if(night>0.15&&!reduceMotionRef.current){ ctx.globalAlpha=0.5*(night-0.15); ctx.fillStyle="#cfd8ff"; for(const s of state.stars){ const tw=0.5+0.5*Math.sin(state.t*2+s.p); ctx.globalAlpha=0.2+s.a*tw*(night-0.1); ctx.fillRect(s.x,s.y,1.2,1.2);} ctx.globalAlpha=1; }
      if(!reduceMotionRef.current){ for(const cl of state.clouds) drawCloud(ctx, cl.x, cl.y, cl.s, cl.a); }

      // skyline silhouette
      ctx.fillStyle="#091120"; ctx.globalAlpha=0.6; for(const b of state.skyline){ ctx.beginPath(); ctx.moveTo(b.x+ (b.roof==="spike"?6:2), b.y); /* tip */ ; ctx.closePath(); }
      ctx.globalAlpha=0.6; for(const b of state.skyline){ roundRect(ctx,b.x,b.y,b.w,b.h,b.roof==="spike"?6:2,true);} ctx.globalAlpha=1;

      const gy=state.groundY;

      // depth fog
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
        state.shakeT += dt;
      }

      ctx.save();
      ctx.translate(sx, sy);

      // back strip
      ctx.globalAlpha=0.85; ctx.fillStyle=PALETTE.backSmall; for(const b of state.backSmallBottom) drawSilhouette(ctx,b); ctx.globalAlpha=1;

      // back tall
      ctx.globalAlpha=0.46; for(const b of state.backTall) drawBuilding(ctx,b); ctx.globalAlpha=1;

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

      // lane band
      const laneTop = gy - 110; const laneBot = gy + state.deckH;
      const fogBand = ctx.createLinearGradient(0, laneTop, 0, laneBot);
      fogBand.addColorStop(0, "rgba(5,8,16,0)");
      fogBand.addColorStop(1, "rgba(5,8,16,0.35)");
      ctx.fillStyle = fogBand; ctx.fillRect(0, laneTop, w, laneBot - laneTop + state.deckLip);

      // deck
      ctx.fillStyle=PALETTE.lineTop; ctx.fillRect(0,gy,w,state.deckH);
      ctx.fillStyle=PALETTE.lineHighlight; ctx.fillRect(0,gy, w, 2);
      ctx.fillStyle=PALETTE.lineLip; ctx.fillRect(0,gy+state.deckH,w,state.deckLip);

      // front strip + front tall
      ctx.globalAlpha=0.95; ctx.fillStyle=PALETTE.frontSmall; for(const b of state.frontSmallBottom) drawSilhouette(ctx,b); ctx.globalAlpha=1;
      ctx.globalAlpha=0.95; for(const b of state.frontTall) drawBuilding(ctx,b); ctx.globalAlpha=1;

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
      const ph= input.duck ? player.duckH : player.h;
      const angle = clamp(player.vy * 0.0006, -0.25, 0.25);
      drawCat(ctx,player.x,player.y,player.w,ph,state.t, angle, player.earFlickT < 0.2 ? 1 : 0);

      // rain/snow
      if (state.rain.length){
        ctx.save(); ctx.globalAlpha = 0.65; ctx.strokeStyle = "rgba(200,220,255,0.5)"; ctx.lineWidth = 1; ctx.beginPath();
        for (const r of state.rain){ ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.vx*0.02, r.y + r.vy*0.02); }
        ctx.stroke(); ctx.restore();
      }
      if (state.snow.length){
        ctx.save(); ctx.fillStyle = "rgba(240,246,255,0.9)";
        for (const s of state.snow){ ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); }
        ctx.restore();
      }

      ctx.restore(); // end shake

      // UI text + overlay
      ctx.fillStyle="#c7d2ff"; ctx.font="600 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"; 
      ctx.fillText(`score ${Math.floor(state.score)}`,16,28); ctx.fillText(`best ${best}`,16,48);

      if (state.hintAlpha>0 && gameStateRef.current==="playing"){
        ctx.save(); ctx.globalAlpha = state.hintAlpha;
        centerText(ctx, w, h*0.3, "Hold ↓ or long-press to duck", 18);
        ctx.restore();
      }
      if (gameStateRef.current === "ready") centerText(ctx, w, h, "Tap/Click or Space to jump\nHold ↓ or long-press to duck", 18);
      else if (gameStateRef.current === "dead") centerText(ctx, w, h, "Ouch! Press Space/Click to retry", 18);

      if (gameStateRef.current === "paused"){
        state.pausedOverlayAlpha = Math.min(0.75, state.pausedOverlayAlpha + 0.08);
        ctx.save(); ctx.globalAlpha = state.pausedOverlayAlpha; ctx.fillStyle = "#060913cc"; ctx.fillRect(0,0,w,h); ctx.globalAlpha = 1;
        centerText(ctx, w, h, "Paused\nPress P to resume", 20); ctx.restore();
      } else {
        state.pausedOverlayAlpha = 0;
      }

      if (state.hitFxT>0){
        ctx.save(); ctx.globalAlpha = Math.min(0.25, state.hitFxT*0.6); ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,w,h); ctx.restore();
      }
    }

    // cleanup
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(pressPoll);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  function handleReset(){ window.location.reload(); }
  const prettyWeather = (w) => w[0].toUpperCase()+w.slice(1);

  return (
    <div style={wrap}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div style={hud}>
        <button title="Toggle time of day (T)" style={chip} onClick={()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'t'}))}>Time: T</button>
        <button title="Cycle weather (R)" style={chip} onClick={()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}))}>
          Weather: {prettyWeather(typeof window !== "undefined" ? (localStorage.getItem("rc.weather")||"none") : "none")} (R)
        </button>
        <button title="Pause/Resume (P)" style={chip} onClick={()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'p'}))}>Pause: P</button>

        <label style={toggleLabel}>
          <input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} /> Reduce motion
        </label>
        <button style={btn} onClick={handleReset}>Reset</button>
      </div>
    </div>
  );
}

// ---- tiny styles (unchanged) ----
const wrap={ position:"relative", minHeight:"100dvh", background:"#070a14" };
const hud={ position:"absolute", top:12, right:12, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" };
const toggleLabel={ fontSize:12, color:"#d6dcff", display:"flex", alignItems:"center", gap:6, background:"rgba(7,10,20,0.4)", padding:"6px 10px", borderRadius:10 };
const btn={ background:"linear-gradient(90deg, #4f67ff, #8a6cff)", color:"white", border:"none", padding:"8px 10px", borderRadius:10, fontWeight:600, cursor:"pointer", boxShadow:"0 2px 10px rgba(0,0,0,0.25)" };
const chip={ background:"rgba(16,22,40,0.6)", color:"#cfe0ff", border:"1px solid rgba(120,150,255,0.25)", padding:"6px 8px", borderRadius:999, fontSize:12, cursor:"pointer" };
