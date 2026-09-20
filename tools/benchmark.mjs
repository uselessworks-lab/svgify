import { convertImage } from '@uselessworks/svgify';
import { cpus } from 'node:os';
function fixture(size,kind) {
  const data=new Uint8Array(size*size*4); let seed=1234;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const p=(y*size+x)*4;
    if(kind==='flat') { const c=Math.floor(x/(size/4))+4*Math.floor(y/(size/4));data.set([c*17,255-c*12,c*11,255],p); }
    else {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const noise=((seed>>>24)-128)*0.08;
      data.set([Math.max(0,Math.min(255,x/size*255+noise)),Math.max(0,Math.min(255,y/size*255+noise)),Math.max(0,Math.min(255,128+90*Math.sin(x/size*9)*Math.cos(y/size*7)+noise)),255],p);
    }
  }
  return {data,width:size,height:size};
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,platform:process.platform,arch:process.arch,note:'Synthetic fixtures; median of 5 warm runs, conversion only; not a photo-quality benchmark.'}));
for(const size of [256,512,768,1024]) for(const kind of ['flat','gradient-noise']) {
  const image=fixture(size,kind),options={colors:16,maxDimension:size,minRegionPixels:8};
  convertImage(image,options); const times=[];let result;
  for(let i=0;i<5;i++){const start=performance.now();result=convertImage(image,options);times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({size,kind,medianMs:+times[2].toFixed(1),minMs:+times[0].toFixed(1),maxMs:+times[4].toFixed(1),colors:result.stats.colors,regions:result.stats.regions,vertices:result.stats.vertices,pathSegments:result.stats.pathSegments,curveSegments:result.stats.curveSegments,fallbackBoundaries:result.stats.fallbackBoundaries,svgKB:+(Buffer.byteLength(result.svg)/1024).toFixed(1),oklabRmse:result.stats.quantizationError}));
}
