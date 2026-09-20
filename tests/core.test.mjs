import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { convertImage, exportLayer } from '@uselessworks/svgify';
function raster(rows, colors = [[255,0,0,255],[0,0,255,255],[0,255,0,255],[0,0,0,0]]) {
  return { width: rows[0].length, height: rows.length, data: Uint8Array.from(rows.flatMap(row=>[...row].flatMap(c=>colors[Number(c)]))) };
}
function area(ring) { return ring.reduce((sum,p,i)=>{ const q=ring[(i+1)%ring.length]; return sum+p[0]*q[1]-q[0]*p[1]; },0)/2; }
function winding(x,y,rings) {
  let value = 0;
  for(const ring of rings) for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length];
    const cross=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1]);
    if(a[1]<=y && b[1]>y && cross>0) value++;
    if(a[1]>y && b[1]<=y && cross<0) value--;
  }
  return value;
}
function assertPartition(result) {
  for(let i=0;i<result.layers.length;i++) {
    const layer=result.layers[i];
    assert.equal(layer.rings.reduce((s,r)=>s+area(r),0),layer.pixels, 'signed contour area must equal pixel area');
    assert.match(layer.path,/Z$/);
    for(const ring of layer.rings) {
      assert.ok(ring.length>=4);
      assert.equal(new Set(ring.map(p=>p.join(','))).size,ring.length,'individual rings must not self-touch');
      assert.ok(area(ring)!==0);
    }
  }
  for(let y=0;y<result.height;y++) for(let x=0;x<result.width;x++) {
    const hits=result.layers.flatMap((l,i)=>winding(x+.5,y+.5,l.rings)!==0?[i]:[]);
    const label=result.labels[y*result.width+x];
    assert.deepEqual(hits,label<0?[]:[label], `coverage at ${x},${y}`);
  }
}
test('exact artwork colors, topology, holes, islands and physical dimensions',()=>{
  const image=raster(['00000','01110','01210','01110','00000']);
  const result=convertImage(image,{ colors:3,minRegionPixels:0,widthMm:50 });
  assert.deepEqual(new Set(result.palette),new Set(['#ff0000','#0000ff','#00ff00']));
  assert.equal(result.stats.holes,2); assert.equal(result.widthMm,50); assert.equal(result.heightMm,50);
  assert.match(result.svg,/width="50mm"/); assert.equal(result.stats.quantizationError,0);
  assertPartition(result);
  const single=exportLayer(result,1); assert.match(single,/viewBox="0 0 5 5"/); assert.equal((single.match(/<path /g)||[]).length,1);
});
test('transparent holes, diagonal contacts and narrow strokes preserve exact coverage',()=>{
  for(const rows of [ ['030','303','030'], ['00000','03330','03030','03330','00000'], ['0300','0030','0300','0030'], ['012','120','201'] ]) {
    const image=raster(rows), result=convertImage(image,{colors:3,minRegionPixels:0});
    assertPartition(result); assert.equal(result.stats.opaquePixels,[...image.data].filter((_,i)=>i%4===3).filter(a=>a>0).length);
  }
});
test('all 512 binary 3×3 masks have no overlaps, gaps or lost holes',()=>{
  for(let mask=0;mask<512;mask++) {
    const data=new Uint8Array(36);
    for(let i=0;i<9;i++) if(mask & (1<<i)) data.set([12,120,224,255],i*4);
    assertPartition(convertImage({data,width:3,height:3},{minRegionPixels:0}));
  }
});
test('random multicolor partitions round-trip exactly through SVG rasterization',async()=>{
  let state=19; const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let sample=0;sample<24;sample++) {
    const rows=Array.from({length:9},()=>Array.from({length:11},()=>String((random()>>>16)%4)).join(''));
    const result=convertImage(raster(rows),{colors:3,minRegionPixels:0,curveTolerance:0}); assertPartition(result);
    // Force dimensions in px for an independent renderer at exact pixel centers.
    const svg=result.svg.replace(/width="[^"]+" height="[^"]+"/,`width="${result.width}" height="${result.height}"`);
    const {data}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let p=0;p<result.labels.length;p++) {
      const label=result.labels[p];
      if(label<0) assert.equal(data[p*4+3],0);
      else { assert.equal(data[p*4+3],255); assert.equal('#'+[...data.subarray(p*4,p*4+3)].map(v=>v.toString(16).padStart(2,'0')).join(''),result.palette[label]); }
    }
  }
});
test('speckle cleanup reassigns area without filling transparency or losing isolated art',()=>{
  const image=raster(['0000003','0010003','0000003','3333333','3333331']);
  const result=convertImage(image,{colors:2,minRegionPixels:2});
  assert.equal(result.stats.changedPixels,1); assert.equal(result.stats.mergedRegions,1);
  assert.equal(result.stats.remainingSmallRegions,1);
  assert.equal(result.stats.opaquePixels,19); assert.ok(result.warnings.some(w=>w.includes('isolated')));
  assertPartition(result);
  const physical=convertImage(raster(['000','010','000']),{colors:2,minRegionPixels:0,widthMm:3,minRegionAreaMm2:2});
  assert.equal(physical.palette.length,1); assert.equal(physical.stats.changedPixels,1);
});
test('strict 1–16 color bound, deterministic output and low gradient reconstruction error',()=>{
  const data=new Uint8Array(256*32*4);
  for(let y=0;y<32;y++) for(let x=0;x<256;x++) data.set([x,x,x,255],(y*256+x)*4);
  const image={data,width:256,height:32};
  const result=convertImage(image,{colors:16,minRegionPixels:0});
  assert.equal(result.palette.length,16); assert.equal(result.svg,convertImage(image,{colors:16,minRegionPixels:0}).svg);
  assert.ok(result.stats.quantizationError<2.5);
  let squared=0;
  for(let p=0;p<result.labels.length;p++) {const v=parseInt(result.palette[result.labels[p]].slice(1,3),16);squared+=(data[p*4]-v)**2;}
  assert.ok(Math.sqrt(squared/result.labels.length)<7);
  assert.equal(convertImage(image,{colors:1}).palette.length,1);
});
test('exact close colors in the same histogram bin survive when under the palette limit',()=>{
  const image={width:2,height:1,data:Uint8Array.from([1,2,3,255,2,3,4,255])};
  const result=convertImage(image,{colors:2,minRegionPixels:0});
  assert.deepEqual(result.palette,['#010203','#020304']);
});
test('filament palette is enforced, translucency composites and fully empty input is valid',()=>{
  const image={width:3,height:1,data:Uint8Array.from([255,0,0,0,255,0,0,127,255,0,0,128])};
  const result=convertImage(image,{palette:['#000000','#ffffff'],minRegionPixels:0});
  assert.equal(result.labels[0],-1); assert.equal(result.labels[1],-1); assert.ok(result.palette.every(c=>['#000000','#ffffff'].includes(c)));
  const exact=convertImage(image,{minRegionPixels:0}); assert.equal(exact.palette[0],'#ff7f7f');
  const blank=convertImage({width:2,height:2,data:new Uint8Array(16)}); assert.equal(blank.layers.length,0); assert.equal(blank.stats.opaquePixels,0); assert.equal(blank.stats.quantizationError,0); assert.ok(blank.warnings.length);
});
test('area resampling protects transparent edges and never mutates input',()=>{
  const data=new Uint8Array(32*16*4);
  for(let i=0;i<data.length;i+=8) {data.set([255,0,0,255,0,0,255,0],i);}
  const before=data.slice();
  const result=convertImage({width:32,height:16,data},{maxDimension:16,minRegionPixels:0,matte:'#ff0000'});
  assert.equal(result.width,16); assert.equal(result.height,8); assert.deepEqual(result.palette,['#ff0000']); assert.deepEqual(data,before);
});
test('invalid dimensions, buffers, options and custom provider output are rejected',()=>{
  const image=raster(['0']);
  for(const options of [{colors:0},{colors:17},{colors:1.5},{colors:NaN},{widthMm:Infinity},{widthMm:0},{maxDimension:9999},{alphaThreshold:0},{minRegionPixels:-1},{minRegionAreaMm2:NaN},{palette:['red']},{colors:1,palette:['#000000','#ffffff']},{matte:'<script>'}]) assert.throws(()=>convertImage(image,options));
  assert.throws(()=>convertImage({width:1,height:2,data:new Uint8Array(4)}));
  assert.throws(()=>convertImage({width:0,height:2,data:new Uint8Array(0)}));
  assert.throws(()=>convertImage(image,{}, {quantize:()=>({width:1,height:1,labels:Int8Array.of(-1),palette:[],quantizationError:0})}));
  assert.throws(()=>exportLayer(convertImage(image),99));
});
