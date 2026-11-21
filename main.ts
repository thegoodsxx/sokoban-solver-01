import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = [[0, -1, 'u'], [0, 1, 'd'], [-1, 0, 'l'], [1, 0, 'r']];

export function parseLevel(text) {
  const rows = text.split(/\r?\n/).filter((r) => r.length);
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1), goals = [], boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x], p = y * w + x;
      if (ch === '#') continue;
      wall[p] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(p);
      if (ch === '$' || ch === '*') boxes.push(p);
      if (ch === '@' || ch === '+') player = p;
    }
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!x || !y || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  return { w, h, wall, goals: goals.sort((a, b) => a - b), boxes: boxes.sort((a, b) => a - b), player };
}

// Used by the test driver as well as to reject a solver regression before writing output.
export function replay(level, moves) {
  const boxes = new Uint8Array(level.wall.length); for (const b of level.boxes) boxes[b] = 1;
  let player = level.player, pushes = 0;
  for (const raw of moves) {
    const ch = raw.toLowerCase(); if (!'udlr'.includes(ch)) continue;
    const d = ch === 'u' ? -level.w : ch === 'd' ? level.w : ch === 'l' ? -1 : 1, q = player + d;
    if (level.wall[q]) return { legal: false, solved: false, pushes };
    if (boxes[q]) { if (level.wall[q + d] || boxes[q + d]) return { legal: false, solved: false, pushes }; boxes[q] = 0; boxes[q + d] = 1; pushes++; }
    player = q;
  }
  return { legal: true, solved: level.goals.every((g) => boxes[g]), pushes, player };
}

function liveSquares(level) {
  const live = new Uint8Array(level.wall.length), queue = level.goals.slice();
  for (const g of queue) live[g] = 1;
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of DIRS) {
    const d = dy * level.w + dx, from = queue[i] - d;
    if (!level.wall[from] && !level.wall[from - d] && !live[from]) { live[from] = 1; queue.push(from); }
  }
  return live;
}

function flood(level, occupied, from, seen, stamp) {
  const stack = [from]; seen[from] = stamp; let low = from;
  for (let i = 0; i < stack.length; i++) {
    const p = stack[i]; if (p < low) low = p;
    for (const [dx, dy] of DIRS) { const q = p + dy * level.w + dx; if (!level.wall[q] && !occupied[q] && seen[q] !== stamp) { seen[q] = stamp; stack.push(q); } }
  }
  return low;
}

function walk(level, occupied, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(level.wall.length).fill(-1), how = new Array(level.wall.length), q = [from]; prev[from] = from;
  for (let i = 0; i < q.length && prev[to] < 0; i++) for (const [dx, dy, letter] of DIRS) {
    const n = q[i] + dy * level.w + dx;
    if (!level.wall[n] && !occupied[n] && prev[n] < 0) { prev[n] = q[i]; how[n] = letter; q.push(n); }
  }
  if (prev[to] < 0) throw new Error('unreachable push');
  let out = ''; for (let p = to; p !== from; p = prev[p]) out = how[p] + out;
  return out;
}

function frozen(level, occ, goal, t) {
  for (const a of [t, t - 1, t - level.w, t - level.w - 1]) {
    const four = [a, a + 1, a + level.w, a + level.w + 1];
    if (four.every((p) => level.wall[p] || occ[p]) && four.some((p) => occ[p] && !goal[p])) return true;
  }
  return false;
}

function heapPush(heap, entry) {
  let i = heap.length; heap.push(entry);
  while (i) { const p = (i - 1) >> 1; if (heap[p][0] < entry[0] || heap[p][0] === entry[0] && heap[p][1] <= entry[1]) break; heap[i] = heap[p]; i = p; }
  heap[i] = entry;
}
function heapPop(heap) {
  const out = heap[0], last = heap.pop(); if (!heap.length) return out;
  let i = 0;
  while (2 * i + 1 < heap.length) { let c = 2 * i + 1; if (c + 1 < heap.length && (heap[c + 1][0] < heap[c][0] || heap[c + 1][0] === heap[c][0] && heap[c + 1][1] < heap[c][1])) c++; if (last[0] < heap[c][0] || last[0] === heap[c][0] && last[1] <= heap[c][1]) break; heap[i] = heap[c]; i = c; }
  heap[i] = last; return out;
}

function matching(boxes, distances) {
  const memo = new Map();
  const go = (i, mask) => {
    if (i === boxes.length) return 0; const key = i + ',' + mask, old = memo.get(key); if (old !== undefined) return old;
    let best = 1e9; for (let g = 0; g < boxes.length; g++) if (!(mask & (1 << g))) best = Math.min(best, distances[g][boxes[i]] + go(i + 1, mask | (1 << g)));
    memo.set(key, best); return best;
  };
  return go(0, 0);
}

