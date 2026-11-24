import * as THREE from "three";
import { fingerJointIds, stand, type BodyId, type Pose, type Point } from "./pose";

type RigBone = { name: string; parent: number; head: number[]; tail: number[] };
type Rig = { height: number; bones: RigBone[]; bind: number[]; weight: number[] };

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const GROUND = 0.9;
const WRIST_MAX = 1.05;
const ANKLE_MAX = 1.05;
const SPINE_MAX = 1.2;
const NECK_MAX = 1.2;
const FINGER_MAX = 1.5;

function signedBend(from: THREE.Vector3, to: THREE.Vector3) {
  if (Math.hypot(from.x, from.y) < 1e-6 || Math.hypot(to.x, to.y) < 1e-6) return 0;
  return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
}

function rotateZ(vector: THREE.Vector3, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new THREE.Vector3(vector.x * c - vector.y * s, vector.x * s + vector.y * c, vector.z);
}

function clampAngle(angle: number, max: number) {
  return Math.min(max, Math.max(-max, angle));
}

function splitBend(from: THREE.Vector3, to: THREE.Vector3, max: number) {
  const bend = signedBend(from, to);
  const joint = clampAngle(bend, max);
  const direction = rotateZ(from, joint);
  if (direction.lengthSq() < 1e-8) return { direction: to, rest: 0 };
  return { direction, rest: bend - joint };
}

const chains = {
  R: { shoulder: "rShoulder", elbow: "rElbow", wrist: "rWrist", hand: "rHand", hip: "rHip", knee: "rKnee", ankle: "rAnkle", toe: "rToe" },
  L: { shoulder: "lShoulder", elbow: "lElbow", wrist: "lWrist", hand: "lHand", hip: "lHip", knee: "lKnee", ankle: "lAnkle", toe: "lToe" },
} as const;

function boneMatrix(head: THREE.Vector3, tail: THREE.Vector3, target: THREE.Matrix4) {
  const direction = tail.clone().sub(head);
  if (direction.lengthSq() < 1e-8) direction.copy(UP);
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize());
  target.compose(head, rotation, ONE);
}

