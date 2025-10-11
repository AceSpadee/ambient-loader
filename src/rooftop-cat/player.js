import { roundRect } from "./utils.js";
import { PALETTE } from "./palette.js";

export function drawCat(ctx, x, y, w, h, t, angle = 0, earFlick = 0) {
  ctx.save();
  ctx.translate(x + w * 0.5, y + h * 0.5);
  ctx.rotate(angle);
  ctx.translate(-w * 0.5, -h * 0.5);

  // --- proportions relative to your existing 46x36-ish box
  const baseH = 36;
  const scale = Math.max(0.75, Math.min(1.35, h / baseH));

  const bodyW = Math.max(26, Math.floor(w * 0.66));
  const bodyH = Math.max(18, Math.floor(h * 0.72));
  const bodyX = 0;
  const bodyY = h - bodyH;

  const headW  = Math.max(14, Math.floor(w - bodyW + 8));
  const headH  = Math.max(12, Math.floor(bodyH * 0.58));
  const headX  = w - headW - 2;
  const headY  = bodyY - Math.max(2, Math.floor(headH * 0.25));

  const legH = Math.max(5, Math.floor(h * 0.18));
  const legY = h - legH;
  const stride = Math.sin(t * 10) * Math.min(2.5 * scale, 3); // subtle bob

  // simple blink every ~5s for ~120ms
  const blink = ((t * 0.5) % 5) < 0.12 ? 1 : 0;

  // ear flick easing when earFlick==1 (about 180ms in your caller)
  const flickK = earFlick ? (0.5 - 0.5 * Math.cos(t * 22)) : 0; // 0→1→0
  const earA = flickK * 0.5; // radians, ~28°

  // tail lift with jump angle + gentle wag
  const tailLift = Math.max(-6, Math.min(10, -angle * 40)) + Math.sin(t * 4) * 2;

  // --- outline/bounds
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  roundRect(ctx, -1, 5, w + 2, h - 4, 6, false);
  ctx.restore();

  // --- body
  ctx.fillStyle = PALETTE.catMid;
  roundRect(ctx, bodyX, bodyY, bodyW, bodyH, 6, true);

  // belly highlight (soft)
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = PALETTE.catBody;
  roundRect(ctx, bodyX + 4, bodyY + Math.max(2, Math.floor(bodyH * 0.35)),
            Math.max(8, Math.floor(bodyW * 0.45)), Math.floor(bodyH * 0.45), 6, true);
  ctx.restore();

  // --- tail (curved, raises on jump)
  drawTail(ctx,
    bodyX + 4, bodyY + Math.floor(bodyH * 0.55),
    Math.max(16, Math.floor(18 * scale)),
    tailLift
  );

  // --- head
  ctx.fillStyle = PALETTE.catBody;
  roundRect(ctx, headX, headY, headW, headH, 6, true);

  // ears
  ctx.save();
  ctx.fillStyle = PALETTE.catBody;
  ctx.translate(headX + headW * 0.25, headY + 2);
  ctx.rotate(-earA);
  ear(ctx);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = PALETTE.catBody;
  ctx.translate(headX + headW * 0.75, headY + 2);
  ctx.rotate(earA);
  ear(ctx);
  ctx.restore();

  // face (eyes + nose). keep it tiny so it doesn't read as "cartoony"
  const eyeY = headY + Math.floor(headH * 0.45);
  const eyeR = Math.max(1, Math.floor(1.2 * scale));
  const eyeLx = headX + Math.floor(headW * 0.35);
  const eyeRx = headX + Math.floor(headW * 0.65);

  if (!blink) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(eyeLx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeRx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(10,20,30,0.9)";
    ctx.beginPath(); ctx.arc(eyeLx, eyeY, Math.max(0.8, eyeR * 0.6), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeRx, eyeY, Math.max(0.8, eyeR * 0.6), 0, Math.PI * 2); ctx.fill();
  } else {
    // blink line
    ctx.strokeStyle = "rgba(10,20,30,0.95)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(eyeLx - eyeR, eyeY); ctx.lineTo(eyeLx + eyeR, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eyeRx - eyeR, eyeY); ctx.lineTo(eyeRx + eyeR, eyeY); ctx.stroke();
  }

  // tiny nose
  ctx.fillStyle = "rgba(250,180,180,0.9)";
  ctx.fillRect(headX + headW * 0.5 - 0.8, eyeY + 2, 1.6, 1.2);

  // whiskers (very subtle)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(200,220,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headX + headW * 0.2, eyeY + 2);
  ctx.lineTo(headX - 3, eyeY + 1);
  ctx.moveTo(headX + headW * 0.2, eyeY + 4);
  ctx.lineTo(headX - 2, eyeY + 4);
  ctx.moveTo(headX + headW * 0.8, eyeY + 2);
  ctx.lineTo(headX + headW + 3, eyeY + 1);
  ctx.moveTo(headX + headW * 0.8, eyeY + 4);
  ctx.lineTo(headX + headW + 2, eyeY + 4);
  ctx.stroke();
  ctx.restore();

  // --- legs (fake run cycle with depth)
  ctx.fillStyle = PALETTE.catLeg;
  // front (closest)
  roundRect(ctx, bodyX + 8,  legY - stride, 10, legH, 3, true);
  roundRect(ctx, bodyX + 20, legY + stride, 10, legH, 3, true);
  // mid (slightly transparent for depth)
  ctx.save(); ctx.globalAlpha = 0.75;
  roundRect(ctx, bodyX + 32, legY + stride * 0.7, 10, legH, 3, true);
  ctx.restore();

  ctx.restore(); // rotate/translate end
}

function ear(ctx){
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(6, -12);
  ctx.lineTo(12, 0);
  ctx.closePath();
  ctx.fill();
}

// small helper: a two-segment bezier tail that curves and lifts
function drawTail(ctx, baseX, baseY, len, lift){
  const x1 = baseX, y1 = baseY;
  const x2 = baseX - len * 0.55, y2 = baseY - Math.max(-2, lift * 0.6);
  const x3 = baseX - len,        y3 = baseY - Math.max(0, lift);

  ctx.save();
  // glow cap at base
  ctx.fillStyle = "rgba(169,230,255,0.25)";
  roundRect(ctx, x1 - 3, y1 - 3, 6, 6, 3, true);

  // soft outer
  ctx.strokeStyle = "rgba(180,205,245,0.55)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(x2, y2, x3, y3);
  ctx.stroke();

  // inner core
  ctx.strokeStyle = "rgba(60,90,140,0.95)";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(x2, y2, x3, y3);
  ctx.stroke();
  ctx.restore();
}
