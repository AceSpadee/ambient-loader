
# effects.py — 1:1 port of effects.js
import math
import random

__all__ = ["emitSteam", "updateSteam", "spawnPuffs", "updatePuffs"]

def emitSteam(state, dt):
    for b in state.get("frontTall", []):
        for rp in b.get("roof", []):
            kind = rp.get("kind")
            if kind == "vent":
                rp["emit"] = rp.get("emit", 0.0) - dt
                if rp["emit"] <= 0:
                    rp["emit"] = 1.2 + random.random()*1.6
                    steam = state.setdefault("steam", [])
                    # drop oldest if at cap
                    if len(steam) > 110:
                        steam.pop(0)
                    x = b.get("x", 0) + rp.get("dx", 0) + 4
                    # respect roof-prop vertical offset if present
                    y = b.get("y", 0) + rp.get("dy", 0) - 6
                    steam.append({
                        "x": x, "y": y,
                        "r": 3, "a": 0.45,
                        "vx": -8 + random.random()*16,
                        "vy": -18 - random.random()*14,
                        "life": 1.8
                    })
            elif kind == "fan":
                rp["rot"] = rp.get("rot", 0.0) + (rp.get("rs", 1.2)) * dt

def updateSteam(state, dt):
    steam = state.get("steam", [])
    for s in steam:
        s["x"] += s.get("vx", 0)*dt
        s["y"] += s.get("vy", 0)*dt
        s["r"]  = s.get("r", 0) + 4*dt
        s["a"]  = max(0.0, s.get("a", 0) - 0.18*dt)
        s["life"] = max(0.0, s.get("life", 0) - dt)
    state["steam"] = [s for s in steam if s["life"] > 0 and s["a"] > 0]

def spawnPuffs(state, x, y, intensity=12, reduceMotion=False):
    if reduceMotion:
        return
    for _ in range(3):
        puffs = state.setdefault("puffs", [])
        if len(puffs) > 38:
            puffs.pop(0)
        ang = (-math.pi/2) + (random.random()*math.pi/2)
        sp  = 30 + random.random()*60 + intensity
        puffs.append({
            "x": x + (random.random()*8 - 4),
            "y": y + (random.random()*2 - 1),
            "r": 2 + random.random()*3,
            "a": 0.5,
            "vx": math.cos(ang)*sp*0.5,
            "vy": math.sin(ang)*sp*0.4,
            "life": 0.6 + random.random()*0.4
        })

def updatePuffs(state, dt):
    puffs = state.get("puffs", [])
    for p in puffs:
        p["x"] += p.get("vx", 0)*dt
        p["y"] += p.get("vy", 0)*dt
        p["vy"] = p.get("vy", 0) - 12*dt
        p["r"]  = p.get("r", 0) + 14*dt
        p["a"]  = max(0.0, p.get("a", 0) - 1.2*dt)
        p["life"] = max(0.0, p.get("life", 0) - dt)
    state["puffs"] = [p for p in puffs if p["life"] > 0 and p["a"] > 0]