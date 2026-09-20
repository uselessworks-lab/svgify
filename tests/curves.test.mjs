import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { convertImage, exportLayer } from '@uselessworks/svgify';
function image(width,height,at) {
  const colors=[[24,63,59,255],[241,223,184,255],[220,114,72,255],[0,0,0,0]];
  const data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(colors[at(x+.5,y+.5)],(y*width+x)*4);
  return {width,height,data};
}
function flatten(c) {
  const points=[c.start];let p=c.start;
  for(const s of c.segments){
    if(s.type==='L') points.push(s.to);
    else for(let i=1;i<=64;i++) {
      const t=i/64,u=1-t;
      points.push([u*u*p[0]+2*u*t*s.control[0]+t*t*s.to[0],u*u*p[1]+2*u*t*s.control[1]+t*t*s.to[1]]);
    }
    p=s.to;
  }
  return points;
}
function winding(x,y,rings) {
  let value=0;
  for(const r of rings)for(let i=1;i<r.length;i++) {
    const a=r[i-1],b=r[i],cross=(b[0]-a[0])*(y-a[1])-(x-a[0])*(b[1]-a[1]);
    if(a[1]<=y&&b[1]>y&&cross>0)value++;
    if(a[1]>y&&b[1]<=y&&cross<0)value--;
  }
  return value;
}
function assertSharedCurves(result) {
  const directions=new Map();
  for(const l of result.layers)for(const c of l.contours){
    let p=c.start;
    for(const s of c.segments) {
      if(s.type==='Q') {
        const a=p.join(','),b=s.to.join(','),key=[...[a,b].sort(),s.control.join(',')].join('|');
        const entry=directions.get(key)||[];entry.push(a<b?1:-1);directions.set(key,entry);
      }
      p=s.to;
    }
    assert.deepEqual(p,c.start,'every actual vector contour must close');
  }
  // All fixtures calling this are opaque with a straight rectangular outer boundary.
  for(const values of directions.values())assert.deepEqual(values.sort(),[-1,1],'internal curves must be identical and reversed for adjacent materials');
}
test('circle becomes compact Bézier geometry with identical shared material borders',async()=>{
  const input=image(160,160,(x,y)=>Math.hypot(x-80,y-80)<55?0:1);
  const exact=convertImage(input,{colors:2,minRegionPixels:0,curveTolerance:0});
  const smooth=convertImage(input,{colors:2,minRegionPixels:0});
  assert.ok(smooth.stats.curveSegments>=16);
  assert.ok(smooth.stats.pathSegments<exact.stats.pathSegments/3);
  assert.equal(smooth.svg,convertImage(input,{colors:2,minRegionPixels:0}).svg);
  assertSharedCurves(smooth);
  assert.ok(Math.abs(smooth.layers.reduce((sum,l)=>sum+l.vectorAreaMm2,0)-10000)<1e-7);
  const dark=smooth.layers.find(l=>l.color==='#183f3b');
  let squared=0,count=0,max=0;
  for(const c of dark.contours)for(const p of flatten(c)){
    const error=Math.abs(Math.hypot(p[0]-80,p[1]-80)-55);squared+=error*error;count++;max=Math.max(max,error);
  }
  assert.ok(Math.sqrt(squared/count)<1.0,`circle radial RMS ${Math.sqrt(squared/count)}`);assert.ok(max<1.6,`circle max error ${max}`);
  const layerSvg=exportLayer(smooth,smooth.layers.indexOf(dark));assert.match(layerSvg,/Q/);assert.match(layerSvg,/viewBox="0 0 160 160"/);
  const rendered=await sharp(Buffer.from(smooth.svg)).resize(640,640).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...rendered.subarray((320*640+320)*4,(320*640+320)*4+4)],[24,63,59,255]);
  assert.deepEqual([...rendered.subarray(0,4)],[241,223,184,255]);
});
test('long diagonal staircases become diagonal line segments and real corners remain sharp',()=>{
  const input=image(100,100,(x,y)=>x>=20&&y>=20&&x+y<150?0:1);
  const exact=convertImage(input,{colors:2,minRegionPixels:0,curveTolerance:0});
  const smooth=convertImage(input,{colors:2,minRegionPixels:0});
  assert.ok(smooth.stats.pathSegments<exact.stats.pathSegments/5);
  assert.ok(smooth.layers.some(l=>l.contours.some(c=>{
    let p=c.start,diagonal=false;
    for(const s of c.segments){if(s.type==='L'&&Math.abs(s.to[0]-p[0])>10&&Math.abs(s.to[1]-p[1])>10)diagonal=true;p=s.to;}return diagonal;
  })));
  const square=convertImage(image(60,60,(x,y)=>x>=10&&x<50&&y>=10&&y<50?0:3),{curveTolerance:4,minRegionPixels:0});
  assert.equal(square.stats.curveSegments,0); assert.equal(square.stats.pathSegments,4);
  assert.equal(square.layers[0].vectorAreaMm2,square.layers[0].areaMm2);
});
test('three-color junctions remain pinned, opaque material partition has no holes or overlaps',()=>{
  const input=image(96,96,(x,y)=>x<48+12*Math.sin(y/11)?0:(y<48+8*Math.sin(x/13)?1:2));
  const result=convertImage(input,{colors:3,minRegionPixels:0,curveTolerance:1.2});
  assert.ok(result.stats.curveSegments>0);assertSharedCurves(result);
  const contours=result.layers.map(l=>l.contours.map(flatten));
  for(let y=.231;y<96;y+=1.7)for(let x=.413;x<96;x+=1.9)assert.equal(contours.filter(c=>winding(x,y,c)!==0).length,1,`partition at ${x},${y}`);
  assert.ok(Math.abs(result.layers.reduce((s,l)=>s+l.vectorAreaMm2,0)-10000)<1e-6);
});
test('thin bands, nested holes and tiny islands remain nondegenerate with large tolerance',()=>{
  for(const thickness of [1,2,4]){
    const input=image(96,96,(x,y)=>{
      const r=Math.hypot(x-48,y-48);
      return r<3?0:r>30&&r<30+thickness?0:3;
    });
    const result=convertImage(input,{minRegionPixels:0,curveTolerance:4});
    const exact=convertImage(input,{minRegionPixels:0,curveTolerance:0});
    assert.equal(result.stats.regions,exact.stats.regions);assert.equal(result.stats.holes,exact.stats.holes);
    assert.equal(result.layers[0].contours.length,exact.layers[0].contours.length);
    if(thickness>=2) {assert.equal(result.stats.regions,2);assert.equal(result.stats.holes,1);}
    if(thickness===2) assert.ok(result.stats.fallbackBoundaries>0,'unsafe smoothing must fall back');
    const loops=result.layers[0].contours.map(flatten);
    assert.equal(winding(48,48,loops),1);assert.equal(winding(58,48,loops),0);
    assert.equal(winding(90,48,loops),0);
    for(const c of loops)assert.ok(c.length>=4);
    assert.ok(result.layers[0].vectorAreaMm2>0);
  }
});
test('curve options validate, exact mode retains grid paths, and indexed raster is unchanged',()=>{
  const input=image(64,64,(x,y)=>x<32+8*Math.sin(y/7)?0:1);
  const a=convertImage(input,{curveTolerance:0}),b=convertImage(input,{curveTolerance:1});
  assert.deepEqual(a.labels,b.labels);assert.deepEqual(a.palette,b.palette);assert.deepEqual(a.layers.map(l=>l.rings),b.layers.map(l=>l.rings));
  assert.doesNotMatch(a.svg,/Q/);assert.match(b.svg,/Q/);
  for(const curveTolerance of [-1,5,NaN,Infinity])assert.throws(()=>convertImage(input,{curveTolerance}));
});

test('a closed boundary returning to a junction keeps the junction pinned',()=>{
  const input=image(64,64,(x,y)=>Math.hypot(x-20.5,y-20.5)<16.2 || Math.hypot(x-43.5,y-43.5)<16.2?0:1);
  const result=convertImage(input,{colors:2,minRegionPixels:0,curveTolerance:1});
  const dark=result.layers.find(l=>l.color==='#183f3b');
  assert.equal(dark.contours.length,2);assert.ok(result.stats.curveSegments>0);
  for(const c of dark.contours)assert.ok([c.start,...c.segments.map(s=>s.to)].some(p=>p[0]===32&&p[1]===32));
  assertSharedCurves(result);
});
