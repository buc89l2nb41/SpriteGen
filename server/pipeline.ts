import sharp from "sharp";

export type Rgba = { data: Buffer; width: number; height: number };

export type PipelineResult = {
  frames: Buffer[];
  sheet: Buffer;
  cellWidth: number;
  cellHeight: number;
  score: number;
  notes: string[];
  sourceWidth?: number;
  sourceHeight?: number;
};

function ycbcr(r: number, g: number, b: number) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return { y, cb, cr };
}

function idx(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

async function decode(input: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function encode(image: Rgba): Promise<Buffer> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
}

function cornerKey(image: Rgba) {
  const { data, width, height } = image;
  const span = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) / 12)));
  const samples: { cb: number; cr: number }[] = [];
  const origins = [
    [0, 0],
    [width - span, 0],
    [0, height - span],
    [width - span, height - span],
  ];
  for (const [ox, oy] of origins) {
    for (let y = oy; y < oy + span; y++) {
      for (let x = ox; x < ox + span; x++) {
        const i = idx(width, x, y);
        samples.push(ycbcr(data[i], data[i + 1], data[i + 2]));
      }
    }
  }
  const mid = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 128;
  };
  return { cb: mid(samples.map((s) => s.cb)), cr: mid(samples.map((s) => s.cr)) };
}

function matte(image: Rgba): { residue: number } {
  const { data, width, height } = image;
  const key = cornerKey(image);
  const soft = 18;
  const hard = 42;
  let residue = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(width, x, y);
      const { cb, cr } = ycbcr(data[i], data[i + 1], data[i + 2]);
      const dist = Math.hypot(cb - key.cb, cr - key.cr);
      let alpha = 255;
      if (dist <= soft) alpha = 0;
      else if (dist < hard) alpha = Math.round((255 * (dist - soft)) / (hard - soft));
      data[i + 3] = Math.min(data[i + 3], alpha);
      if (data[i + 3] > 20 && dist < hard) residue++;
    }
  }

  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * width + x;
    if (seen[p]) return;
    const i = p * 4;
    const { cb, cr } = ycbcr(data[i], data[i + 1], data[i + 2]);
    const dist = Math.hypot(cb - key.cb, cr - key.cr);
    if (data[i + 3] > 40 && dist > hard) return;
    seen[p] = 1;
    queue.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (queue.length) {
    const p = queue.pop() as number;
    const x = p % width;
    const y = Math.floor(p / width);
    data[p * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  return { residue };
}

function projection(image: Rgba) {
  const { data, width, height } = image;
  const raw = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) raw[x] += data[idx(width, x, y) + 3];
  }
  const smooth = raw.slice();
  const radius = 2;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const i = x + k;
      if (i < 0 || i >= width) continue;
      sum += raw[i];
      count++;
    }
    smooth[x] = sum / count;
  }
  return smooth;
}

function chooseCuts(values: number[], segments: number) {
  const width = values.length;
  if (segments <= 1 || width < segments * 2) {
    const bounds = [0];
    for (let s = 1; s <= Math.max(1, segments); s++) bounds.push(Math.round((width * s) / Math.max(1, segments)));
    return bounds;
  }
  const ideal = width / segments;
  const lambda = 0.2;
  const inf = 1e15;
  const dp: number[][] = Array.from({ length: segments + 1 }, () => Array(width + 1).fill(inf));
  const prev: number[][] = Array.from({ length: segments + 1 }, () => Array(width + 1).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= segments; k++) {
    for (let end = k; end <= width; end++) {
      for (let start = k - 1; start < end; start++) {
        if (dp[k - 1][start] >= inf) continue;
        const span = end - start;
        const seam = start === 0 ? 0 : values[Math.min(start, width - 1)];
        const cost = dp[k - 1][start] + seam + lambda * (span - ideal) ** 2;
        if (cost < dp[k][end]) {
          dp[k][end] = cost;
          prev[k][end] = start;
        }
      }
    }
  }
  if (prev[segments][width] < 0) {
    const bounds = [0];
    for (let s = 1; s <= segments; s++) bounds.push(Math.round((width * s) / segments));
    return bounds;
  }
  const bounds = [width];
  let cursor = width;
  for (let k = segments; k >= 1; k--) {
    cursor = prev[k][cursor];
    bounds.push(cursor);
  }
  return bounds.reverse();
}

