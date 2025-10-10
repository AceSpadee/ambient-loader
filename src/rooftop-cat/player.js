import { roundRect } from "./utils.js";
import { PALETTE } from "./palette.js";

export function drawCat(ctx,x,y,w,h,t,angle=0,earFlick=0){
  ctx.save();
  ctx.translate(x+w*0.5,y+h*0.5);
  ctx.rotate(angle);
  ctx.translate(-w*0.5, -h*0.5);

  ctx.save(); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 2; roundRect(ctx,-1,5,w+2,h-4,6,false); ctx.restore();
  ctx.fillStyle = PALETTE.catMid; roundRect(ctx,0,6,w,h-6,6,true);
  ctx.fillStyle = PALETTE.catBody; roundRect(ctx,w-22,-6,22,20,6,true);

  ctx.fillStyle = PALETTE.catBody;
  ctx.save(); ctx.translate(w-18,-6); ctx.rotate(-earFlick*0.35); ear(ctx); ctx.restore();
  ctx.save(); ctx.translate(w-2,-6); ctx.rotate(earFlick*0.35); ear(ctx); ctx.restore();

  ctx.fillStyle = PALETTE.catMid; roundRect(ctx,-10,h-12,12,6,3,true);
  ctx.save(); ctx.translate(-8,h-12); ctx.rotate((Math.sin(t*8)*3*Math.PI)/180); roundRect(ctx,-12,-3,12,6,3,true); ctx.restore();

  ctx.fillStyle = PALETTE.catLeg; roundRect(ctx,6,h-6,10,6,3,true); roundRect(ctx,18,h-6,10,6,3,true); ctx.globalAlpha=0.7; roundRect(ctx,30,h-6,10,6,3,true); ctx.globalAlpha=1;
  ctx.restore();
}
function ear(ctx){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(6,-12); ctx.lineTo(12,0); ctx.closePath(); ctx.fill(); }
