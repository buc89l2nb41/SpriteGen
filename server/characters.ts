import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const genDir = path.resolve(process.cwd(), ".gen");
const activePath = path.join(genDir, "character.png");

export async function saveCharacter(bytes: Buffer) {
  const png = await sharp(bytes).ensureAlpha().png().toBuffer();
  mkdirSync(path.dirname(activePath), { recursive: true });
  writeFileSync(activePath, png);
}

export function drawWorkspace() {
  const dir = path.join(genDir, "draw");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { dir, imagePath: path.join(dir, "image.png") };
}

export async function pngFile(file: string) {
  return sharp(file).ensureAlpha().png().toBuffer();
}