export function createSkinner(rig: Rig, restPositions: Float32Array) {
  const bones = rig.bones;
  const count = bones.length;
  const names = new Map(bones.map((bone, index) => [bone.name, index]));
  const children: number[][] = Array.from({ length: count }, () => []);
  const restWorld = bones.map(() => new THREE.Matrix4());
  const restLocal = bones.map(() => new THREE.Matrix4());
  const invBind = bones.map(() => new THREE.Matrix4());
  const posed = bones.map(() => new THREE.Matrix4());
  const skin = bones.map(() => new THREE.Matrix4());
  for (let index = 0; index < count; index += 1) {
    boneMatrix(new THREE.Vector3(...bones[index].head), new THREE.Vector3(...bones[index].tail), restWorld[index]);
    invBind[index].copy(restWorld[index]).invert();
    const parent = bones[index].parent;
    if (parent >= 0) children[parent].push(index);
  }
  for (let index = 0; index < count; index += 1) {
    const parent = bones[index].parent;
    restLocal[index].copy(parent < 0 ? restWorld[index] : restWorld[parent]).invert();
    restLocal[index].multiply(restWorld[index]);
    if (parent < 0) restLocal[index].copy(restWorld[index]);
  }

  function digitChains(prefix: "finger" | "toe", side: "R" | "L") {
    const groups = new Map<string, string[]>();
    for (const bone of bones) {
      const match = new RegExp(`^${prefix}(\\d+)-(\\d+)\\.${side}$`).exec(bone.name);
      if (!match) continue;
      const group = groups.get(match[1]) ?? [];
      group.push(bone.name);
      groups.set(match[1], group);
    }
    return [...groups.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, chain]) => chain.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  }
  const fingerChains = { R: digitChains("finger", "R"), L: digitChains("finger", "L") };
  const toeChains = { R: digitChains("toe", "R"), L: digitChains("toe", "L") };
  const fingerLength = new Map<number, number>();
  const fingerMarkers: [BodyId, number, boolean][] = [];
  for (const side of ["R", "L"] as const) {
    fingerChains[side].forEach((chain, index) => {
      const joints = fingerJointIds(side === "R" ? "r" : "l", index);
      const slots: [BodyId, string | undefined, boolean][] = [
        [joints[0], chain[0], false],
        [joints[1], chain[1], false],
        [joints[2], chain[chain.length - 1], true],
      ];
      for (const [id, bone, tail] of slots) {
        if (!bone) continue;
        const boneIndex = names.get(bone);
        if (boneIndex === undefined) continue;
        if (tail) {
          const head = bones[boneIndex].head;
          const end = bones[boneIndex].tail;
          fingerLength.set(boneIndex, Math.hypot(end[0] - head[0], end[1] - head[1], end[2] - head[2]));
        }
        fingerMarkers.push([id, boneIndex, tail]);
      }
    });
  }

  const root = names.get("root") ?? 0;
  const rootPosition = new THREE.Vector3().setFromMatrixPosition(restWorld[root]);
  const rootRotation = new THREE.Quaternion();
  restWorld[root].decompose(new THREE.Vector3(), rootRotation, new THREE.Vector3());
  const baseYaw = Math.PI / 2;
  const yaw = new THREE.Quaternion();
  const scale = rig.height / 0.75;
  const origin = stand();

  function place(point: Point) {
    return new THREE.Vector3((point.x - 0.5) * scale, (GROUND - point.y) * scale, (point.z ?? 0) * scale);
  }

  function delta(pose: Pose, id: BodyId) {
    return place(pose[id]).sub(place(origin[id]));
  }

  function hierarchy(rootMatrix: THREE.Matrix4) {
    const done = new Array<boolean>(count).fill(false);
    const visit = (index: number): THREE.Matrix4 => {
      if (done[index]) return posed[index];
      const parent = bones[index].parent;
      if (parent < 0) posed[index].copy(rootMatrix);
      else posed[index].multiplyMatrices(visit(parent), restLocal[index]);
      done[index] = true;
      return posed[index];
    };
    for (let index = 0; index < count; index += 1) visit(index);
  }

  function swing(name: string, head: THREE.Vector3, tail: THREE.Vector3, override: Set<number>) {
    const index = names.get(name);
    if (index === undefined) return;
    const current = posed[index];
    const axis = new THREE.Vector3(current.elements[4], current.elements[5], current.elements[6]);
    if (axis.lengthSq() < 1e-8) axis.copy(UP);
    axis.normalize();
    const direction = tail.clone().sub(head);
    if (direction.lengthSq() < 1e-8) direction.copy(axis);
    direction.normalize();
    const rotation = new THREE.Quaternion();
    current.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
    rotation.premultiply(new THREE.Quaternion().setFromUnitVectors(axis, direction));
    current.compose(head, rotation, ONE);
    override.add(index);
  }

  function segment(pose: Pose, from: BodyId, to: BodyId) {
    return place(pose[to]).sub(place(pose[from]));
  }

  function torsoVector(pose: Pose) {
    const hip = place(pose.rHip).add(place(pose.lHip)).multiplyScalar(0.5);
    return place(pose.neck).sub(hip);
  }

  function aim(name: string, head: THREE.Vector3, direction: THREE.Vector3, override: Set<number>) {
    swing(name, head, head.clone().add(direction), override);
  }

  function poseUpper(side: "R" | "L", pose: Pose, override: Set<number>) {
    const map = chains[side];
    const shoulder = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`upperarm01.${side}`) ?? 0]);
    const hip = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`upperleg01.${side}`) ?? 0]);
    aim(`upperarm01.${side}`, shoulder, segment(pose, map.shoulder, map.elbow), override);
    aim(`upperleg01.${side}`, hip, segment(pose, map.hip, map.knee), override);
  }

  function poseLower(side: "R" | "L", pose: Pose, override: Set<number>) {
    const map = chains[side];
    const elbow = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`lowerarm01.${side}`) ?? 0]);
    const knee = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`lowerleg01.${side}`) ?? 0]);
    aim(`lowerarm01.${side}`, elbow, segment(pose, map.elbow, map.wrist), override);
    aim(`lowerleg01.${side}`, knee, segment(pose, map.knee, map.ankle), override);
  }

  function poseEnd(side: "R" | "L", pose: Pose, override: Set<number>) {
    const map = chains[side];
    const wrist = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`wrist.${side}`) ?? 0]);
    const foot = new THREE.Vector3().setFromMatrixPosition(posed[names.get(`foot.${side}`) ?? 0]);
    const arm = splitBend(segment(pose, map.elbow, map.wrist), segment(pose, map.wrist, map.hand), WRIST_MAX);
    const leg = splitBend(segment(pose, map.knee, map.ankle), segment(pose, map.ankle, map.toe), ANKLE_MAX);
    aim(`wrist.${side}`, wrist, arm.direction, override);
    aim(`foot.${side}`, foot, leg.direction, override);
    return { curl: arm.rest, toe: leg.rest };
  }

  const markerBones: [BodyId, string][] = [
    ["nose", "head"],
    ["neck", "neck01"],
    ["rShoulder", "upperarm01.R"],
    ["rElbow", "lowerarm01.R"],
    ["rWrist", "wrist.R"],
    ["lShoulder", "upperarm01.L"],
    ["lElbow", "lowerarm01.L"],
    ["lWrist", "wrist.L"],
    ["rHip", "upperleg01.R"],
    ["rKnee", "lowerleg01.R"],
    ["rAnkle", "foot.R"],
    ["lHip", "upperleg01.L"],
    ["lKnee", "lowerleg01.L"],
    ["lAnkle", "foot.L"],
  ];
  const markers = new Map<BodyId, THREE.Vector3>();
  let lift = 0;

  function apply(pose: Pose, output: Float32Array, facing = 0) {
    yaw.setFromAxisAngle(UP, baseYaw + facing * Math.PI / 180);
    const shift = delta(pose, "rHip").add(delta(pose, "lHip")).multiplyScalar(0.5);
    const turned = yaw.clone().multiply(rootRotation);
    const rootMatrix = new THREE.Matrix4().compose(rootPosition.clone().add(shift), turned, ONE);
    hierarchy(rootMatrix);
    const override = new Set<number>();
    const relocalize = (index: number) => {
      const parent = bones[index].parent;
      if (!override.has(index) && parent >= 0) posed[index].multiplyMatrices(posed[parent], restLocal[index]);
      for (const child of children[index]) relocalize(child);
    };
    const bendBone = (name: string, angle: number) => {
      if (Math.abs(angle) < 1e-4) return;
      const index = names.get(name);
      if (index === undefined) return;
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      posed[index].decompose(position, rotation, new THREE.Vector3());
      rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, angle));
      posed[index].compose(position, rotation, ONE);
      override.add(index);
    };
    const bendChain = (chain: string[], angle: number) => {
      if (chain.length === 0 || Math.abs(angle) < 1e-4) return;
      const step = angle / chain.length;
      for (const name of chain) {
        bendBone(name, step);
        relocalize(root);
      }
    };
    const bendAngles = (chain: string[], angles: number[]) => {
      chain.forEach((name, index) => {
        bendBone(name, angles[index] ?? 0);
        relocalize(root);
      });
    };
    const bendDigits = (chainsForSide: string[][], angle: number) => {
      if (Math.abs(angle) < 1e-4) return;
      for (const chain of chainsForSide) {
        if (chain.length === 0) continue;
        const step = angle / chain.length;
        for (const name of chain) {
          bendBone(name, step);
          relocalize(root);
        }
      }
    };
    const spineAngle = clampAngle(signedBend(torsoVector(origin), torsoVector(pose)), SPINE_MAX);
    const neckAngle = clampAngle(
      signedBend(segment(origin, "neck", "nose"), segment(pose, "neck", "nose")) - spineAngle,
      NECK_MAX,
    );
    bendChain(["spine05", "spine04", "spine03", "spine02", "spine01"], spineAngle);
    poseUpper("R", pose, override);
    poseUpper("L", pose, override);
    relocalize(root);
    poseLower("R", pose, override);
    poseLower("L", pose, override);
    relocalize(root);
    const rightEnd = poseEnd("R", pose, override);
    const leftEnd = poseEnd("L", pose, override);
    relocalize(root);
    const fingerLocals = (side: "R" | "L", index: number) => {
      const map = chains[side];
      const joints = [map.wrist, ...fingerJointIds(side === "R" ? "r" : "l", index)] as BodyId[];
      const palm = signedBend(segment(origin, map.wrist, map.hand), segment(pose, map.wrist, map.hand));
      const world = joints.slice(1).map((_, joint) => (
        signedBend(segment(origin, joints[joint], joints[joint + 1]), segment(pose, joints[joint], joints[joint + 1])) - palm
      ));
      const local: number[] = [];
      let carried = 0;
      for (const angle of world) {
        const bend = clampAngle(angle - carried, FINGER_MAX);
        local.push(bend);
        carried += bend;
      }
      return local;
    };
    fingerChains.R.forEach((chain, index) => bendAngles(chain, fingerLocals("R", index)));
    fingerChains.L.forEach((chain, index) => bendAngles(chain, fingerLocals("L", index)));
    bendDigits(toeChains.R, rightEnd.toe);
    bendDigits(toeChains.L, leftEnd.toe);
    bendChain(["neck01", "neck02", "neck03"], neckAngle);
    relocalize(root);
    for (let index = 0; index < count; index += 1) skin[index].multiplyMatrices(posed[index], invBind[index]);
    const vertex = new THREE.Vector3();
    const posedVertex = new THREE.Vector3();
    for (let i = 0; i < restPositions.length; i += 3) {
      const slot = (i / 3) * 4;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let influence = 0; influence < 4; influence += 1) {
        const amount = rig.weight[slot + influence];
        if (amount <= 0) continue;
        vertex.set(restPositions[i], restPositions[i + 1], restPositions[i + 2]);
        posedVertex.copy(vertex).applyMatrix4(skin[rig.bind[slot + influence]]);
        x += posedVertex.x * amount;
        y += posedVertex.y * amount;
        z += posedVertex.z * amount;
      }
      output[i] = x;
      output[i + 1] = y;
      output[i + 2] = z;
    }
    let lowest = 0;
    for (let i = 1; i < output.length; i += 3) lowest = Math.min(lowest, output[i]);
    lift = lowest < 0 ? -lowest : 0;
    if (lift) {
      for (let i = 1; i < output.length; i += 3) output[i] += lift;
    }
    for (const [id, bone] of markerBones) {
      const index = names.get(bone);
      if (index === undefined) continue;
      const position = markers.get(id) ?? new THREE.Vector3();
      position.setFromMatrixPosition(posed[index]);
      position.y += lift;
      markers.set(id, position);
    }
    for (const [id, index, tail] of fingerMarkers) {
      const position = markers.get(id) ?? new THREE.Vector3();
      position.setFromMatrixPosition(posed[index]);
      if (tail) {
        const dir = new THREE.Vector3(posed[index].elements[4], posed[index].elements[5], posed[index].elements[6]);
        if (dir.lengthSq() > 1e-8) position.add(dir.normalize().multiplyScalar(fingerLength.get(index) ?? 0));
      }
      position.y += lift;
      markers.set(id, position);
    }
  }

  return { apply, markers, scale };
}
