import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../assets/human/", import.meta.url);
const obj = readFileSync(new URL("base.obj", root), "utf8");
const skel = JSON.parse(readFileSync(new URL("default.mhskel", root), "utf8"));
const weightsFile = JSON.parse(readFileSync(new URL("default_weights.mhw", root), "utf8"));
const BODY = 13380;
const positions = [];
for (const line of obj.split("\n")) {
  if (!line.startsWith("v ")) continue;
  const parts = line.trim().split(/\s+/);
  positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
}
let minX = Infinity;
let minY = Infinity;
let minZ = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
let maxZ = -Infinity;
for (let i = 0; i < BODY; i += 1) {
  const x = positions[i * 3];
  const y = positions[i * 3 + 1];
  const z = positions[i * 3 + 2];
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  minZ = Math.min(minZ, z);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
  maxZ = Math.max(maxZ, z);
}
const tx = -((minX + maxX) / 2);
const ty = -minY;
const tz = -((minZ + maxZ) / 2);

function centroid(name) {
  const ids = skel.joints[name];
  if (!ids?.length) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const id of ids) {
    const base = id * 3;
    if (base + 2 >= positions.length) continue;
    x += positions[base];
    y += positions[base + 1];
    z += positions[base + 2];
    count += 1;
  }
  if (!count) return [0, 0, 0];
  return [x / count + tx, y / count + ty, z / count + tz];
}

const names = Object.keys(skel.bones);
const indexOf = new Map(names.map((name, index) => [name, index]));
const bones = names.map((name) => {
  const bone = skel.bones[name];
  const parent = bone.parent ? indexOf.get(bone.parent) : -1;
  return {
    name,
    parent: parent ?? -1,
    head: centroid(bone.head),
    tail: centroid(bone.tail),
  };
});

const lists = Array.from({ length: BODY }, () => []);
for (const [name, pairs] of Object.entries(weightsFile.weights)) {
  const bone = indexOf.get(name);
  if (bone === undefined) continue;
  for (const [vertex, weight] of pairs) {
    if (vertex < 0 || vertex >= BODY || weight <= 0) continue;
    lists[vertex].push([bone, weight]);
  }
}
const bind = new Array(BODY * 4);
const weight = new Array(BODY * 4);
for (let vertex = 0; vertex < BODY; vertex += 1) {
  const list = lists[vertex].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = list.reduce((sum, item) => sum + item[1], 0) || 1;
  if (!list.length) list.push([indexOf.get("root") ?? 0, 1]);
  for (let slot = 0; slot < 4; slot += 1) {
    const item = list[slot] ?? [indexOf.get("root") ?? 0, 0];
    bind[vertex * 4 + slot] = item[0];
    weight[vertex * 4 + slot] = slot < list.length ? item[1] / total : 0;
  }
}

const rig = {
  height: maxY - minY,
  bones,
  bind,
  weight,
};
writeFileSync(new URL("body-rig.json", root), JSON.stringify(rig));
const hip = bones.find((bone) => bone.name === "upperleg01.R");
const neck = bones.find((bone) => bone.name === "neck01");
console.log(JSON.stringify({
  bones: bones.length,
  height: rig.height,
  hip: hip?.head,
  neck: neck?.head,
  bytes: Buffer.byteLength(JSON.stringify(rig)),
}));
