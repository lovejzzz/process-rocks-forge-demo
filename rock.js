/* ── Rock pixel-art engine ── */

const MATERIAL = {
  EMPTY:    0,
  STONE:    1,
  GOLD:     2,
  RUBY:     3,
  INTERIOR: 4,
  EMERALD:  5,
};

const PALETTE = {
  [MATERIAL.STONE]:    ['#5a5a5a','#6b6b6b','#7a7a7a'],
  [MATERIAL.GOLD]:     ['#b8860b','#daa520','#ffd700'],
  [MATERIAL.RUBY]:     ['#8b0000','#dc143c','#ff4060'],
  [MATERIAL.INTERIOR]: ['#8a8a8a','#9a9a9a','#aaaaaa'],
  [MATERIAL.EMERALD]:  ['#0d7348','#1aa86a','#2fdc8a'],
};

// Outline colour for each material
const OUTLINE = {
  [MATERIAL.STONE]:    '#3a3a3a',
  [MATERIAL.GOLD]:     '#806000',
  [MATERIAL.RUBY]:     '#600000',
  [MATERIAL.INTERIOR]: '#606060',
  [MATERIAL.EMERALD]:  '#08402a',
};

/* ── Rock shape template (20×20) ── */
const ROCK_SHAPE = [
  '........xxxx........',
  '......xxxxxxxx......',
  '.....xxxxxxxxxx.....',
  '....xxxxxxxxxxxx....',
  '...xxxxxxxxxxxxxx...',
  '..xxxxxxxxxxxxxxxx..',
  '..xxxxxxxxxxxxxxxx..',
  '.xxxxxxxxxxxxxxxxxx.',
  '.xxxxxxxxxxxxxxxxxx.',
  '.xxxxxxxxxxxxxxxxxx.',
  '.xxxxxxxxxxxxxxxxxx.',
  '.xxxxxxxxxxxxxxxxxx.',
  '..xxxxxxxxxxxxxxxx..',
  '..xxxxxxxxxxxxxxxx..',
  '...xxxxxxxxxxxxxx...',
  '....xxxxxxxxxxxx....',
  '.....xxxxxxxxxx.....',
  '......xxxxxxxx......',
  '........xxxx........',
  '....................',
];

