import {pointOnRoute,measurePath} from './geometry.js';
import {trainOnRoute} from './trains.js';
import {edgeStyles,drawCargoShape} from './appearance.js';

function stroke(c, points, color, width) {
  if (points.length < 2) return;
  c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
  c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'butt'; c.stroke();
}
function offsetPath(points, offset) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {x: p.x - (b.y - a.y) / length * offset, y: p.y + (b.x - a.x) / length * offset};
  });
}
function box(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }

const arrowCache=new WeakMap();
// Static distance-based markings remain readable when animation is paused or
// captured. Measure each run in its actual (possibly elevated) coordinates.
export function beltArrowMarkers(points,zoom=1){
  const scale=Math.max(.05,zoom),cached=arrowCache.get(points);
  if(cached?.scale===scale)return cached.markers;
  const route={points,...measurePath(points)},spacing=Math.max(36,36/scale),markers=[];
  const count=Math.ceil(route.length/spacing),step=route.length/count;
  for(let i=0;i<count;i++)markers.push(pointOnRoute(route,(i+.5)*step,{wrap:false}));
  arrowCache.set(points,{scale,markers});return markers;
}

export function drawBeltArrows(c,points,zoom=1){
  const markers=beltArrowMarkers(points,zoom);if(!markers.length)return;
  const scale=Math.max(.05,zoom),size=Math.min(9,Math.max(5,5/scale)),halfWidth=size*.65;
  c.save();c.beginPath();
  for(const p of markers){
    const dx=Math.cos(p.angle),dy=Math.sin(p.angle),backX=p.x-dx*size*.5,backY=p.y-dy*size*.5;
    c.moveTo(backX+dy*halfWidth,backY-dx*halfWidth);
    c.lineTo(p.x+dx*size*.5,p.y+dy*size*.5);
    c.lineTo(backX-dy*halfWidth,backY+dx*halfWidth);
  }
  c.setLineDash([]);c.lineJoin='round';c.lineCap='round';
  c.strokeStyle='#101a16';c.lineWidth=Math.max(3.5,2.6/Math.max(.3,scale));c.stroke();
  c.strokeStyle='#f3efd6';c.lineWidth=Math.max(1.7,1.3/Math.max(.3,scale));c.stroke();c.restore();
}

function typedStripe(c,points,styles,width) {
  if(styles.length===1){stroke(c,points,styles[0].color,width);return;}
  // Mixed cargo shares a striped belt; each colored segment corresponds to an
  // actual payload type, including synthetic merger/section/package routes.
  const segment=14;
  styles.forEach((style,i)=>{
    c.setLineDash([segment,segment*(styles.length-1)]);c.lineDashOffset=-i*segment;
    stroke(c,points,style.color,width);
  });
  c.setLineDash([]);c.lineDashOffset=0;
}

export function drawTrack(c, edge) {
  const styles=edgeStyles(edge);
  stroke(c, edge.points, '#17271d', 26);
  stroke(c, edge.points, '#475543', 22);
  typedStripe(c,edge.points,styles,4);
  for (let d = 5; d < edge.length; d += 12) {
    const p = pointOnRoute(edge, d, {wrap: false});
    c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
    box(c, -2, -13, 4, 26, '#273429'); box(c, -1, -12, 2, 24, '#8d8b67'); c.restore();
  }
  for (const side of [-7, 7]) {
    const rail = offsetPath(edge.points, side);
    stroke(c, rail, '#18291f', 5); stroke(c, rail, '#bbc4aa', 2.5);
    stroke(c, offsetPath(edge.points, side - .8), '#e0dfbd', .8);
  }
  for (const d of [0, edge.length]) {
    const p = pointOnRoute(edge, d, {wrap: false});
    c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
    box(c, -3, -13, 6, 26, '#b89e66'); box(c, -2, -10, 4, 20, '#725340'); c.restore();
  }
}

export function drawGroundBelt(c, edge, time, zoom) {
  const styles=edgeStyles(edge);
  for (const points of edge.groundRuns) {
    stroke(c, points, '#142117', 16);typedStripe(c,points,styles,13);stroke(c, points, styles.length===1?styles[0].dark:'#303b35', 8);
    if (zoom > .18) {
      c.setLineDash([2, 7]); c.lineDashOffset = -time * 24;
      stroke(c, points, '#e4ead13d', 7); c.setLineDash([]); c.lineDashOffset = 0;
    }
    drawBeltArrows(c,points,zoom);
  }
}

