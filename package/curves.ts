import type { ColorLayer, Point, QuantizedImage, VectorContour, PathSegment } from './types.js';
import { signedArea } from './trace.js';

type Edge = { a: number; b: number };
type Chain = { points: Point[]; closed: boolean; exact: VectorContour; fitted: VectorContour; active: boolean; attempts: number };
type Ref = { chain: number; reverse: boolean };
type Line = { a: Point; b: Point; chain: number; index: number; count: number };
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const cross = (a: Point, b: Point) => a[0]*b[1]-a[1]*b[0];
const sub = (a: Point, b: Point): Point => [a[0]-b[0], a[1]-b[1]];
const length = (a: Point, b: Point) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const mix = (a: Point, b: Point, t = 0.5): Point => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
const round = (p: Point): Point => [Math.round(p[0]*1000)/1000, Math.round(p[1]*1000)/1000];
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const v = sub(b,a), d = v[0]**2+v[1]**2;
  const t = d ? Math.max(0,Math.min(1,((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/d)) : 0;
  return length(p,mix(a,b,t));
}
/** Iterative RDP, retaining actual corners and bounded stack depth. */
function simplify(points: Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length-1] = 1;
  const stack: number[] = [0,points.length-1];
  let budget = 2_000_000;
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!;
    let farthest = -1, error = tolerance;
    for (let i = start+1; i < end; i++) {
      if (--budget < 0) return points; // Pathological contours retain detail rather than block the worker.
      const d = distanceToSegment(points[i],points[start],points[end]);
      if (d > error) { error = d; farthest = i; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push(start,farthest,farthest,end); }
  }
  return points.filter((_,i)=>keep[i]);
}
function exactContour(points: Point[]): VectorContour {
  return { start: points[0], segments: points.slice(1).map(to=>({type:'L',to})) };
}
function fit(points: Point[], closed: boolean, tolerance: number): VectorContour {
  // Tiny islands and short chains have too little evidence to infer a curve safely.
  if (points.length < 5 || points.reduce((sum,p,i)=>sum+(i ? length(points[i-1],p):0),0) < 8) return exactContour(points);
  let polygon: Point[];
  if (closed) {
    let split = 1;
    for (let i=2;i<points.length-1;i++) if (length(points[0],points[i])>length(points[0],points[split])) split=i;
    polygon = [...simplify(points.slice(0,split+1),tolerance).slice(0,-1), ...simplify(points.slice(split),tolerance).slice(0,-1)];
    if (polygon.length < 3) return exactContour(points);
  } else polygon = simplify(points,tolerance);
  const n = polygon.length;
  const entries: Point[] = [], exits: Point[] = [], smooth: boolean[] = [];
  for (let i=0;i<n;i++) {
    const p = polygon[i], before = polygon[(i+n-1)%n], after = polygon[(i+1)%n];
    const a = sub(p,before), b = sub(after,p), la = length(before,p), lb = length(p,after);
    const cosine = (a[0]*b[0]+a[1]*b[1])/(la*lb || 1);
    // Turns >=60 degrees remain sharp. Long straight portions stay straight.
    const curve = (closed || (i>0 && i<n-1)) && cosine > 0.5 && cosine < 0.9999;
    const radius = Math.min(0.5,tolerance / Math.max(1e-9,distanceToSegment(p,before,after)));
    entries.push(curve ? round(mix(p,before,radius)) : p);
    exits.push(curve ? round(mix(p,after,radius)) : p);
    smooth.push(curve);
  }
  const start = entries[0], segments: PathSegment[] = [];
  let current = start;
  const line = (to: Point) => {
    if (same(current,to)) return;
    const last = segments[segments.length-1];
    const previous = segments.length>1 ? segments[segments.length-2].to : start;
    if (last?.type === 'L' && Math.abs(cross(sub(last.to,previous),sub(to,last.to))) < 1e-9) last.to = to;
    else segments.push({type:'L',to});
    current = to;
  };
  for (let i=0;i<n;i++) {
    line(entries[i]);
    if (smooth[i]) { segments.push({type:'Q',control:polygon[i],to:exits[i]}); current=exits[i]; }
    else line(exits[i]);
  }
  if (closed) line(start);
  return {start,segments};
}
const unit = (v: Point): Point => { const size = Math.hypot(...v); return size ? [v[0]/size,v[1]/size] : [1,0]; };
type Cubic = [Point,Point,Point,Point];
const xy = (coordinate: (axis:number)=>number): Point => [coordinate(0),coordinate(1)];
function cubicAt(c: Cubic, t: number): Point {
  const u=1-t;
  return xy(axis=>u**3*c[0][axis]+3*u*u*t*c[1][axis]+3*u*t*t*c[2][axis]+t**3*c[3][axis]);
}
/** Least-squares cubic fitting with shared split tangents and bounded refinement. */
function fitHigh(points: Point[], closed: boolean, tolerance: number, smoothing = 1): VectorContour {
  const original=points;
  const total=points.reduce((sum,p,i)=>sum+(i?length(points[i-1],p):0),0);
  if(points.length<5 || total<8 || total>250_000) return exactContour(points);
  let split=1;
  if(closed) for(let i=2;i<points.length-1;i++) if(length(points[0],points[i])>length(points[0],points[split])) split=i;
  const guide=closed
    ? [...simplify(points.slice(0,split+1),Math.max(0.75,tolerance)).slice(0,-1),...simplify(points.slice(split),Math.max(0.75,tolerance)).slice(0,-1)]
    : simplify(points,Math.max(0.75,tolerance));
  const pointIndices=new Map(points.slice(0,closed?-1:points.length).map((p,i)=>[p,i]));
  let corners=new Set<number>();
  for(let i=closed?0:1;i<(closed?guide.length:guide.length-1);i++) {
    const a=sub(guide[i],guide[(i+guide.length-1)%guide.length]), b=sub(guide[(i+1)%guide.length],guide[i]);
    const la=Math.hypot(...a),lb=Math.hypot(...b);
    if(la>=2 && lb>=2 && (a[0]*b[0]+a[1]*b[1])/(la*lb)<=0.5) {
      const index=pointIndices.get(guide[i])!, n=points.length-1;
      const probe=Math.max(12,6*smoothing);
      let before=index,after=index,back=0,forward=0;
      while(back<probe) {const next=before>0?before-1:closed?n-1:before;if(next===before) break;back+=length(points[before],points[next]);before=next;}
      while(forward<probe) {const next=after<n?after+1:closed?1:after;if(next===after) break;forward+=length(points[after],points[next]);after=next;}
      const incoming=unit(sub(points[index],points[before])),outgoing=unit(sub(points[after],points[index]));
      // A coarse-guide kink must also be visible beyond the raster staircase scale.
      if(incoming[0]*outgoing[0]+incoming[1]*outgoing[1]<=0.65) corners.add(index);
    }
  }
  if(smoothing) {
    const sampled:Point[]=[points[0]],offsets=[0];
    for(let i=1;i<points.length;i++) {
      const count=Math.max(1,Math.ceil(length(points[i-1],points[i])));
      for(let j=1;j<=count;j++) sampled.push(mix(points[i-1],points[i],j/count));
      offsets.push(sampled.length-1);
    }
    corners=new Set([...corners].map(i=>offsets[i]));
    split=offsets[split];
    // Smooth each shared boundary once. Major corners and graph junctions stay pinned.
    const count=sampled.length-1,radius=Math.ceil(3*smoothing);
    const pins=new Set(corners);
    if(!closed) {pins.add(0);pins.add(count);}
    const weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-0.5*((i-radius)/smoothing)**2));
    const weightSum=weights.reduce((a,b)=>a+b,0);
    const before=unit(sub(sampled[1],sampled[0])),after=unit(sub(sampled[count],sampled[count-1]));
    const at=(i:number):Point=>closed?sampled[(i%count+count)%count]:i<0?[sampled[0][0]+before[0]*i,sampled[0][1]+before[1]*i]:i>count?[sampled[count][0]+after[0]*(i-count),sampled[count][1]+after[1]*(i-count)]:sampled[i];
    points=sampled.map((p,i)=>{
      let nearest=radius;
      for(let delta=-radius;delta<=radius;delta++) if(pins.has(closed?((i+delta)%count+count)%count:i+delta)) nearest=Math.min(nearest,Math.abs(delta));
      const t=nearest/radius,blend=t*t*(3-2*t);
      if(!blend) return p;
      let x=0,y=0;
      for(let delta=-radius;delta<=radius;delta++) {const q=at(i+delta),weight=weights[delta+radius];x+=q[0]*weight;y+=q[1]*weight;}
      return round(mix(p,[x/weightSum,y/weightSum],blend));
    });
    if(closed) points[count]=points[0];
  }
  const anchors=[...new Set([0,...corners,...(closed?[split]:[]),points.length-1])].sort((a,b)=>a-b);
  // Estimate tangents across several pixel steps, rather than a single horizontal/vertical edge.
  const tangent=(index:number): Point=>{
    let before=index,after=index,back=0,forward=0;
    const n=points.length-1;
    while(back<4) {
      const next=before>0?before-1:closed?n-1:before;
      if(next===before) break; back+=length(points[before],points[next]);before=next;
    }
    while(forward<4) {
      const next=after<n?after+1:closed?1:after;
      if(next===after) break;forward+=length(points[after],points[next]);after=next;
    }
    return unit(sub(points[after],points[before]));
  };
  const segments:PathSegment[]=[];
  let budget=2_000_000;
  for(let ai=1;ai<anchors.length;ai++) {
    const first=anchors[ai-1],last=anchors[ai];
    // Uniform arc-length samples prevent long collinear raster runs being underweighted.
    const samples:Point[]=[points[first]];
    for(let i=first+1;i<=last;i++) {
      const count=Math.max(1,Math.ceil(length(points[i-1],points[i])));
      for(let j=1;j<=count;j++) samples.push(mix(points[i-1],points[i],j/count));
    }
    const localTangent=(index:number)=>unit(sub(samples[Math.min(samples.length-1,index+4)],samples[Math.max(0,index-4)]));
    const startTangent=corners.has(first)?localTangent(0):tangent(first);
    const endTangent=(corners.has(last) || closed && last===points.length-1 && corners.has(0))?localTangent(samples.length-1):tangent(last);
    const stack:{start:number;end:number;left:Point;right:Point;depth:number}[]=[{start:0,end:samples.length-1,left:startTangent,right:endTangent,depth:0}];
    while(stack.length) {
      const job=stack.pop()!, {start,end,left,right,depth}=job;
      const data=samples.slice(start,end+1), a=data[0],b=data[data.length-1];
      budget-=data.length*6;
      if(budget<0) return exactContour(original);
      if(depth>=20) return exactContour(original);
      if(data.length===2) {segments.push({type:'L',to:b});continue;}
      const chord=unit(sub(b,a));
      if(chord[0]*left[0]+chord[1]*left[1]>0.999 && chord[0]*right[0]+chord[1]*right[1]>0.999 && data.every(p=>distanceToSegment(p,a,b)<=tolerance)) {
        segments.push({type:'L',to:b});continue;
      }
      const parameters=[0];
      for(let i=1;i<data.length;i++) parameters.push(parameters[i-1]+length(data[i-1],data[i]));
      const arc=parameters[parameters.length-1];
      let ts=parameters.map(t=>t/arc), worst=1, best:Cubic|undefined;
      for(let iteration=0;iteration<5;iteration++) {
        let aa=0,ab=0,bb=0,ax=0,bx=0;
        for(let i=0;i<data.length;i++) {
          const t=ts[i],u=1-t,k1=3*u*u*t,k2=3*u*t*t;
          const v:Point=[left[0]*k1,left[1]*k1],w:Point=[-right[0]*k2,-right[1]*k2];
          const residual:Point=[data[i][0]-(u**3+k1)*a[0]-(k2+t**3)*b[0],data[i][1]-(u**3+k1)*a[1]-(k2+t**3)*b[1]];
          aa+=v[0]**2+v[1]**2;ab+=v[0]*w[0]+v[1]*w[1];bb+=w[0]**2+w[1]**2;
          ax+=v[0]*residual[0]+v[1]*residual[1];bx+=w[0]*residual[0]+w[1]*residual[1];
        }
        const determinant=aa*bb-ab*ab;
        let h1=(ax*bb-bx*ab)/determinant,h2=(bx*aa-ax*ab)/determinant;
        if(!Number.isFinite(h1) || !Number.isFinite(h2) || h1<arc*1e-6 || h2<arc*1e-6 || h1>arc*2 || h2>arc*2) h1=h2=length(a,b)/3;
        const c:Cubic=[a,round([a[0]+left[0]*h1,a[1]+left[1]*h1]),round([b[0]-right[0]*h2,b[1]-right[1]*h2]),b];
        let error=0;
        for(let i=1;i<data.length-1;i++) {const d=length(data[i],cubicAt(c,ts[i]));if(d>error){error=d;worst=i;}}
        if(error<=tolerance) {best=c;break;}
        // Newton projection, accepted only while the parameter ordering remains monotonic.
        const projected=ts.map((t,i)=>{
          if(i===0 || i===ts.length-1) return t;
          const u=1-t,p=cubicAt(c,t);
          const d:Point=xy(k=>3*u*u*(c[1][k]-c[0][k])+6*u*t*(c[2][k]-c[1][k])+3*t*t*(c[3][k]-c[2][k]));
          const dd:Point=xy(k=>6*u*(c[2][k]-2*c[1][k]+c[0][k])+6*t*(c[3][k]-2*c[2][k]+c[1][k]));
          const delta=sub(p,data[i]),denominator=d[0]**2+d[1]**2+delta[0]*dd[0]+delta[1]*dd[1];
          return Math.max(0,Math.min(1,t-(delta[0]*d[0]+delta[1]*d[1])/(denominator||1)));
        });
        if(projected.some((t,i)=>i>0 && t<=projected[i-1])) break;
        ts=projected;
      }
      if(best) segments.push({type:'C',control1:best[1],control2:best[2],to:b});
      else {
        const middle=start+worst, direction=localTangent(middle);
        stack.push({start:middle,end,left:direction,right,depth:depth+1},{start,end:middle,left,right:direction,depth:depth+1});
      }
    }
  }
  return {start:points[0],segments};
}