/* ── Seeded RNG (mulberry32) ── */
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ── Rock class ── */
class Rock {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    // grid[y][x] = { mat, shade } or null
    this.grid = Array.from({length: h}, () => Array(w).fill(null));
    this.history = [];
  }

  static createBase() {
    const r = new Rock(20, 20);
    const rng = mulberry32(42);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        if (ROCK_SHAPE[y][x] === 'x') {
          r.grid[y][x] = { mat: MATERIAL.STONE, shade: Math.floor(rng() * 3) };
        }
      }
    }
    return r;
  }

  clone() {
    const r = new Rock(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const p = this.grid[y][x];
        r.grid[y][x] = p ? { ...p } : null;
      }
    r.history = [...this.history];
    return r;
  }

  get(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return null;
    return this.grid[y][x];
  }

  isSurface(x, y) {
    if (!this.get(x, y)) return false;
    return !this.get(x-1,y) || !this.get(x+1,y) ||
           !this.get(x,y-1) || !this.get(x,y+1);
  }

  /* ── Transforms ── */

  flip() {
    const r = this.clone();
    for (let y = 0; y < r.h; y++) r.grid[y].reverse();
    r.history.push('Flip');
    return r;
  }

  goldPlated() {
    // Expand grid by 2 in each direction to make room for the gold border
    const nw = this.w + 2;
    const nh = this.h + 2;
    const r = new Rock(nw, nh);
    // Copy original pixels offset by (1,1)
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const p = this.grid[y][x];
        r.grid[y + 1][x + 1] = p ? { ...p } : null;
      }
    // Add gold pixels around every existing pixel's empty neighbors
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    const toFill = [];
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        if (r.grid[y][x]) continue; // already has material
        let adjacent = false;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < nw && ny >= 0 && ny < nh && r.grid[ny][nx]) {
            adjacent = true; break;
          }
        }
        if (adjacent) toFill.push({ x, y });
      }
    const rng = mulberry32(this.history.length * 11 + 7);
    for (const p of toFill) {
      r.grid[p.y][p.x] = { mat: MATERIAL.GOLD, shade: Math.floor(rng() * 3) };
    }
    r.history = [...this.history, 'Gold Plated'];
    return r;
  }

  mosaicRuby() {
    const r = this.clone();
    const seed = r.history.length * 7 + 13;
    const rng = mulberry32(seed);
    // Pick center points, then grow small clusters around them
    const centers = [];
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++)
        if (r.isSurface(x, y) && rng() < 0.12)
          centers.push({ x, y });
    for (const c of centers) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = c.x + dx, ny = c.y + dy;
          if (nx >= 0 && nx < r.w && ny >= 0 && ny < r.h &&
              r.grid[ny][nx] && r.isSurface(nx, ny) && rng() < 0.65)
            r.grid[ny][nx] = { mat: MATERIAL.RUBY, shade: Math.floor(rng() * 3) };
        }
    }
    r.history.push('Mosaic Ruby');
    return r;
  }

  splitHalf() {
    if (this.w < 2) return null;
    const halfW = Math.ceil(this.w / 2);
    const rightW = this.w - halfW;

    // Left half
    const left = new Rock(halfW, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < halfW; x++) {
        const p = this.get(x, y);
        left.grid[y][x] = p ? { ...p } : null;
      }
      const seam = left.grid[y][halfW - 1];
      if (seam && this.get(halfW, y) && seam.mat !== MATERIAL.EMERALD)
        left.grid[y][halfW - 1] = { mat: MATERIAL.INTERIOR, shade: 1 };
    }
    left.history = [...this.history, 'Split Half'];

    // Right half
    const right = new Rock(rightW, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < rightW; x++) {
        const p = this.get(x + halfW, y);
        right.grid[y][x] = p ? { ...p } : null;
      }
      const seam = right.grid[y][0];
      if (seam && this.get(halfW - 1, y) && seam.mat !== MATERIAL.EMERALD)
        right.grid[y][0] = { mat: MATERIAL.INTERIOR, shade: 1 };
    }
    right.history = [...this.history, 'Split Half'];

    return [left, right];
  }

  apply(processId) {
    switch (processId) {
      case 'flip':        return this.flip();
      case 'mosaic_ruby': return this.mosaicRuby();
      case 'gold_plated': return this.goldPlated();
      case 'split_half':  return this.splitHalf();
    }
    return this.clone();
  }

  /* Merge a contiguous left-to-right run of rocks into one. Where the pieces
     meet, Split Half's INTERIOR seam cells become emerald. If a pair of
     facing edges already contains emerald (the run has been filled before),
     additional emerald columns are inserted between the pieces so the band
     grows thicker with each subsequent Emerald Filler pass. */
  static emeraldMerge(rocks) {
    const EXTRA_PER_REFILL = 2;

    // 1. Figure out how many emerald columns to insert at each boundary.
    const extras = [];
    for (let i = 0; i < rocks.length - 1; i++) {
      const A = rocks[i], B = rocks[i + 1];
      let aHasEmerald = false, bHasEmerald = false;
      for (let y = 0; y < A.h && !aHasEmerald; y++) {
        const c = A.grid[y][A.w - 1];
        if (c && c.mat === MATERIAL.EMERALD) aHasEmerald = true;
      }
      for (let y = 0; y < B.h && !bHasEmerald; y++) {
        const c = B.grid[y][0];
        if (c && c.mat === MATERIAL.EMERALD) bHasEmerald = true;
      }
      extras.push((aHasEmerald || bHasEmerald) ? EXTRA_PER_REFILL : 0);
    }

    // 2. Compute merged canvas size.
    let totalW = 0;
    let maxH = 0;
    for (const rk of rocks) {
      totalW += rk.w;
      if (rk.h > maxH) maxH = rk.h;
    }
    for (const e of extras) totalW += e;

    const merged = new Rock(totalW, maxH);
    const rng = mulberry32(rocks.length * 31 + totalW);

    // 3. Stamp each rock side-by-side (INTERIOR → emerald), then, at each
    //    boundary needing extras, insert emerald columns spanning the union
    //    of rows where the two facing edges have material.
    let xOffset = 0;
    for (let i = 0; i < rocks.length; i++) {
      const rk = rocks[i];
      const yOffset = Math.floor((maxH - rk.h) / 2);
      for (let y = 0; y < rk.h; y++)
        for (let x = 0; x < rk.w; x++) {
          const p = rk.grid[y][x];
          if (!p) continue;
          merged.grid[y + yOffset][x + xOffset] =
            p.mat === MATERIAL.INTERIOR
              ? { mat: MATERIAL.EMERALD, shade: Math.floor(rng() * 3) }
              : { ...p };
        }
      xOffset += rk.w;

      if (i < rocks.length - 1 && extras[i] > 0) {
        const A = rocks[i], B = rocks[i + 1];
        const yOffA = Math.floor((maxH - A.h) / 2);
        const yOffB = Math.floor((maxH - B.h) / 2);
        const rows = new Set();
        for (let y = 0; y < A.h; y++) if (A.grid[y][A.w - 1]) rows.add(yOffA + y);
        for (let y = 0; y < B.h; y++) if (B.grid[y][0])       rows.add(yOffB + y);
        for (let k = 0; k < extras[i]; k++) {
          for (const y of rows) {
            merged.grid[y][xOffset + k] = { mat: MATERIAL.EMERALD, shade: Math.floor(rng() * 3) };
          }
        }
        xOffset += extras[i];
      }
    }

    merged.history = [...rocks[0].history, 'Emerald Filler'];
    return merged;
  }

  /* ── Rendering ── */

  renderAt(ctx, ox, oy, scale) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const p = this.grid[y][x];
        if (!p) continue;
        ctx.fillStyle = PALETTE[p.mat][p.shade];
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const p = this.grid[y][x];
        if (!p || !this.isSurface(x, y)) continue;
        ctx.fillStyle = OUTLINE[p.mat];
        const px = ox + x * scale;
        const py = oy + y * scale;
        if (!this.get(x-1,y)) ctx.fillRect(px, py, 1, scale);
        if (!this.get(x+1,y)) ctx.fillRect(px+scale-1, py, 1, scale);
        if (!this.get(x,y-1)) ctx.fillRect(px, py, scale, 1);
        if (!this.get(x,y+1)) ctx.fillRect(px, py+scale-1, scale, 1);
      }
  }

  render(canvas, scale) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!scale) scale = Math.floor(Math.min(canvas.width / this.w, canvas.height / this.h));
    const ox = Math.floor((canvas.width - this.w * scale) / 2);
    const oy = Math.floor((canvas.height - this.h * scale) / 2);
    this.renderAt(ctx, ox, oy, scale);
  }
}

