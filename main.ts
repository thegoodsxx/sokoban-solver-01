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