function crop(image: Rgba, x0: number, x1: number): Rgba {
  const width = Math.max(1, x1 - x0);
  const data = Buffer.alloc(width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    image.data.copy(data, y * width * 4, idx(image.width, x0, y), idx(image.width, x0, y) + width * 4);
  }
  return { data, width, height: image.height };
}

function contentBox(image: Rgba) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let sumA = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const a = image.data[idx(image.width, x, y) + 3];
      if (a < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x * a;
      sumY += y * a;
      sumA += a;
    }
  }
  if (maxX < 0 || sumA === 0) return null;
  return { minX, minY, maxX, maxY, cx: sumX / sumA, cy: sumY / sumA };
}

function alignFrames(frames: Rgba[]) {
  const boxes = frames.map(contentBox);
  let cellW = 8;
  let cellH = 8;
  for (const box of boxes) {
    if (!box) continue;
    cellW = Math.max(cellW, box.maxX - box.minX + 1);
    cellH = Math.max(cellH, box.maxY - box.minY + 1);
  }
  cellW += 4;
  cellH += 4;
  const aligned = frames.map((frame, index) => {
    const box = boxes[index];
    const data = Buffer.alloc(cellW * cellH * 4);
    if (!box) return { data, width: cellW, height: cellH };
    const dx = Math.round(cellW / 2 - box.cx);
    const dy = Math.round(cellH / 2 - box.cy);
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const a = frame.data[idx(frame.width, x, y) + 3];
        if (a < 8) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= cellW || ty >= cellH) continue;
        const from = idx(frame.width, x, y);
        const to = idx(cellW, tx, ty);
        data[to] = frame.data[from];
        data[to + 1] = frame.data[from + 1];
        data[to + 2] = frame.data[from + 2];
        data[to + 3] = a;
      }
    }
    return { data, width: cellW, height: cellH };
  });
  return { aligned, cellW, cellH };
}

function quantize(frames: Rgba[], colors: number) {
  const samples: number[][] = [];
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 16) {
      if (frame.data[i + 3] < 128) continue;
      samples.push([frame.data[i], frame.data[i + 1], frame.data[i + 2]]);
      if (samples.length > 8000) break;
    }
  }
  if (samples.length === 0) return;
  let boxes = [samples];
  while (boxes.length < colors) {
    let best = 0;
    let bestRange = -1;
    let channel = 0;
    boxes.forEach((box, index) => {
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const pixel of box) {
          min = Math.min(min, pixel[c]);
          max = Math.max(max, pixel[c]);
        }
        if (max - min > bestRange) {
          bestRange = max - min;
          best = index;
          channel = c;
        }
      }
    });
    if (bestRange < 2) break;
    const box = boxes.splice(best, 1)[0];
    box.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(box.length / 2) || 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const palette = boxes.map((box) => {
    const acc = [0, 0, 0];
    for (const pixel of box) {
      acc[0] += pixel[0];
      acc[1] += pixel[1];
      acc[2] += pixel[2];
    }
    return acc.map((value) => Math.round(value / box.length));
  });
  const nearest = (r: number, g: number, b: number) => {
    let best = palette[0];
    let bestDist = Infinity;
    for (const color of palette) {
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = color;
      }
    }
    return best;
  };
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i + 3] < 16) {
        frame.data[i + 3] = 0;
        continue;
      }
      const color = nearest(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      frame.data[i] = color[0];
      frame.data[i + 1] = color[1];
      frame.data[i + 2] = color[2];
    }
  }
}

