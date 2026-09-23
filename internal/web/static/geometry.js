export function measurePath(points) {
  let length = 0;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    distances.push(length);
  }
  return {length, distances};
}

// Belts circulate illustrative cargo. A train must clamp to its actual track.
export function pointOnRoute(edge, distance, {wrap = true} = {}) {
  if (!edge.points.length) return {x: 0, y: 0, angle: 0, bridge: false};
  if (!(edge.length > 0)) return {...edge.points[0], angle: 0, bridge: false};
  const d = wrap ? ((distance % edge.length) + edge.length) % edge.length : Math.max(0, Math.min(edge.length, distance));
  const distances = edge.distances || measurePath(edge.points).distances;
  let lo = 1, hi = distances.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (distances[mid] < d) lo = mid + 1; else hi = mid; }
  const a = edge.points[lo - 1], b = edge.points[lo], span = distances[lo] - distances[lo - 1];
  const fraction = span ? (d - distances[lo - 1]) / span : 0;
  return {x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    bridge: (edge.bridges || []).some(bridge => d > bridge.startDistance && d < bridge.endDistance)};
}

export function roundRailCorners(points, radius = 10) {
  if (points.length < 3) return points;
  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    if ((b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x)) simplified.push(b);
  }
  simplified.push(points.at(-1));
  const result = [simplified[0]];
  for (let i = 1; i < simplified.length - 1; i++) {
    const a = simplified[i - 1], b = simplified[i], c = simplified[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, before / 2, after / 2);
    const start = {x: b.x + (a.x - b.x) * r / before, y: b.y + (a.y - b.y) * r / before};
    const end = {x: b.x + (c.x - b.x) * r / after, y: b.y + (c.y - b.y) * r / after};
    result.push(start);
    for (let step = 1; step <= 6; step++) {
      const t = step / 6, u = 1 - t;
      result.push({x: u * u * start.x + 2 * u * t * b.x + t * t * end.x, y: u * u * start.y + 2 * u * t * b.y + t * t * end.y});
    }
  }
  result.push(simplified.at(-1));
  return result;
}
