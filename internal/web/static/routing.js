import {mergeCargoTypes} from './appearance.js';
import {measurePath, roundRailCorners} from './geometry.js';

export const TILE_SIZE = 32;
export const BRIDGE_HEIGHT = 18;
const directions = [{x: 1, y: 0}, {x: 0, y: 1}, {x: -1, y: 0}, {x: 0, y: -1}];
const key = (x, y) => `${x},${y}`;
const worldPoint = p => ({x: (p.x + .5) * TILE_SIZE, y: (p.y + .5) * TILE_SIZE});
const same = (a, b) => a.x === b.x && a.y === b.y;

export function nodeTileSize(node, degree = 0) {
  if (node.kind === 'trash') return 1;
  let size = 3;
  // Leave a free tile between ports so a busy machine cannot seal its own
  // outlets inside a one-cell corridor between two already routed conveyors.
  while (4 * (2 * Math.floor((size - 1) / 4) + 1) < degree) size += 2;
  return size;
}

// Busy machines use binary splitter/merger trees. Each belt gets a real port,
// instead of dozens of routes fencing in a machine's perimeter. A disposer
// always keeps one inlet and one outlet within its single tile.
export function addTransportJunctions(view) {
  const nodes = [...view.nodes], edges = view.edges.map(e => ({...e}));
  for (const node of view.nodes) {
    const degree = edges.filter(e => e.from === node.id || e.to === node.id).length;
    if (node.kind !== 'trash' && degree <= 4) continue;
    for (const inbound of [true, false]) {
      const connected = edges.filter(e => e.kind !== 'train' && (inbound ? e.to === node.id : e.from === node.id));
      if (connected.length < 2) continue;
      let serial = 0;
      const branch = group => {
        const number = serial++, id = `junction:${node.id}:${inbound ? 'in' : 'out'}:${number}`;
        nodes.push({...node, id, kind: 'splitter', label: (inbound ? 'Сбор · ' : 'Делитель · ') + node.label,
          order: node.order + (inbound ? -.1 : .1) + number * .001, isJunction: true, isPortal: false, isPackage: false, isSection: false, isSectionHub: false, helper: false,
          detail: 'Физический узел соединения конвейеров. Каждый вход и выход занимает отдельный порт.', reason: 'Разделение или объединение грузов происходит внутри узла, без пересечения лент на земле.'});
        if (group.length <= 2) { for (const e of group) { if (inbound) e.to = id; else e.from = id; } }
        else for (const part of [group.slice(0, Math.ceil(group.length / 2)), group.slice(Math.ceil(group.length / 2))]) {
          if (part.length === 1) { if (inbound) part[0].to = id; else part[0].from = id; }
          else { const child = branch(part); edges.push({id: `link:${child}`, from: inbound ? child : id, to: inbound ? id : child, kind: 'belt', label: node.label, cargoTypes: mergeCargoTypes(part)}); }
        }
        return id;
      };
      const id = branch(connected);
      edges.push({id: `link:${id}`, from: inbound ? id : node.id, to: inbound ? node.id : id, kind: node.kind === 'trash' ? 'disposal' : 'belt', label: node.label, cargoTypes: mergeCargoTypes(connected)});
    }
  }
  return {nodes, edges};
}

class Heap {
  data = [];
  push(value) {
    let i = this.data.length; this.data.push(value);
    while (i) { const parent = (i - 1) >> 1; if (this.data[parent].score <= value.score) break; this.data[i] = this.data[parent]; i = parent; }
    this.data[i] = value;
  }
  pop() {
    const first = this.data[0], last = this.data.pop();
    if (this.data.length) {
      let i = 0;
      while (i * 2 + 1 < this.data.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.data.length && this.data[child + 1].score < this.data[child].score) child++;
        if (this.data[child].score >= last.score) break;
        this.data[i] = this.data[child]; i = child;
      }
      this.data[i] = last;
    }
    return first;
  }
}

export class TileRouter {
  constructor(nodes) {
    this.nodes = new Map(nodes.map(n => [n.id, n]));
    this.buildings = new Map();
    this.reserved = new Map();
    this.ground = new Map();
    this.bridgeClearance = new Set();
    this.overhead = new Map();
    this.ports = new Map();
    this.routed = [];
    this.bounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
    for (const n of nodes) {
      const size = n.tileSize || nodeTileSize(n), cx = Math.round(n.x / TILE_SIZE - .5), cy = Math.round(n.y / TILE_SIZE - .5), half = (size - 1) / 2;
      n.tileSize = size; n.w = size * TILE_SIZE; n.h = size * TILE_SIZE;
      n.tile = {x: cx, y: cy};
      n.x = (cx + .5) * TILE_SIZE; n.y = (cy + .5) * TILE_SIZE;
      n.footprint = {minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half};
      for (let x = cx - half; x <= cx + half; x++) for (let y = cy - half; y <= cy + half; y++) {
        if (this.buildings.has(key(x, y))) throw new Error('Здания занимают один тайл: увеличьте расстояние между цехами.');
        this.buildings.set(key(x, y), n.id);
      }
      this.bounds.minX = Math.min(this.bounds.minX, cx - half); this.bounds.maxX = Math.max(this.bounds.maxX, cx + half);
      this.bounds.minY = Math.min(this.bounds.minY, cy - half); this.bounds.maxY = Math.max(this.bounds.maxY, cy + half);
    }
  }