function scoreFrames(frames: Rgba[], expected: number, residue: number) {
  const notes: string[] = [];
  let score = 100;
  const found = frames.length;
  if (found !== expected) {
    score -= 35 + 8 * Math.abs(found - expected);
    notes.push(`프레임 ${found}장. 요청은 ${expected}장입니다.`);
  } else {
    notes.push(`프레임 ${found}장이 요청과 같습니다.`);
  }
  const centroids: number[] = [];
  for (const frame of frames) {
    const box = contentBox(frame);
    if (box) centroids.push(box.cx);
  }
  if (centroids.length > 1) {
    const mean = centroids.reduce((sum, value) => sum + value, 0) / centroids.length;
    const variance = centroids.reduce((sum, value) => sum + (value - mean) ** 2, 0) / centroids.length;
    const deviation = Math.sqrt(variance);
    if (deviation > 6) {
      score -= Math.min(20, deviation);
      notes.push(`앵커 흔들림 ${deviation.toFixed(1)}px`);
    } else {
      notes.push(`앵커 흔들림 ${deviation.toFixed(1)}px`);
    }
  }
  if (residue > 40) {
    score -= Math.min(15, residue / 80);
    notes.push(`배경 잔여 ${residue}px`);
  } else {
    notes.push(`배경 잔여 ${residue}px`);
  }
  return { score: Math.max(0, Math.round(score)), notes };
}

function blackBackdrop(image: Rgba) {
  const { data, width, height } = image;
  const span = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) / 12)));
  const origins = [
    [0, 0],
    [width - span, 0],
    [0, height - span],
    [width - span, height - span],
  ];
  let sum = 0;
  let count = 0;
  for (const [ox, oy] of origins) {
    for (let y = oy; y < oy + span; y++) {
      for (let x = ox; x < ox + span; x++) {
        const offset = idx(width, x, y);
        sum += Math.max(data[offset], data[offset + 1], data[offset + 2]);
        count += 1;
      }
    }
  }
  return sum / Math.max(1, count) < 12;
}

function paletteFrom(image: Rgba, limit: number) {
  const counts = new Map<string, { color: number[]; count: number }>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 128) continue;
    const color = [image.data[i], image.data[i + 1], image.data[i + 2]];
    const key = color.join(",");
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { color, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.color);
}

function remap(frames: Rgba[], palette: number[][]) {
  const nearest = (r: number, g: number, b: number) => {
    let best = palette[0];
    let bestDist = Infinity;
    for (const color of palette) {
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = color;
      }
    }
    return best;
  };
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i + 3] < 16) {
        frame.data[i + 3] = 0;
        continue;
      }
      const color = nearest(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      frame.data[i] = color[0];
      frame.data[i + 1] = color[1];
      frame.data[i + 2] = color[2];
      frame.data[i + 3] = frame.data[i + 3] < 128 ? 0 : 255;
    }
  }
}

function cutAsShown(frames: Rgba[]) {
  const boxes = frames.map(contentBox);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (const box of boxes) {
    if (!box) continue;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  const grounds = boxes.map((box) => box?.maxY ?? null);
  const known = grounds.filter((value): value is number => value !== null);
  const spread = known.length ? Math.max(...known) - Math.min(...known) : 0;
  const sourceW = Math.max(...frames.map((frame) => frame.width));
  const sourceH = Math.max(...frames.map((frame) => frame.height));
  if (maxX < 0) return { aligned: frames, cellW: sourceW, cellH: sourceH, spread };
  const pad = 8;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(sourceW, maxX + 1 + pad);
  const y1 = Math.min(sourceH, maxY + 1 + pad);
  const cellW = Math.max(1, x1 - x0);
  const cellH = Math.max(1, y1 - y0);
  const aligned = frames.map((frame) => {
    const data = Buffer.alloc(cellW * cellH * 4);
    for (let y = 0; y < cellH; y++) {
      const sy = y0 + y;
      if (sy >= frame.height) continue;
      for (let x = 0; x < cellW; x++) {
        const sx = x0 + x;
        if (sx >= frame.width) continue;
        const from = idx(frame.width, sx, sy);
        const to = idx(cellW, x, y);
        data[to] = frame.data[from];
        data[to + 1] = frame.data[from + 1];
        data[to + 2] = frame.data[from + 2];
        data[to + 3] = frame.data[from + 3];
      }
    }
    return { data, width: cellW, height: cellH };
  });
  return { aligned, cellW, cellH, spread };
}

function holdBackdrop(frames: Rgba[]) {
  const masks = frames.map((frame) => {
    const key = cornerKey(frame);
    const black = blackBackdrop(frame);
    const mask = new Uint8Array(frame.width * frame.height);
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const offset = pixel * 4;
      const dark = frame.data[offset] <= 18 && frame.data[offset + 1] <= 18 && frame.data[offset + 2] <= 18;
      const { cb, cr } = ycbcr(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]);
      const backdrop = black ? dark : Math.hypot(cb - key.cb, cr - key.cr) <= 18;
      if (!backdrop) continue;
      mask[pixel] = 1;
      frame.data[offset + 3] = 0;
    }
    return mask;
  });
  return () => {
    frames.forEach((frame, index) => {
      const mask = masks[index];
      for (let pixel = 0; pixel < mask.length; pixel++) {
        if (mask[pixel]) frame.data[pixel * 4 + 3] = 255;
      }
    });
  };
}

