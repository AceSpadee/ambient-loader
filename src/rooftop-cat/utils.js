// Math + color + small canvas helpers used across modules
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const lerp = (a,b,t) => a+(b-a)*t;
export const lerpColor = (a,b,t)=>({h:lerp(a.h,b.h,t), s:lerp(a.s,b.s,t), l:lerp(a.l,b.l,t)});
export const hsl = (c)=> `hsl(${c.h} ${c.s}% ${c.l}%)`;
export function shade(hex, delta){
  const to = (n)=> Math.max(0, Math.min(255, n + Math.round(255*delta/100)));
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `#${to(r).toString(16).padStart(2,'0')}${to(g).toString(16).padStart(2,'0')}${to(b).toString(16).padStart(2,'0')}`;
}
export const pick = arr => arr[(Math.random()*arr.length)|0];
export function pickWeighted(pairs){
  const total = pairs.reduce((s,[,w])=>s+w,0);
  let r = Math.random()*total;
  for (const [val, w] of pairs){ if ((r-=w) <= 0) return val; }
  return pairs[0][0];
}
export const overlap = (x1,y1,w1,h1,x2,y2,w2,h2)=> x1<x2+w2 && x1+w1>x2 && y1<y2+h2 && y1+h1>y2;

// Canvas paths & drawing
export function roundRect(ctx,x,y,w,h,r,fill=true){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
  fill ? ctx.fill() : ctx.stroke();
}
export function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
}
export function centerText(ctx,w,h,txt,size=18){
  ctx.fillStyle="#d9e0ff";
  ctx.font=`600 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  const lines=txt.split("\n");
  lines.forEach((line,i)=>ctx.fillText(line,w/2,h/2+i*(size+6)));
  ctx.textAlign="left"; ctx.textBaseline="alphabetic";
}

// Global neon outline (already thinned)
export function neonStrokePath(ctx, color, coreW, glowW, alpha, makePath){
  const SCALE = 0.35; // 0.65 = ~35% thinner
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = glowW * SCALE;
  ctx.shadowColor = color;
  ctx.shadowBlur = glowW * 0.9 * SCALE;
  makePath(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.lineWidth = coreW * SCALE;
  makePath(); ctx.stroke();
  ctx.restore();
}
