import type { ColorLayer, Point, QuantizedImage, VectorContour, PathSegment } from './types.js';
import { signedArea } from './trace.js';

type Edge = { a: number; b: number };
type Chain = { points: Point[]; closed: boolean; exact: VectorContour; fitted: VectorContour; active: boolean };
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
export function contourArea(contour: VectorContour): number {
  let p = contour.start, area = 0;
  for (const segment of contour.segments) {
    area += segment.type === 'Q'
      ? (cross(p,segment.control)+cross(segment.control,segment.to))/3 + cross(p,segment.to)/6
      : cross(p,segment.to)/2;
    p = segment.to;
  }
  return area+cross(p,contour.start)/2;
}
export function contourPath(contours: VectorContour[]): string {
  const point = (p: Point) => `${p[0]} ${p[1]}`;
  return contours.map(c=>`M${point(c.start)}${c.segments.map(s=>s.type==='Q'?`Q${point(s.control)} ${point(s.to)}`:`L${point(s.to)}`).join('')}Z`).join('');
}
/** Flatten only for collision checks; SVG retains the actual quadratic commands. */
function flatten(contour: VectorContour): Point[] {
  const result = [contour.start];
  let p = contour.start;
  for (const s of contour.segments) {
    if (s.type==='L') result.push(s.to);
    else {
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
  return { start:points[points.length-1], segments:contour.segments.map((s,i): PathSegment=>s.type==='Q'?{type:'Q',control:s.control,to:points[i]}:{type:'L',to:points[i]}).reverse() };
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

/** Fit every undirected boundary once, then reuse it in opposite directions for its materials. */
export function vectorizeLayers(layers: ColorLayer[], image: QuantizedImage, tolerance: number, pixelSizeMm: number) {
  const stats = { pathSegments:0, curveSegments:0, simplifiedBoundaries:0, fallbackBoundaries:0 };
  const finish = () => {
    for (const layer of layers) {
      layer.path=contourPath(layer.contours);
      layer.vectorAreaMm2=layer.contours.reduce((sum,c)=>sum+contourArea(c),0)*pixelSizeMm**2;
      for(const c of layer.contours) for(const s of c.segments) { stats.pathSegments++; if(s.type==='Q') stats.curveSegments++; }
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
    const fitted=fit(points,closed && nodes.get(start)!.edges.length===2,tolerance);
    const active=JSON.stringify(exact)!==JSON.stringify(fitted);
    chains.push({points,closed,exact,fitted,active});
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
  for(let pass=0;pass<5;pass++) {
    const bad=conflicts(chains);
    references.forEach((layer,li)=>layer.forEach((refs,ri)=>{
      const old=signedArea(layers[li].rings[ri]), area=contourArea(assemble(refs));
      if (area*old<=0 || Math.abs(area)<Math.abs(old)*0.5 || Math.abs(area)>Math.abs(old)*1.5) for(const ref of refs) if(chains[ref.chain].active) bad.add(ref.chain);
    }));
    if(!bad.size) break;
    if(pass===4) chains.forEach((chain,i)=>{if(chain.active) bad.add(i);});
    for(const id of bad) if(chains[id].active) {chains[id].active=false;stats.fallbackBoundaries++;}
  }
  stats.simplifiedBoundaries=chains.filter(c=>c.active).length;
  layers.forEach((layer,i)=>{layer.contours=references[i].map(assemble);});
  return finish();
}