export async function finishFrames(inputs: Buffer[], paletteSource?: Buffer): Promise<PipelineResult> {
  const decoded = await Promise.all(inputs.map(decode));
  const { aligned, cellW, cellH, spread } = cutAsShown(decoded);
  const restoreBackdrop = holdBackdrop(aligned);
  const character = paletteSource ? paletteFrom(await decode(paletteSource), 16) : [];
  if (character.length) remap(aligned, character);
  else quantize(aligned, 16);
  restoreBackdrop();
  const frames = await Promise.all(aligned.map(encode));
  const sheet = await sharp({
    create: { width: cellW * aligned.length, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((frame, index) => ({ input: frame, left: index * cellW, top: 0 })))
    .png()
    .toBuffer();
  const notes = [
    `칸 ${aligned.length}장`,
    `영상 위치 그대로 ${cellW}×${cellH}`,
    `영상 안 발 높이 차이 ${spread}px`,
    "배경은 그대로 둡니다",
    character.length ? `기준 캐릭터 색 ${character.length}개로 잠금` : "영상 색 16개로 잠금",
  ];
  return {
    frames,
    sheet,
    cellWidth: cellW,
    cellHeight: cellH,
    score: spread <= 120 ? 100 : Math.max(0, 100 - Math.round((spread - 120) / 8)),
    notes,
  };
}

export async function processStrip(input: Buffer, expectedFrames: number): Promise<PipelineResult> {
  const image = await decode(input);
  const { residue } = matte(image);
  const bounds = chooseCuts(projection(image), expectedFrames);
  const slices = [];
  for (let i = 0; i < bounds.length - 1; i++) slices.push(crop(image, bounds[i], bounds[i + 1]));
  const { aligned, cellW, cellH } = alignFrames(slices);
  quantize(aligned, 16);
  const frames = await Promise.all(aligned.map(encode));
  const sheet = await sharp({
    create: { width: cellW * aligned.length, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((frame, index) => ({ input: frame, left: index * cellW, top: 0 })))
    .png()
    .toBuffer();
  const { score, notes } = scoreFrames(aligned, expectedFrames, residue);
  return { frames, sheet, cellWidth: cellW, cellHeight: cellH, score, notes };
}

export async function makeSampleStrip(): Promise<Buffer> {
  const cell = 64;
  const frames = 6;
  const width = cell * frames;
  const data = Buffer.alloc(width * cell * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= cell) return;
    const i = idx(width, x, y);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  const fill = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) put(xx, yy, color[0], color[1], color[2]);
    }
  };
  for (let frame = 0; frame < frames; frame++) {
    const ox = frame * cell + 24;
    const step = frame % 2 === 0 ? 0 : 2;
    fill(ox, 10, 16, 10, [232, 196, 140]);
    fill(ox - 2, 20, 20, 18, [26, 79, 214]);
    fill(ox + 2, 38, 6, 12 + step, [20, 24, 40]);
    fill(ox + 10, 38, 6, 14 - step, [20, 24, 40]);
    fill(ox + 16, 22, 8, 4, [192, 192, 192]);
  }
  return sharp(data, { raw: { width, height: cell, channels: 4 } }).png().toBuffer();
}