export function contourArea(contour: VectorContour): number {
  let p = contour.start, area = 0;
  for (const segment of contour.segments) {
    if (segment.type === 'C') {
      const a=segment.control1,b=segment.control2,q=segment.to;
      const coefficients:Point[]=[p,[3*(a[0]-p[0]),3*(a[1]-p[1])],[3*(p[0]-2*a[0]+b[0]),3*(p[1]-2*a[1]+b[1])],[q[0]-p[0]+3*(a[0]-b[0]),q[1]-p[1]+3*(a[1]-b[1])]];
      for(let i=0;i<4;i++) for(let j=1;j<4;j++) area+=cross(coefficients[i],coefficients[j])*j/(i+j)/2;
    } else area += segment.type === 'Q'
      ? (cross(p,segment.control)+cross(segment.control,segment.to))/3 + cross(p,segment.to)/6
      : cross(p,segment.to)/2;
    p = segment.to;
  }
  return area+cross(p,contour.start)/2;
}
export function contourPath(contours: VectorContour[]): string {
  const point = (p: Point) => `${p[0]} ${p[1]}`;
  return contours.map(c=>`M${point(c.start)}${c.segments.map(s=>s.type==='C'?`C${point(s.control1)} ${point(s.control2)} ${point(s.to)}`:s.type==='Q'?`Q${point(s.control)} ${point(s.to)}`:`L${point(s.to)}`).join('')}Z`).join('');
}
/** Flatten only for collision checks; SVG retains the actual quadratic/cubic commands. */
function flatten(contour: VectorContour): Point[] {
  const result = [contour.start];
  let p = contour.start;
  for (const s of contour.segments) {
    if (s.type==='L') result.push(s.to);
    else if(s.type==='C') {
      const stack:[Cubic,number][]=[[[p,s.control1,s.control2,s.to],0]];
      while(stack.length) {
        const [c,depth]=stack.pop()!;
        if(depth>=12 || Math.max(distanceToSegment(c[1],c[0],c[3]),distanceToSegment(c[2],c[0],c[3]))<=0.015) result.push(c[3]);
        else {
          const ab=mix(c[0],c[1]),bc=mix(c[1],c[2]),cd=mix(c[2],c[3]),abc=mix(ab,bc),bcd=mix(bc,cd),center=mix(abc,bcd);
          stack.push([[center,bcd,cd,c[3]],depth+1],[[c[0],ab,abc,center],depth+1]);
        }
      }
    } else {
      const stack: [Point,Point,Point,number][] = [[p,s.control,s.to,0]];
      while (stack.length) {
        const [a,b,c,depth] = stack.pop()!;
        if (depth>=12 || distanceToSegment(b,a,c)<=0.015) result.push(c);
        else { const ab=mix(a,b), bc=mix(b,c), center=mix(ab,bc); stack.push([center,bc,c,depth+1],[a,ab,center,depth+1]); }
      }
    }
    p=s.to;
  }
  return result;
}
function reversed(contour: VectorContour): VectorContour {
  const points = [contour.start,...contour.segments.map(s=>s.to)];
  return { start:points[points.length-1], segments:contour.segments.map((s,i): PathSegment=>s.type==='C'?{type:'C',control1:s.control2,control2:s.control1,to:points[i]}:s.type==='Q'?{type:'Q',control:s.control,to:points[i]}:{type:'L',to:points[i]}).reverse() };
}
function linesOf(chains: Chain[], original = false): Line[] {
  const lines: Line[] = [];
  chains.forEach((c,chain)=>{
    const p = flatten(original || !c.active ? c.exact : c.fitted), start = lines.length;
    for (let i=1;i<p.length;i++) {
      const divisions = Math.max(1,Math.ceil(length(p[i-1],p[i])/8));
      for (let j=0;j<divisions;j++) lines.push({a:mix(p[i-1],p[i],j/divisions),b:mix(p[i-1],p[i],(j+1)/divisions),chain,index:lines.length-start,count:0});
    }
    for (let i=start;i<lines.length;i++) lines[i].count=lines.length-start;
  });
  return lines;
}
function collides(a: Line, b: Line, allowTouch: boolean): boolean {
  const u=sub(a.b,a.a), v=sub(b.b,b.a), w=sub(b.a,a.a), determinant=cross(u,v);
  if (Math.abs(determinant)>1e-10) {
    const t=cross(w,v)/determinant, s=cross(w,u)/determinant;
    if (t<-1e-8 || t>1+1e-8 || s<-1e-8 || s>1+1e-8) return false;
    // A common endpoint is a graph junction (or a consecutive flattened segment).
    return !(allowTouch && (Math.abs(t)<1e-8 || Math.abs(t-1)<1e-8) && (Math.abs(s)<1e-8 || Math.abs(s-1)<1e-8));
  }
  if (Math.abs(cross(w,u))>1e-8) return false;
  const axis = Math.abs(u[0])>Math.abs(u[1]) ? 0 : 1;
  const overlap = Math.min(Math.max(a.a[axis],a.b[axis]),Math.max(b.a[axis],b.b[axis])) - Math.max(Math.min(a.a[axis],a.b[axis]),Math.min(b.a[axis],b.b[axis]));
  return overlap > 1e-7 || (!allowTouch && overlap >= -1e-8);
}
function conflicts(chains: Chain[]): Set<number> {
  const canTouch = (a:Line,b:Line): boolean => {
    if(a.chain===b.chain) return false;
    const first=chains[a.chain].points, second=chains[b.chain].points;
    return [first[0],first[first.length-1]].some(p=>
      (same(p,second[0]) || same(p,second[second.length-1])) &&
      (same(p,a.a) || same(p,a.b)) && (same(p,b.a) || same(p,b.b)));
  };
  const bad = new Set<number>(), grid = new Map<string,Line[]>();
  const cells = (s: Line) => {
    const keys: string[] = [];
    for(let y=Math.floor(Math.min(s.a[1],s.b[1])/8);y<=Math.floor(Math.max(s.a[1],s.b[1])/8);y++)
      for(let x=Math.floor(Math.min(s.a[0],s.b[0])/8);x<=Math.floor(Math.max(s.a[0],s.b[0])/8);x++) keys.push(`${x},${y}`);
    return keys;
  };
  const insert = (line: Line) => { for(const key of cells(line)) { const bucket=grid.get(key); if(bucket) bucket.push(line); else grid.set(key,[line]); } };
  // A fitted chain cannot jump across another chain's original boundary either.
  for (const line of linesOf(chains,true)) insert(line);
  const candidates = linesOf(chains);
  for (const line of candidates) if (chains[line.chain].active) {
    const seen = new Set<Line>();
    for (const key of cells(line)) for (const other of grid.get(key) ?? []) if (!seen.has(other)) {
      seen.add(other);
      if (other.chain!==line.chain && collides(line,other,canTouch(line,other))) bad.add(line.chain);
    }
  }
  grid.clear();
  for (const line of candidates) {
    const seen = new Set<Line>();
    for (const key of cells(line)) for(const other of grid.get(key) ?? []) if (!seen.has(other)) {
      seen.add(other);
      if (!chains[line.chain].active && !chains[other.chain].active) continue;
      if (line.chain===other.chain && (Math.abs(line.index-other.index)<=1 || (chains[line.chain].closed && Math.abs(line.index-other.index)===line.count-1))) continue;
      if (collides(line,other,canTouch(line,other))) { if(chains[line.chain].active) bad.add(line.chain); if(chains[other.chain].active) bad.add(other.chain); }
    }
    insert(line);
  }
  return bad;
}