  assignPorts(edges) {
    const incident = new Map([...this.nodes.keys()].map(id => [id, []]));
    for (const e of edges) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) throw new Error(`Нет здания для маршрута ${e.id}`);
      incident.get(e.from).push({edge: e, start: true, other: this.nodes.get(e.to)});
      incident.get(e.to).push({edge: e, start: false, other: this.nodes.get(e.from)});
    }
    for (const [id, connections] of incident) {
      const n = this.nodes.get(id), half = (n.tileSize - 1) / 2, candidates = [];
      const used = new Set();
      for (let dir = 0; dir < 4; dir++) for (let offset = -half; offset <= half; offset++) {
        if (offset % 2) continue;
        const d = directions[dir];
        const port = {x: n.tile.x + d.x * (half + 1) + (d.y ? offset : 0), y: n.tile.y + d.y * (half + 1) + (d.x ? offset : 0), dir};
        const lead = {x: port.x + d.x, y: port.y + d.y};
        if (this.buildings.has(key(port.x, port.y)) || this.buildings.has(key(lead.x, lead.y))) continue;
        const approach = [];
        for (let i = 0; i < 5; i++) {
          const p = {x: port.x + d.x * i, y: port.y + d.y * i};
          if (this.buildings.has(key(p.x, p.y))) break;
          approach.push(p);
        }
        candidates.push({...port, lead, offset, approach});
      }
      connections.sort((a, b) => (b.edge.kind === 'train') - (a.edge.kind === 'train') || a.edge.id.localeCompare(b.edge.id));
      for (const connection of connections) {
        const other = connection.other.tile;
        // Both endpoints reserve the SAME route. Opposing approaches may
        // overlap, especially on a short, perfectly straight connection.
        const available = candidates.filter(p => !used.has(p) &&
          this.free(p.x,p.y,connection.edge.id,p.dir) && this.free(p.lead.x,p.lead.y,connection.edge.id,p.dir) &&
          p.approach.every(a => !this.reserved.has(key(a.x, a.y)) || this.reserved.get(key(a.x, a.y)) === connection.edge.id));
        available.sort((a, b) => (Math.abs(a.lead.x - other.x) + Math.abs(a.lead.y - other.y) + Math.abs(a.offset) * .1) - (Math.abs(b.lead.x - other.x) + Math.abs(b.lead.y - other.y) + Math.abs(b.offset) * .1));
        const port = available[0];
        if (!port) throw new Error(`Недостаточно свободных портов у ${n.label}`);
        used.add(port);
        for (const a of port.approach) this.reserved.set(key(a.x, a.y), connection.edge.id);
        if (!this.ports.has(connection.edge.id)) this.ports.set(connection.edge.id, {});
        this.ports.get(connection.edge.id)[connection.start ? 'start' : 'end'] = port;
      }
    }
  }

  free(x, y, edgeID, dir) {
    const k = key(x, y);
    const above = this.overhead.get(k);
    return !this.buildings.has(k) && !this.ground.has(k) && (!above || dir === undefined || above.axis !== (dir % 2 ? 'v' : 'h'))
      && (!this.reserved.has(k) || this.reserved.get(k) === edgeID);
  }

  bridgeFrom(from, dir, edge) {
    if (edge.kind === 'train') return [];
    const d = directions[dir], axis = d.x ? 'h' : 'v', crossed = [], options = [];
    for (let length = 0; length <= 16; length++) {
      const x = from.x + d.x * length, y = from.y + d.y * length, k = key(x, y);
      if (this.buildings.has(k) || (this.reserved.has(k) && this.reserved.get(k) !== edge.id) || this.bridgeClearance.has(k)) break;
      // The whole bridge, its ramps and a tile of visual clearance are exclusive
      // to this bridge. No later bridge can cross or touch this envelope.
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const nearby = key(x + ox, y + oy);
        if (this.bridgeClearance.has(nearby) || this.buildings.has(nearby) || (this.reserved.has(nearby) && this.reserved.get(nearby) !== edge.id)) return options;
      }
      if (!length) continue;
      const occupied = this.ground.get(k);
      if (!occupied) {
        if (!crossed.length) break;
        const envelope = {minX: Math.min(from.x, x) - 1, maxX: Math.max(from.x, x) + 1, minY: Math.min(from.y, y) - 1, maxY: Math.max(from.y, y) + 1};
        let compatible = true;
        for (let prior = from; prior; prior = prior.parent) {
          if (!prior.bridge) continue;
          const b = prior.bridge.envelope;
          if (!(envelope.maxX < b.minX || envelope.minX > b.maxX || envelope.maxY < b.minY || envelope.minY > b.maxY)) { compatible = false; break; }
        }
        if (compatible) options.push({x, y, dir, bridge: {length, crossed: [...crossed], envelope}});
        continue;
      }
      if (occupied.ramp || occupied.axis === axis || occupied.axis === 'turn') break;
      crossed.push(k);
    }
    return options;
  }

  search(edge, margin, {maxExpanded = 100000, weight = 1.15} = {}) {
    const {start, end} = this.ports.get(edge.id), goal = end.lead, initial = start.lead;
    // Check the complete port-to-port line first, including the two-cell
    // case where the leads have already passed each other. A* starts at the
    // leads and cannot discover that short route without doubling back.
    const d = directions[start.dir], distance = (end.x-start.x)*d.x + (end.y-start.y)*d.y;
    if (end.dir === (start.dir+2)%4 && distance >= 1 &&
        end.x === start.x+d.x*distance && end.y === start.y+d.y*distance) {
      const line = Array.from({length: distance+1}, (_, i) => ({x:start.x+d.x*i,y:start.y+d.y*i,dir:start.dir}));
      if (line.every(p => this.free(p.x,p.y,edge.id,start.dir))) return line.slice(1,-1);
    }
    const minX = this.bounds.minX - margin, maxX = this.bounds.maxX + margin, minY = this.bounds.minY - margin, maxY = this.bounds.maxY + margin;
    const heap = new Heap(), costs = new Map();
    const heuristic = (x, y) => weight * (Math.abs(x - goal.x) + Math.abs(y - goal.y));
    const initialState = {...initial, dir: start.dir, cost: 0, score: heuristic(initial.x, initial.y), parent: null};
    heap.push(initialState); costs.set(`${key(initial.x, initial.y)},${start.dir}`, 0);
    let expanded = 0;
    while (heap.data.length && expanded++ < maxExpanded) {
      const state = heap.pop();
      if (state.cost !== costs.get(`${key(state.x, state.y)},${state.dir}`)) continue;
      if (same(state, goal) && state.dir === (end.dir + 2) % 4) {
        const chain = []; for (let s = state; s; s = s.parent) chain.push(s); return chain.reverse();
      }
      for (let dir = 0; dir < 4; dir++) {
        if (dir === (state.dir + 2) % 4) continue;
        if (this.overhead.has(key(state.x, state.y)) && dir !== state.dir) continue;
        const d = directions[dir]; let next = {x: state.x + d.x, y: state.y + d.y, dir};
        if (same(next, initial) || same(next, start)) continue;
        let moves = [next];
        if (!this.free(next.x, next.y, edge.id, dir)) {
          // Ramps must be straight continuations, never a turn on the deck.
          if (dir !== state.dir || !this.free(state.x, state.y, edge.id)) continue;
          moves = this.bridgeFrom(state, dir, edge);
        }
        for (next of moves) {
        if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) continue;
        if (same(next, end) || (same(next, goal) && dir !== (end.dir + 2) % 4)) continue;
        const stateKey = `${key(next.x, next.y)},${dir}`, cost = state.cost + (next.bridge ? next.bridge.length + 5 : 1) + (dir !== state.dir ? .7 : 0);
        if (cost >= (costs.get(stateKey) ?? Infinity)) continue;
        costs.set(stateKey, cost); heap.push({...next, cost, score: cost + heuristic(next.x, next.y), parent: state});
        }
      }
    }
    return null;
  }

  commit(edge, chain, index) {
    const {start, end} = this.ports.get(edge.id);
    const cells = [{x: start.x, y: start.y, layer: 0}], bridges = [];
    for (const state of chain) {
      if (state.bridge) {
        const first = cells.length - 1, a = cells[first], d = directions[state.dir];
        for (let i = 1; i <= state.bridge.length; i++) cells.push({x: a.x + d.x * i, y: a.y + d.y * i, layer: i === state.bridge.length ? 0 : 1});
        bridges.push({first, last: cells.length - 1, crossed: state.bridge.crossed});
      } else cells.push({x: state.x, y: state.y, layer: 0});
    }
    cells.push({x: end.x, y: end.y, layer: 0});
    const visited = new Set();
    for (const cell of cells) {
      const k = key(cell.x, cell.y);
      if (visited.has(k)) throw new Error(`Маршрут ${edge.id} пересекает сам себя`);
      visited.add(k);
    }
    for (const bridge of bridges) {
      const envelope = new Set();
      for (let i = bridge.first; i <= bridge.last; i++) {
        const cell = cells[i];
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) envelope.add(key(cell.x + ox, cell.y + oy));
      }
      if ([...envelope].some(k => this.bridgeClearance.has(k))) throw new Error(`Мосты маршрута ${edge.id} пересекаются`);
      bridge.envelope = [...envelope];
      for (const k of envelope) this.bridgeClearance.add(k);
      const a = cells[bridge.first], b = cells[bridge.last];
      for (let i = bridge.first + 1; i < bridge.last; i++) this.overhead.set(key(cells[i].x, cells[i].y), {axis: a.y === b.y ? 'h' : 'v', edge: edge.id});
      cells[bridge.first].ramp = true; cells[bridge.last].ramp = true;
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]; if (cell.layer) continue;
      const prev = cells[i - 1] || {x: cell.x - directions[start.dir].x, y: cell.y - directions[start.dir].y};
      const next = cells[i + 1] || {x: cell.x - directions[end.dir].x, y: cell.y - directions[end.dir].y};
      const axis = prev.x === next.x ? 'v' : prev.y === next.y ? 'h' : 'turn';
      if (this.ground.has(key(cell.x, cell.y))) throw new Error(`Конвейеры маршрута ${edge.id} пересекаются на земле`);
      this.ground.set(key(cell.x, cell.y), {edge: edge.id, kind: edge.kind, axis, ramp: !!cell.ramp});
    }
    const routed = routeGeometry(edge, cells, bridges, start, end, index);
    this.routed.push(routed); return routed;
  }

  route(edges, priority = []) {
    this.assignPorts(edges);
    const rank = new Map(priority.map((id, i) => [id, i]));
    const sorted = [...edges].sort((a, b) => (b.kind === 'train') - (a.kind === 'train') || (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
    for (let index = 0; index < sorted.length; index++) {
      const edge = sorted[index]; let chain = null;
      for (const margin of [12, 30, 65]) { chain = this.search(edge, margin); if (chain) break; }
      if (!chain) {
        const error = new Error(`Не удалось проложить ${edge.kind === 'train' ? 'рельсы' : 'конвейер'} без пересечений (${edge.label || edge.id}; ${edge.id}).`);
        error.edge = edge; error.ports = this.ports.get(edge.id); error.router = this; throw error;
      }
      try { this.commit(edge, chain, index); }
      catch (error) { error.edge = edge; throw error; }
    }
    return this.routed;
  }
}

// Rebuild geometry after moving grid cells; all animation distances and ramp
// ranges must follow the new track, rather than retaining the old polyline.
export function rebuildRoute(edge, cells) {
  const bridges = [];
  cells = cells.map(p => ({x: p.x, y: p.y, layer: p.layer}));
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].layer) continue;
    const first = i - 1;
    while (i < cells.length && cells[i].layer) i++;
    if (first < 0 || i === cells.length) throw new Error('Мост не соединён с землёй.');
    const last = i, envelope = new Set();
    for (let j = first; j <= last; j++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) envelope.add(key(cells[j].x + dx, cells[j].y + dy));
    cells[first].ramp = cells[last].ramp = true;
    bridges.push({first, last, crossed: [], envelope: [...envelope]});
  }
  const start = {...cells[0], dir: edge.ports.start.dir}, end = {...cells.at(-1), dir: edge.ports.end.dir};
  return routeGeometry(edge, cells, bridges, start, end, edge.index);
}

