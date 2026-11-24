import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

type Rgba = { data: Buffer; width: number; height: number };

const rembgScript = fileURLToPath(new URL("./rembgMask.py", import.meta.url));

async function decode(input: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function encode(image: Rgba) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function borderColor(image: Rgba): [number, number, number] | null {
  const { data, width, height } = image;
  const band = Math.max(2, Math.floor(Math.min(width, height) / 64));
  const samples: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 16) return;
    samples[0].push(data[offset]);
    samples[1].push(data[offset + 1]);
    samples[2].push(data[offset + 2]);
  };
  for (let y = 0; y < band; y++) for (let x = 0; x < width; x++) take(x, y);
  for (let y = Math.max(0, height - band); y < height; y++) for (let x = 0; x < width; x++) take(x, y);
  for (let y = 0; y < height; y++) for (let x = 0; x < band; x++) take(x, y);
  for (let y = 0; y < height; y++) for (let x = Math.max(0, width - band); x < width; x++) take(x, y);
  if (samples[0].length < 8) return null;
  return [median(samples[0]), median(samples[1]), median(samples[2])];
}

function isMagenta(key: [number, number, number]) {
  return key[0] > 150 && key[2] > 150 && key[1] < 110;
}

function plate(image: Rgba): Rgba {
  const key = borderColor(image) ?? [255, 0, 255];
  const data = Buffer.from(image.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] >= 16) continue;
    data[offset] = key[0];
    data[offset + 1] = key[1];
    data[offset + 2] = key[2];
    data[offset + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}

function unmix(r: number, g: number, b: number, alpha: number, key: [number, number, number]) {
  if (alpha < 0.02) return [0, 0, 0];
  const scale = Math.max(alpha, 1e-3);
  return [r, g, b].map((channel, index) => Math.max(0, Math.min(255, (channel - (1 - scale) * key[index]) / scale)));
}

function despill(r: number, g: number, b: number) {
  const spill = Math.max(0, Math.min(r, b) - g);
  return [r - spill, g, b - spill];
}

function erode(alpha: Float32Array, width: number, height: number) {
  const px = Math.max(1, Math.floor(Math.min(width, height) / 512));
  const radius = px;
  const mined = new Float32Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 1;
      for (let ky = -radius; ky <= radius; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= height) continue;
        for (let kx = -radius; kx <= radius; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= width) continue;
          min = Math.min(min, alpha[yy * width + xx]);
        }
      }
      mined[y * width + x] = min;
    }
  }
  const sigma = px * 0.6;
  const blurRadius = Math.max(1, Math.ceil(sigma * 2));
  const kernel: number[] = [];
  let weight = 0;
  for (let offset = -blurRadius; offset <= blurRadius; offset++) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(value);
    weight += value;
  }
  for (let index = 0; index < kernel.length; index++) kernel[index] /= weight;
  const horizontal = new Float32Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -blurRadius; offset <= blurRadius; offset++) {
        const xx = Math.min(width - 1, Math.max(0, x + offset));
        sum += mined[y * width + xx] * kernel[offset + blurRadius];
      }
      horizontal[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -blurRadius; offset <= blurRadius; offset++) {
        const yy = Math.min(height - 1, Math.max(0, y + offset));
        sum += horizontal[yy * width + x] * kernel[offset + blurRadius];
      }
      alpha[y * width + x] = Math.min(alpha[y * width + x], sum);
    }
  }
}

function paint(source: Rgba, alpha: Float32Array, key: [number, number, number], magenta: boolean) {
  const out = Buffer.alloc(source.data.length);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const offset = pixel * 4;
    const cover = Math.max(0, Math.min(1, alpha[pixel]));
    let [r, g, b] = unmix(source.data[offset], source.data[offset + 1], source.data[offset + 2], cover, key);
    if (magenta) [r, g, b] = despill(r, g, b);
    out[offset] = Math.round(r);
    out[offset + 1] = Math.round(g);
    out[offset + 2] = Math.round(b);
    out[offset + 3] = Math.round(cover * 255);
  }
  return { data: out, width: source.width, height: source.height };
}