/** A contour can cross itself where separately fitted chains meet, even when
 * each shared chain is individually simple. Check the assembled outline. */
export function contourCrossesItself(contour: VectorContour): boolean {
  // Downstream SVG fill parsers commonly use 16 uniform subdivisions per
  // curve. Their polygon can cross near a contour seam even when adaptive
  // flattening misses that narrow overshoot.
  const points:Point[]=[contour.start];
  let from=contour.start;
  for(const segment of contour.segments) {
    if(segment.type==='L') points.push(segment.to);
    else for(let step=1;step<=16;step++) {
      const t=step/16,u=1-t;
      points.push(segment.type==='C'
        ? cubicAt([from,segment.control1,segment.control2,segment.to],t)
        : [u*u*from[0]+2*u*t*segment.control[0]+t*t*segment.to[0],
          u*u*from[1]+2*u*t*segment.control[1]+t*t*segment.to[1]]);
    }
    from=segment.to;
  }
  const lines:Line[]=[];
  for(let i=1;i<points.length;i++) if(!same(points[i-1],points[i]))
    lines.push({a:points[i-1],b:points[i],chain:0,index:lines.length,count:0});
  if(lines.length<3) return false;
  for(const line of lines) line.count=lines.length;
  const grid=new Map<string,Line[]>();
  for(const line of lines) {
    const seen=new Set<Line>();
    for(let y=Math.floor(Math.min(line.a[1],line.b[1])/8);y<=Math.floor(Math.max(line.a[1],line.b[1])/8);y++)
      for(let x=Math.floor(Math.min(line.a[0],line.b[0])/8);x<=Math.floor(Math.max(line.a[0],line.b[0])/8);x++) {
        const key=`${x},${y}`, bucket=grid.get(key) ?? [];
        for(const other of bucket) if(!seen.has(other)) {
          seen.add(other);
          if(line.index-other.index>1 && !(line.index===lines.length-1 && other.index===0)
            && collides(line,other,false)) return true;
        }
        bucket.push(line);grid.set(key,bucket);
      }
  }
  return false;
}