function routeGeometry(edge, cells, bridges, start, end, index) {
  const first = worldPoint(start), last = worldPoint(end);
  const startFace = {x: first.x - directions[start.dir].x * TILE_SIZE / 2, y: first.y - directions[start.dir].y * TILE_SIZE / 2};
  const endFace = {x: last.x - directions[end.dir].x * TILE_SIZE / 2, y: last.y - directions[end.dir].y * TILE_SIZE / 2};
  const basePoints = [startFace, ...cells.map(worldPoint), endFace];
  let points = [startFace, ...cells.map(cell => { const p = worldPoint(cell); return {...p, y: p.y - (cell.layer ? BRIDGE_HEIGHT : 0)}; }), endFace];
  if (edge.kind === 'train') points = roundRailCorners(points);
  const measured = measurePath(points), groundRuns = [];
  let cursor = 0;
  for (const bridge of bridges) {
    const begin = bridge.first + 1, finish = bridge.last + 1;
    groundRuns.push(points.slice(cursor, begin + 1)); cursor = finish;
    bridge.points = points.slice(begin, finish + 1); bridge.basePoints = basePoints.slice(begin, finish + 1);
    bridge.startDistance = measured.distances[begin]; bridge.endDistance = measured.distances[finish];
  }
  groundRuns.push(points.slice(cursor));
  return {...edge, index, cells, bridges, points, groundRuns, ports: {start, end}, ...measured};

}
