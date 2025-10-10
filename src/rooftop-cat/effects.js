// Steam + landing puffs + simple updaters
export function emitSteam(state, dt){
  for (const b of state.frontTall){
    for (const rp of b.roof){
      if (rp.kind==="vent"){
        rp.emit -= dt;
        if (rp.emit <= 0){
          rp.emit = 1.2 + Math.random()*1.6;
          const x = b.x + rp.dx + 4;
          const y = b.y - 6;
          if (state.steam.length > 110) state.steam.shift();
          state.steam.push({x, y, r: 3, a: 0.45, vx: -8+Math.random()*16, vy: -18 - Math.random()*14, life: 1.8});
        }
      } else if (rp.kind==="fan"){
        rp.rot += (rp.rs || 1.2) * dt;
      }
    }
  }
}

export function updateSteam(state, dt){
  for (const s of state.steam){
    s.x += s.vx*dt; s.y += s.vy*dt;
    s.r += 4*dt; s.a -= 0.18*dt; s.life -= dt;
  }
  state.steam = state.steam.filter(s=>s.life>0 && s.a>0);
}

export function spawnPuffs(state, x,y,intensity=12, reduceMotion){
  if (reduceMotion) return;
  for (let i=0;i<3;i++){
    if (state.puffs.length > 38) state.puffs.shift();
    const ang = (-Math.PI/2) + (Math.random()*Math.PI/2);
    const sp = 30 + Math.random()*60 + intensity;
    state.puffs.push({
      x: x + (Math.random()*8-4),
      y: y + (Math.random()*2-1),
      r: 2 + Math.random()*3,
      a: 0.5,
      vx: Math.cos(ang)*sp*0.5,
      vy: Math.sin(ang)*sp*0.4,
      life: 0.6 + Math.random()*0.4
    });
  }
}

export function updatePuffs(state, dt){
  for (const p of state.puffs){
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vy -= 12*dt; p.r += 14*dt;
    p.a -= 1.2*dt; p.life -= dt;
  }
  state.puffs = state.puffs.filter(p=>p.life>0 && p.a>0);
}
