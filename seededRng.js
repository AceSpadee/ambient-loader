// seededRng.js
export function createPRNG(seedStr="default"){
  // xorshift32 from seed string
  let h = 2166136261 >>> 0;
  for (let i=0;i<seedStr.length;i++){ h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  let x = (h || 123456789) >>> 0;
  return function prng(){
    // xorshift32
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    // convert to [0,1)
    return ((x >>> 0) / 4294967296);
  };
}

// Example hook (don’t import in RooftopCat yet if you don't want)
import { createPRNG } from "./seededRng";
const url = new URL(window.location.href);
const seed = url.searchParams.get("seed") || "rooftop";
window.__RC_PRNG__ = createPRNG(seed);