export function drawBridge(c, bridge, time, zoom, edge={}) {
  const styles=edgeStyles(edge);
  stroke(c, bridge.basePoints.map(p => ({x: p.x + 4, y: p.y + 6})), '#0c160b88', 25);
  // Abutments, lifted deck and two guard rails make the level change explicit.
  for (const p of [bridge.basePoints[0], bridge.basePoints.at(-1)]) {
    box(c, p.x - 9, p.y - 6, 18, 18, '#707866'); box(c, p.x - 9, p.y + 7, 18, 5, '#384a39');
  }
  stroke(c, bridge.points, '#111f19', 24);
  typedStripe(c,bridge.points,styles,21);
  stroke(c, bridge.points, styles.length===1?styles[0].dark:'#303b35', 13);
  if (zoom > .18) {
    c.setLineDash([3, 7]); c.lineDashOffset = -time * 24;
    stroke(c, bridge.points, '#e4ead13d', 11); c.setLineDash([]); c.lineDashOffset = 0;
  }
  for (const side of [-10, 10]) {
    stroke(c, offsetPath(bridge.points, side), '#c0d3b1', 2);
    c.setLineDash([2, 11]); stroke(c, offsetPath(bridge.points, side), '#e6ca83', 4); c.setLineDash([]);
  }
  drawBeltArrows(c,bridge.points,zoom);
}

export function drawBeltCargo(c, edge, time, elevated) {
  if (!(edge.length > 0)) return;
  const styles=edgeStyles(edge);
  const count = Math.min(18, Math.max(1, Math.floor(edge.length / 140)));
  for (let i = 0; i < count; i++) {
    const distance=time*31+(edge.index||0)*17+i*edge.length/count;
    const p = pointOnRoute(edge, distance);
    if (p.bridge !== elevated) continue;
    // Change payload only when it exits and re-enters at the route endpoint.
    const style=styles[((i+Math.floor(distance/edge.length))%styles.length+styles.length)%styles.length];
    c.save();c.translate(p.x,p.y);box(c,-4,-2,10,10,'#101b1680');
    drawCargoShape(c,style);c.restore();
  }
}

export function drawTrain(c, edge, time) {
  const train = trainOnRoute(edge, time); if (!train) return;
  const styles=edgeStyles(edge),trip=Math.floor((time+(edge.index||0)*.37)/train.period);
  for (let i = 1; i < train.cars.length; i++) stroke(c, [train.cars[i - 1].back, train.cars[i].front], '#c1b58b', 3);
  for (const car of [...train.cars].reverse()) {
    // Both bogies follow the curved rail, rather than wrapping around the line.
    for (const bogie of [car.front, car.back]) {
      c.save(); c.translate(bogie.x, bogie.y); c.rotate(bogie.angle);
      box(c, -3, -10, 6, 4, '#12221b'); box(c, -3, 6, 6, 4, '#12221b');
      box(c, -1, -10, 2, 20, '#819282'); c.restore();
    }
    c.save(); c.translate(car.x, car.y); c.rotate(car.angle);
    const style=styles[(car.index+trip)%styles.length];
    box(c, -12, -9, 25, 19, '#0b1d1580');
    if (car.locomotive) {
      box(c,-12,-8,24,16,style.dark);box(c,-11,-7,22,14,style.color);
      box(c, -7, -5, 7, 10, '#294d46'); box(c, -6, -4, 4, 8, '#9bc0af');
      box(c, 2, -5, 7, 10, '#84754f'); box(c, 5, -3, 3, 6, '#343e31');
      box(c, 10, -5, 3, 3, train.direction > 0 ? '#fff0b0' : '#c6754d');
      box(c, 10, 2, 3, 3, train.direction > 0 ? '#fff0b0' : '#c6754d');
    } else {
      box(c,-12,-3,24,6,style.dark);
      drawCargoShape(c,style,0,0,23,16);
      box(c,-1,-5,2,10,style.dark);
      drawCargoShape(c,style,-5,0,6,6);drawCargoShape(c,style,5,0,6,6);
    }
    c.restore();
  }
}