/* ── Rock Collection (multi-piece support) ── */

class RockCollection {
  constructor(pieces, history) {
    this.pieces = pieces || [];   // [{ rock: Rock, selected: bool }]
    this.history = history || [];
    this._bounds = [];
  }

  static fromRock(rock) {
    return new RockCollection(
      [{ rock: rock.clone(), selected: true }],
      [...rock.history]
    );
  }

  clone() {
    return new RockCollection(
      this.pieces.map(p => ({ rock: p.rock.clone(), selected: p.selected })),
      [...this.history]
    );
  }

  hasSelection() {
    return this.pieces.some(p => p.selected);
  }

  hasAdjacentSelected() {
    for (let i = 0; i < this.pieces.length - 1; i++) {
      if (this.pieces[i].selected && this.pieces[i + 1].selected) return true;
    }
    return false;
  }

  selectAll() {
    this.pieces.forEach(p => p.selected = true);
  }

  deselectAll() {
    this.pieces.forEach(p => p.selected = false);
  }

  toggleSelect(index) {
    if (index >= 0 && index < this.pieces.length)
      this.pieces[index].selected = !this.pieces[index].selected;
  }

  apply(processId, processName) {
    if (!this.hasSelection()) return this.clone();

    if (processId === 'emerald_filler') {
      // Merge each contiguous run of selected pieces (length >= 2) into one.
      // Isolated selected pieces are left untouched.
      const newPieces = [];
      let i = 0;
      while (i < this.pieces.length) {
        const piece = this.pieces[i];
        if (!piece.selected) {
          newPieces.push({ rock: piece.rock.clone(), selected: false });
          i++;
          continue;
        }
        let j = i;
        while (j < this.pieces.length && this.pieces[j].selected) j++;
        const runLen = j - i;
        if (runLen >= 2) {
          const rocks = [];
          for (let k = i; k < j; k++) rocks.push(this.pieces[k].rock);
          newPieces.push({ rock: Rock.emeraldMerge(rocks), selected: false });
        } else {
          newPieces.push({ rock: piece.rock.clone(), selected: false });
        }
        i = j;
      }
      return new RockCollection(newPieces, [...this.history, processName]);
    }

    const newPieces = [];
    for (const piece of this.pieces) {
      if (!piece.selected) {
        newPieces.push({ rock: piece.rock.clone(), selected: false });
        continue;
      }
      if (processId === 'split_half') {
        const halves = piece.rock.splitHalf();
        if (halves) {
          newPieces.push({ rock: halves[0], selected: false });
          newPieces.push({ rock: halves[1], selected: false });
        } else {
          newPieces.push({ rock: piece.rock.clone(), selected: false });
        }
      } else {
        const method = processId === 'flip' ? 'flip'
          : processId === 'mosaic_ruby' ? 'mosaicRuby'
          : processId === 'gold_plated' ? 'goldPlated'
          : null;
        const transformed = method ? piece.rock[method]() : piece.rock.clone();
        newPieces.push({ rock: transformed, selected: false });
      }
    }
    return new RockCollection(newPieces, [...this.history, processName]);
  }

