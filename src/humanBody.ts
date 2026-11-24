import * as THREE from "three";
import bodyUrl from "../assets/human/base.obj?url";
import rigUrl from "../assets/human/body-rig.json?url";

const BODY_VERTS = 13380;

export type HumanRig = {
  height: number;
  bones: { name: string; parent: number; head: number[]; tail: number[] }[];
  bind: number[];
  weight: number[];
};

type HumanParts = { positions: Float32Array; indices: number[]; rig: HumanRig };

let loading: Promise<HumanParts> | null = null;

function parseObj(text: string) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      if (positions.length / 3 >= BODY_VERTS) continue;
      const parts = line.trim().split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (line.startsWith("f ")) {
      const ids = line.trim().split(/\s+/).slice(1).map((part) => Number(part.split("/")[0]) - 1);
      if (ids.some((id) => id < 0 || id >= BODY_VERTS)) continue;
      indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
  return { positions: new Float32Array(positions), indices };
}

export function loadHumanParts() {
  loading ??= Promise.all([fetch(bodyUrl), fetch(rigUrl)]).then(async ([body, rig]) => {
    if (!body.ok || !rig.ok) throw new Error("몸 파일을 열지 못했습니다.");
    return { ...parseObj(await body.text()), rig: await rig.json() as HumanRig };
  });
  return loading;
}

export function humanGeometry(parts: HumanParts) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(parts.positions.slice(), 3));
  geometry.setIndex(parts.indices.slice());
  geometry.computeVertexNormals();
  splitHandGeometry(geometry, parts.rig);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  return geometry;
}

function splitHandGeometry(geometry: THREE.BufferGeometry, rig: HumanRig) {
  const source = geometry.getIndex();
  if (!source) return;
  const handBone = new Set<number>();
  rig.bones.forEach((bone, index) => {
    if (bone.name.startsWith("finger") || bone.name.startsWith("wrist")) handBone.add(index);
  });
  const count = geometry.getAttribute("position").count;
  const handVertex = new Uint8Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) {
    let bestBone = -1;
    let bestWeight = 0;
    const slot = vertex * 4;
    for (let influence = 0; influence < 4; influence += 1) {
      const amount = rig.weight[slot + influence];
      if (amount <= bestWeight) continue;
      bestWeight = amount;
      bestBone = rig.bind[slot + influence];
    }
    if (handBone.has(bestBone)) handVertex[vertex] = 1;
  }
  const body: number[] = [];
  const hand: number[] = [];
  for (let index = 0; index < source.count; index += 3) {
    const a = source.getX(index);
    const b = source.getX(index + 1);
    const c = source.getX(index + 2);
    const dest = handVertex[a] || handVertex[b] || handVertex[c] ? hand : body;
    dest.push(a, b, c);
  }
  const merged = new Uint32Array(body.length + hand.length);
  merged.set(body);
  merged.set(hand, body.length);
  geometry.setIndex(new THREE.BufferAttribute(merged, 1));
  geometry.clearGroups();
  geometry.addGroup(0, body.length, 0);
  geometry.addGroup(body.length, hand.length, 1);
}