export function keyAlpha(image: Rgba): { image: Rgba; how: string } {
  const source = plate(image);
  const key = borderColor(source);
  if (!key) return { image, how: "테두리 색 없음" };
  const count = source.width * source.height;
  const alpha = new Float32Array(count);
  if (isMagenta(key)) {
    const full = Math.max(1, Math.min(key[0], key[2]) - key[1]);
    const low = 0.18 * full;
    const high = 0.85 * full;
    for (let pixel = 0; pixel < count; pixel++) {
      const offset = pixel * 4;
      const spill = Math.max(0, Math.min(source.data[offset], source.data[offset + 2]) - source.data[offset + 1]);
      alpha[pixel] = 1 - Math.max(0, Math.min(1, (spill - low) / (high - low)));
    }
    erode(alpha, source.width, source.height);
    return { image: paint(source, alpha, key, true), how: "magenta key" };
  }
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    const dist = Math.hypot(source.data[offset] - key[0], source.data[offset + 1] - key[1], source.data[offset + 2] - key[2]);
    alpha[pixel] = Math.max(0, Math.min(1, (dist - 28) / 70));
  }
  const hex = key.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
  return { image: paint(source, alpha, key, false), how: `key #${hex}` };
}

export async function rembgAlpha(images: Rgba[]): Promise<{ images: Rgba[] | null; how: string }> {
  if (!images.length) return { images: [], how: "rembg isnet-general-use" };
  const dir = path.resolve(process.cwd(), ".gen", "_rembg");
  mkdirSync(dir, { recursive: true });
  const pairs: string[] = [];
  for (let index = 0; index < images.length; index++) {
    const input = path.join(dir, `in_${index}.png`);
    const mask = path.join(dir, `mask_${index}.png`);
    await sharp(await encode(images[index])).png().toFile(input);
    pairs.push(input, mask);
  }
  const result = await new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn("python", [rembgScript, ...pairs], { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("rembg 시간이 초과되었습니다."));
    }, 180_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  }).catch((error: unknown) => ({ code: 1, stderr: error instanceof Error ? error.message : "rembg를 실행하지 못했습니다." }));
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").at(-1) || "rembg를 실행하지 못했습니다.";
    return { images: null, how: detail };
  }
  const masked: Rgba[] = [];
  for (let index = 0; index < images.length; index++) {
    const source = images[index];
    const key = borderColor(source) ?? [255, 0, 255];
    const { data, info } = await sharp(path.join(dir, `mask_${index}.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== source.width || info.height !== source.height) {
      return { images: null, how: "rembg 마스크 크기가 칸과 다릅니다." };
    }
    const alpha = new Float32Array(source.width * source.height);
    for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = data[pixel] / 255;
    masked.push(paint(source, alpha, key, isMagenta(key)));
  }
  return { images: masked, how: "rembg isnet-general-use" };
}

function ycbcr(r: number, g: number, b: number) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return { cb, cr };
}

function cornersBlack(image: Rgba) {
  const { data, width, height } = image;
  const span = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) / 12)));
  const origins = [[0, 0], [width - span, 0], [0, height - span], [width - span, height - span]];
  let sum = 0;
  let count = 0;
  for (const [ox, oy] of origins) {
    for (let y = oy; y < oy + span; y++) {
      for (let x = ox; x < ox + span; x++) {
        const offset = (y * width + x) * 4;
        sum += Math.max(data[offset], data[offset + 1], data[offset + 2]);
        count += 1;
      }
    }
  }
  return sum / Math.max(1, count) < 12;
}

function matteBlack(image: Rgba) {
  const { data, width, height } = image;
  const count = width * height;
  const colored = new Uint8Array(count);
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (data[offset] > 18 || data[offset + 1] > 18 || data[offset + 2] > 18) colored[pixel] = 1;
  }
  const keep = colored.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!colored[y * width + x]) continue;
      if (x > 0) keep[y * width + x - 1] = 1;
      if (x + 1 < width) keep[y * width + x + 1] = 1;
      if (y > 0) keep[(y - 1) * width + x] = 1;
      if (y + 1 < height) keep[(y + 1) * width + x] = 1;
    }
  }
  const seen = new Uint8Array(count);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (seen[pixel] || keep[pixel]) return;
    seen[pixel] = 1;
    queue.push(pixel);
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
    const pixel = queue.pop() as number;
    data[pixel * 4 + 3] = 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
}

function cornerChroma(image: Rgba) {
  const { data, width, height } = image;
  const span = Math.max(4, Math.min(16, Math.floor(Math.min(width, height) / 12)));
  const cb: number[] = [];
  const cr: number[] = [];
  const origins = [[0, 0], [width - span, 0], [0, height - span], [width - span, height - span]];
  for (const [ox, oy] of origins) {
    for (let y = oy; y < oy + span; y++) {
      for (let x = ox; x < ox + span; x++) {
        const offset = (y * width + x) * 4;
        const chroma = ycbcr(data[offset], data[offset + 1], data[offset + 2]);
        cb.push(chroma.cb);
        cr.push(chroma.cr);
      }
    }
  }
  return { cb: median(cb), cr: median(cr) };
}

function matteChroma(image: Rgba) {
  const { data, width, height } = image;
  const key = cornerChroma(image);
  const soft = 18;
  const hard = 42;
  const distAt = (offset: number) => {
    const chroma = ycbcr(data[offset], data[offset + 1], data[offset + 2]);
    return Math.hypot(chroma.cb - key.cb, chroma.cr - key.cr);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const dist = distAt(offset);
      let alpha = 255;
      if (dist <= soft) alpha = 0;
      else if (dist < hard) alpha = Math.round((255 * (dist - soft)) / (hard - soft));
      data[offset + 3] = Math.min(data[offset + 3], alpha);
    }
  }
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    const pixel = y * width + x;
    if (seen[pixel]) return;
    const offset = pixel * 4;
    if (data[offset + 3] > 40 && distAt(offset) > hard) return;
    seen[pixel] = 1;
    queue.push(pixel);
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
    const pixel = queue.pop() as number;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    data[pixel * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
}

function legacyAlpha(image: Rgba): { image: Rgba; how: string } {
  const copy = { data: Buffer.from(image.data), width: image.width, height: image.height };
  if (cornersBlack(copy)) {
    matteBlack(copy);
    return { image: copy, how: "검정 가장자리" };
  }
  matteChroma(copy);
  return { image: copy, how: "모서리 색상" };
}

function checker(width: number, height: number) {
  const cell = 12;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shade = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 150 : 200;
      const offset = (y * width + x) * 3;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
    }
  }
  return data;
}

export async function compareOptions(rows: Rgba[][], labels: string[]) {
  const thumbH = 140;
  const labelH = 28;
  const scaled = await Promise.all(rows.map((row) => Promise.all(row.map(async (frame) => {
    const height = Math.min(thumbH, frame.height);
    const width = Math.max(1, Math.round(frame.width * (height / frame.height)));
    const png = await sharp(await encode(frame)).resize(width, height).png().toBuffer();
    return { png, width, height };
  }))));
  const width = Math.max(1, ...scaled.map((row) => row.reduce((sum, frame) => sum + frame.width, 0)));
  const height = labelH + scaled.reduce((sum, row) => sum + labelH + (row[0]?.height ?? thumbH), 0);
  const board = checker(width, height);
  const composites: { input: Buffer; left: number; top: number }[] = [];
  let top = 0;
  for (let row = 0; row < scaled.length; row++) {
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${labelH}"><text x="8" y="20" fill="white" font-size="16" font-family="sans-serif">${labels[row] ?? ""}</text></svg>`);
    composites.push({ input: label, left: 0, top });
    top += labelH;
    let left = 0;
    for (const frame of scaled[row]) {
      composites.push({ input: frame.png, left, top });
      left += frame.width;
    }
    top += scaled[row][0]?.height ?? thumbH;
  }
  return sharp(board, { raw: { width, height, channels: 3 } })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function buildOptions(inputs: Buffer[], untouched = inputs) {
  const decoded = await Promise.all(inputs.map(decode));
  const plain = untouched.length === inputs.length ? untouched : inputs;
  const plainImages = plain === inputs ? decoded : await Promise.all(plain.map(decode));
  const keyed = decoded.map((image) => keyAlpha(image));
  const legacy = decoded.map((image) => legacyAlpha(image));
  const plates = decoded.map(plate);
  const removed = await rembgAlpha(plates);
  const rows = [keyed.map((item) => item.image)];
  const labels = ["A 테두리 색"];
  if (removed.images) {
    rows.push(removed.images);
    labels.push("B rembg");
  }
  rows.push(legacy.map((item) => item.image));
  labels.push("C 원래 방식");
  rows.push(plainImages);
  labels.push("D 배경 유지");
  const hows = [...new Set(legacy.map((item) => item.how))];
  return {
    a: await Promise.all(keyed.map((item) => encode(item.image))),
    b: removed.images ? await Promise.all(removed.images.map((image) => encode(image))) : null,
    c: await Promise.all(legacy.map((item) => encode(item.image))),
    d: plain,
    aHow: keyed[0]?.how ?? "key",
    bHow: removed.how,
    cHow: hows.join(", "),
    dHow: "배경 유지",
    compare: await compareOptions(rows, labels),
  };
}