  render(canvas, showSelection) {
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (this.pieces.length === 0) return;

    const GAP = 2;
    let totalW = 0;
    let maxH = 0;
    for (const p of this.pieces) {
      totalW += p.rock.w;
      maxH = Math.max(maxH, p.rock.h);
    }
    totalW += GAP * (this.pieces.length - 1);

    let scale = Math.min(
      Math.floor(cw / totalW) || 1,
      Math.floor(ch / maxH) || 1,
      8
    );
    scale = Math.max(scale, 1);
    this._scale = scale;

    const totalPx = totalW * scale;
    let sx = Math.floor((cw - totalPx) / 2);
    const sy = Math.floor((ch - maxH * scale) / 2);
    this._bounds = [];

    for (let i = 0; i < this.pieces.length; i++) {
      const { rock, selected } = this.pieces[i];
      const ox = sx;
      const oy = sy + Math.floor((maxH - rock.h) * scale / 2);
      this._bounds.push({ x: ox, y: oy, w: rock.w * scale, h: rock.h * scale });

      rock.renderAt(ctx, ox, oy, scale);

      if (showSelection && selected) {
        ctx.save();
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(ox - 3, oy - 3, rock.w * scale + 6, rock.h * scale + 6);
        ctx.restore();
      }

      sx += (rock.w + GAP) * scale;
    }
  }

  hitTest(cx, cy) {
    for (let i = this._bounds.length - 1; i >= 0; i--) {
      const b = this._bounds[i];
      if (cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)
        return i;
    }
    return -1;
  }
}
