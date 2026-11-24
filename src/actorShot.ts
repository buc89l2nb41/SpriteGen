import * as THREE from "three";
import { createSkinner } from "./bodySkin";
import { humanGeometry, loadHumanParts } from "./humanBody";
import type { Pose } from "./pose";

type Shot = { pose: Pose; facing?: number };

const WIDTH = 768;
const HEIGHT = 1024;

export const ACTOR_ROOM = 1.55;

const looks = {
  actor: { body: 0xc6866a, backdrop: 0xd9d3c8, floor: 0xc6bfb4, room: ACTOR_ROOM },
  puppet: { body: 0x9a9a9a, backdrop: 0xeeeeee, floor: 0xdedede, room: 2.1 },
};

export function placeSideCamera(camera: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number, room: number) {
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * room;
  camera.position.set(center.x, center.y, center.z + distance);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = distance * 10;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

async function shoot(poses: Shot[], look: keyof typeof looks) {
  const colors = looks[look];
  const parts = await loadHumanParts();
  const geometry = humanGeometry(parts);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(colors.backdrop);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x8d8478, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 40),
    new THREE.MeshStandardMaterial({ color: colors.floor, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const material = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.62, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  const rest = new Float32Array(geometry.getAttribute("position").array);
  const skinner = createSkinner(parts.rig, rest);
  const positions = geometry.getAttribute("position").array as Float32Array;
  const box = new THREE.Box3();
  for (const shot of poses) {
    skinner.apply(shot.pose, positions, shot.facing ?? 0);
    geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 200);
  placeSideCamera(camera, sphere.center, sphere.radius, colors.room);
  const pngs: string[] = [];
  for (const shot of poses) {
    skinner.apply(shot.pose, positions, shot.facing ?? 0);
    geometry.getAttribute("position").needsUpdate = true;
    geometry.computeVertexNormals();
    renderer.render(scene, camera);
    pngs.push(renderer.domElement.toDataURL("image/png"));
  }
  geometry.dispose();
  material.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return pngs;
}

export function actorShotPngs(poses: Shot[]) {
  return shoot(poses, "actor");
}

export async function puppetStill(pose: Pose) {
  const [still] = await shoot([{ pose }], "puppet");
  return still;
}

export function puppetStills(poses: Pose[]) {
  return shoot(poses.map((pose) => ({ pose })), "puppet");
}
