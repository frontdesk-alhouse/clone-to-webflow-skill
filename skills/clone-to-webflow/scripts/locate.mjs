import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const key = process.argv[2];
const D = PNG.sync.read(readFileSync(`diff/${key}.detail.png`));
const { rects } = JSON.parse(readFileSync(`spec/sections/${key}.textrects.json`,'utf8'));
const inT=(x,y)=>rects.some(r=>x>=r.x-3&&x<=r.x+r.w+3&&y>=r.y-3&&y<=r.y+r.h+3);
const pts=[];
for(let y=0;y<D.height;y++)for(let x=0;x<D.width;x++){
  const i=(y*D.width+x)*4;
  if(!(D.data[i]>180 && D.data[i+1]<120)) continue;   // magenta = diferencia real
  if(inT(x,y)) continue; pts.push([x,y]);
}
const cl=[];
for(const [x,y] of pts){ let f=null;
  for(const c of cl) if(x>=c.x0-14&&x<=c.x1+14&&y>=c.y0-14&&y<=c.y1+14){f=c;break;}
  if(f){f.x0=Math.min(f.x0,x);f.x1=Math.max(f.x1,x);f.y0=Math.min(f.y0,y);f.y1=Math.max(f.y1,y);f.n++;}
  else cl.push({x0:x,x1:x,y0:y,y1:y,n:1});
}
console.log(`  ${pts.length} px fuera de texto en ${cl.length} grupos`);
cl.sort((a,b)=>b.n-a.n).slice(0,12).forEach(c=>console.log(`   x ${c.x0}-${c.x1}  y ${c.y0}-${c.y1}   ${c.n} px`));