// A* on pushes. The player region's lowest square makes equivalent walking states identical.
export function solveRoom(level, limit = 700000) {
  const size = level.wall.length, goal = new Uint8Array(size), live = liveSquares(level); for (const g of level.goals) goal[g] = 1;
  if (level.boxes.some((b) => !live[b])) return null;
  const distances = level.goals.map((g) => { const d = new Int32Array(size).fill(999999), q = [g]; d[g] = 0; for (let i = 0; i < q.length; i++) for (const [dx, dy] of DIRS) { const step = dy * level.w + dx, n = q[i] - step; if (!level.wall[n] && !level.wall[n - step] && d[n] === 999999) { d[n] = d[q[i]] + 1; q.push(n); } } return d; });
  const key = (b, low) => low + '/' + b.join(',');
  const bs = [level.boxes], ps = [level.player], parent = [-1], froms = [-1], steps = [''];
  const best = new Map(), seen = new Int32Array(size), mark = new Int32Array(size); let stamp = 0, serial = 0;
  const occ = new Uint8Array(size); for (const b of level.boxes) occ[b] = 1; const initialLow = flood(level, occ, level.player, seen, ++stamp); for (const b of level.boxes) occ[b] = 0;
  best.set(key(level.boxes, initialLow), 0); const heap = []; heapPush(heap, [matching(level.boxes, distances), serial++, 0, 0]);
  let expanded = 0, found = -1;
  while (heap.length && expanded < limit) {
    const [, , g, s] = heapPop(heap), boxes = bs[s];
    for (const b of boxes) occ[b] = 1; const low = flood(level, occ, ps[s], seen, ++stamp), here = stamp;
    if (best.get(key(boxes, low)) !== g) { for (const b of boxes) occ[b] = 0; continue; }
    if (boxes.every((b) => goal[b])) { found = s; for (const b of boxes) occ[b] = 0; break; }
    expanded++;
    for (let bi = 0; bi < boxes.length; bi++) for (const [dx, dy, letter] of DIRS) {
      const b = boxes[bi], d = dy * level.w + dx, t = b + d;
      if (seen[b - d] !== here || level.wall[t] || occ[t] || !live[t]) continue;
      occ[b] = 0; occ[t] = 1;
      if (!frozen(level, occ, goal, t)) {
        const next = boxes.slice(); next[bi] = t; next.sort((a, b) => a - b); const nextLow = flood(level, occ, b, mark, ++stamp), k = key(next, nextLow), ng = g + 1;
        if (best.get(k) === undefined || ng < best.get(k)) { const n = bs.length; best.set(k, ng); bs.push(next); ps.push(b); parent.push(s); froms.push(b); steps.push(letter); heapPush(heap, [ng + matching(next, distances), serial++, ng, n]); }
      }
      occ[t] = 0; occ[b] = 1;
    }
    for (const b of boxes) occ[b] = 0;
  }
  if (found < 0) return null;
  const path = []; for (let s = found; s > 0; s = parent[s]) path.push(s); path.reverse();
  let player = level.player, boxes = level.boxes, moves = '';
  for (const s of path) { const from = froms[s], letter = steps[s], d = letter === 'u' ? -level.w : letter === 'd' ? level.w : letter === 'l' ? -1 : 1; for (const b of boxes) occ[b] = 1; moves += walk(level, occ, player, from - d) + letter; for (const b of boxes) occ[b] = 0; player = from; boxes = bs[s]; }
  return moves;
}

function roomsOf(level) {
  const live = liveSquares(level), row = Math.floor(level.player / level.w), cut = new Uint8Array(level.wall.length);
  for (let p = row * level.w; p < (row + 1) * level.w; p++) if (!level.wall[p] && !live[p]) cut[p] = 1;
  if (level.boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(level.wall.length).fill(-1), rooms = [];
  for (let start = 0; start < level.wall.length; start++) {
    if (level.wall[start] || cut[start] || part[start] >= 0) continue;
    const squares = [start], room = { squares, boxes: [], goals: [], done: false }; part[start] = rooms.length;
    for (let i = 0; i < squares.length; i++) for (const [dx, dy] of DIRS) { const q = squares[i] + dy * level.w + dx; if (!level.wall[q] && !cut[q] && part[q] < 0) { part[q] = rooms.length; squares.push(q); } }
    rooms.push(room);
  }
  for (const b of level.boxes) rooms[part[b]]?.boxes.push(b);
  for (const g of level.goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (level.goals.some((g) => part[g] < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length);
}

function solveLevel(level) {
  const rooms = roomsOf(level); if (!rooms) return solveRoom(level);
  let player = level.player, moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) if (other !== room) for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    const sub = { w: level.w, h: level.h, wall, goals: room.goals.slice().sort((a, b) => a - b), boxes: room.boxes.slice().sort((a, b) => a - b), player };
    const part = solveRoom(sub); if (part === null) return null;
    const result = replay(sub, part); if (!result.legal || !result.solved) return null;
    moves += part; player = result.player; room.done = true;
  }
  return moves;
}

function main() {
  const input = process.env.MAKEFUN_INPUT_DIR ?? '/input', output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (const id of readdirSync(input).sort()) {
    const level = parseLevel(readFileSync(join(input, id, 'level.txt'), 'utf8'));
    const moves = solveLevel(level) ?? '';
    const checked = replay(level, moves);
    mkdirSync(join(output, id), { recursive: true });
    writeFileSync(join(output, id, 'solution.txt'), checked.legal && checked.solved ? moves + '\n' : '\n');
  }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) main();
