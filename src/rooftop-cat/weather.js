// Weather init & fog texture
export function initWeather(mode, state, canvas, reduceMotion){
  state.rain = []; state.snow = []; state.fog = []; state.fogTex = null;
  if (mode === "rain") initRain(state, canvas, reduceMotion);
  else if (mode === "snow") initSnow(state, canvas, reduceMotion);
  else if (mode === "fog") initFog(state, canvas, reduceMotion);
}

export function initRain(state, canvas, reduceMotion){
  state.rain = [];
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const count = reduceMotion ? 80 : 160;
  for (let i=0;i<count;i++){
    const z = Math.random();
    state.rain.push({ x: Math.random()*w, y: Math.random()*h, vx: -40 - 40*z, vy: 320 + 380*z, z });
  }
}

export function initSnow(state, canvas, reduceMotion){
  state.snow = [];
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const count = reduceMotion ? 80 : 140;
  for (let i=0;i<count;i++){
    const size = 1 + Math.random()*2.2;
    state.snow.push({ x: Math.random()*w, y: Math.random()*h, vx: -14 - Math.random()*10, vy: 18 + Math.random()*28, sway: Math.random()*Math.PI*2, swaySpeed: 0.6 + Math.random()*1.2, r: size });
  }
}

function makeFogTexture(){
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64,64,8, 64,64,64);
  grd.addColorStop(0.0, "rgba(210,220,240,0.32)");
  grd.addColorStop(0.4, "rgba(210,220,240,0.20)");
  grd.addColorStop(1.0, "rgba(210,220,240,0.0)");
  g.fillStyle = grd;
  g.fillRect(0,0,128,128);
  return c;
}
export function initFog(state, canvas, reduceMotion){
  const dpr = (window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const gy = state.groundY;

  state.fogTex = makeFogTexture();
  state.fog = [];

  const count = reduceMotion ? 22 : 46;
  for (let i=0;i<count;i++){
    const layer = Math.random()<0.45 ? 0 : (Math.random()<0.7 ? 1 : 2);
    const baseR = layer===2 ? 140 : (layer===1 ? 110 : 90);
    const r = baseR + Math.random()*80;
    const yMin = gy - 170, yMax = gy + 36;
    const y = yMin + Math.random()*(yMax - yMin);
    const x = -120 + Math.random()*(w + 240);
    const vx = -(layer===2 ? 22 : layer===1 ? 16 : 10) - Math.random()*6;
    const a = (layer===2 ? 0.16 : layer===1 ? 0.12 : 0.08);
    const swayAmp = 8 + Math.random()*16;
    const swaySpeed = 0.3 + Math.random()*0.8;
    const phi = Math.random()*Math.PI*2;
    state.fog.push({x,y,r,a,vx,layer,swayAmp,swaySpeed,phi});
  }
}