/** Fit every undirected boundary once, then reuse it in opposite directions for its materials. */
export function vectorizeLayers(layers: ColorLayer[], image: QuantizedImage, tolerance: number, pixelSizeMm: number, quality: 'balanced' | 'high' = 'balanced', smoothing = 1) {
  const stats = { pathSegments:0, curveSegments:0, simplifiedBoundaries:0, fallbackBoundaries:0 };
  const finish = () => {
    for (const layer of layers) {
      layer.path=contourPath(layer.contours);
      layer.vectorAreaMm2=layer.contours.reduce((sum,c)=>sum+contourArea(c),0)*pixelSizeMm**2;
      for(const c of layer.contours) for(const s of c.segments) { stats.pathSegments++; if(s.type!=='L') stats.curveSegments++; }
    }
    return stats;
  };
  // Keep the exact mode for pixel art and previous raster-coverage contracts.
  if (!tolerance || layers.reduce((n,l)=>n+l.rings.reduce((sum,r)=>sum+r.length,0),0)>250_000) {
    if (tolerance) stats.fallbackBoundaries=layers.reduce((n,l)=>n+l.rings.length,0);
    return finish();
  }
  const stride=image.width+1, key=(p: Point)=>p[1]*stride+p[0];
  const nodes=new Map<number,{p:Point;edges:number[]}>(), edges: Edge[]=[], lookup=new Map<string,number>();
  const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  const ringEdges=layers.map(layer=>layer.rings.map(ring=>ring.map((p,i)=>{
    const next=ring[(i+1)%ring.length], a=key(p), b=key(next), k=edgeKey(a,b);
    let id=lookup.get(k);
    if(id===undefined) {
      id=edges.length; lookup.set(k,id); edges.push({a,b});
      if(!nodes.has(a)) nodes.set(a,{p,edges:[]}); if(!nodes.has(b)) nodes.set(b,{p:next,edges:[]});
      nodes.get(a)!.edges.push(id); nodes.get(b)!.edges.push(id);
    }
    return {id,from:a};
  })));
  const visited=new Uint8Array(edges.length), assignment: {chain:number;from:number}[]=[], chains: Chain[]=[];
  function walk(start:number, first:number) {
    const points:Point[]=[nodes.get(start)!.p]; let current=start, id=first;
    while(!visited[id]) {
      visited[id]=1; assignment[id]={chain:chains.length,from:current};
      const e=edges[id]; current=e.a===current?e.b:e.a; const node=nodes.get(current)!; points.push(node.p);
      if(current===start || node.edges.length!==2) break;
      id=node.edges[0]===id?node.edges[1]:node.edges[0];
    }
    const closed=current===start, exact=exactContour(points);
    // A cycle based at a junction must keep that junction fixed, just like an open chain.
    const freeLoop=closed && nodes.get(start)!.edges.length===2;
    const fitted=quality==='high'?fitHigh(points,freeLoop,tolerance,smoothing):fit(points,freeLoop,tolerance);
    const active=JSON.stringify(exact)!==JSON.stringify(fitted);
    chains.push({points,closed,exact,fitted,active,attempts:0});
  }
  for(const [id,node] of nodes) if(node.edges.length!==2) for(const edge of node.edges) if(!visited[edge]) walk(id,edge);
  for(let id=0;id<edges.length;id++) if(!visited[id]) walk(Math.min(edges[id].a,edges[id].b),id);
  const references=ringEdges.map(layer=>layer.map(ring=>{
    const refs:Ref[]=[];
    for(const e of ring) {
      const assigned=assignment[e.id], reverse=assigned.from!==e.from;
      if(refs[refs.length-1]?.chain!==assigned.chain || refs[refs.length-1]?.reverse!==reverse) refs.push({chain:assigned.chain,reverse});
    }
    if(refs.length>1 && refs[0].chain===refs[refs.length-1].chain && refs[0].reverse===refs[refs.length-1].reverse) refs.pop();
    return refs;
  }));
  function assemble(refs: Ref[]): VectorContour {
    let start: Point | undefined; const segments:PathSegment[]=[];
    for(const ref of refs) {
      const chain=chains[ref.chain]; let c=chain.active?chain.fitted:chain.exact;
      if(ref.reverse) c=reversed(c);
      if(!start) start=c.start;
      else if(!same(segments[segments.length-1].to,c.start)) throw new Error('Shared contour endpoints do not match.');
      for(const s of c.segments) segments.push(s);
    }
    if(!same(segments[segments.length-1].to,start!)) throw new Error('Vector contour is not closed.');
    return {start:start!,segments};
  }
  const retries=quality==='high'?(smoothing?[{tolerance,smoothing:smoothing/2},{tolerance,smoothing:0},{tolerance:tolerance/2,smoothing:0}]:[{tolerance:tolerance/2,smoothing:0}]):[];
  const passes=quality==='high'?8:5;
  for(let pass=0;pass<passes;pass++) {
    const bad=conflicts(chains);
    references.forEach((layer,li)=>layer.forEach((refs,ri)=>{
      const contour=assemble(refs), old=signedArea(layers[li].rings[ri]), area=contourArea(contour);
      if (area*old<=0 || Math.abs(area)<Math.abs(old)*0.5 || Math.abs(area)>Math.abs(old)*1.5
        || quality==='high' && contourCrossesItself(contour))
        for(const ref of refs) if(chains[ref.chain].active) bad.add(ref.chain);
    }));
    if(!bad.size) break;
    if(pass===passes-1) chains.forEach((chain,i)=>{if(chain.active) bad.add(i);});
    for(const id of bad) {
      const chain=chains[id];
      if(!chain.active) continue;
      const retry=retries[chain.attempts++];
      if(pass<passes-1 && retry) {
        const freeLoop=chain.closed && nodes.get(key(chain.points[0]))!.edges.length===2;
        chain.fitted=fitHigh(chain.points,freeLoop,retry.tolerance,retry.smoothing);
        chain.active=JSON.stringify(chain.exact)!==JSON.stringify(chain.fitted);
        if(chain.active) continue;
      }
      chain.active=false;stats.fallbackBoundaries++;
    }
  }
  stats.simplifiedBoundaries=chains.filter(c=>c.active).length;
  layers.forEach((layer,i)=>{layer.contours=references[i].map(assemble);});
  return finish();
}
