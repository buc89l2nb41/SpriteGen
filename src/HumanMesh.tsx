import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ACTOR_ROOM, placeSideCamera } from "./actorShot";
import { createSkinner } from "./bodySkin";
import { humanGeometry, loadHumanParts } from "./humanBody";
import { fingerJointIds, isFingerJoint, jointColor, moveSelection, rotateSelectionAxis, type BodyId, type Pose } from "./pose";

export type HumanMeshHandle = { setPose: (pose: Pose, facing?: number) => void };

const RING = 2.05;
const FINGER_SCALE = 0.16;

function FacingField({ facing, disabled, onEditStart, onFacing }: {
  facing: number;
  disabled?: boolean;
  onEditStart: () => void;
  onFacing: (facing: number) => void;
}) {
  const [text, setText] = useState(() => String(Math.round(facing)));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(Math.round(facing)));
  }, [facing, editing]);
  function commit(raw: string) {
    setEditing(false);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setText(String(Math.round(facing)));
      return;
    }
    const next = Math.round(value);
    setText(String(next));
    if (Math.abs(next - facing) < 0.5) return;
    onEditStart();
    onFacing(next);
  }
  return (
    <label className="human-facing">
      <span>방향</span>
      <input
        type="number"
        aria-label="방향"
        value={text}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
      <span>°</span>
    </label>
  );
}

function yawOf(facing: number) {
  return Math.PI / 2 + facing * Math.PI / 180;
}

function localDelta(delta: THREE.Vector3, facing: number) {
  const yaw = yawOf(facing);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: delta.x * cos - delta.z * sin,
    y: delta.y,
    z: delta.x * sin + delta.z * cos,
  };
}

export const HumanMesh = forwardRef<HumanMeshHandle, {
  pose: Pose;
  facing: number;
  tool: "move" | "rotate";
  selection: BodyId[];
  disabled?: boolean;
  onSelect: (ids: BodyId[]) => void;
  onEditStart: () => void;
  onPose: (pose: Pose) => void;
  onFacing: (facing: number) => void;
}>(function HumanMesh({ pose, facing, tool, selection, disabled, onSelect, onEditStart, onPose, onFacing }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef(pose);
  const facingRef = useRef(facing);
  const toolRef = useRef(tool);
  const selectionRef = useRef(selection);
  const disabledRef = useRef(Boolean(disabled));
  const onSelectRef = useRef(onSelect);
  const onEditStartRef = useRef(onEditStart);
  const onPoseRef = useRef(onPose);
  const onFacingRef = useRef(onFacing);
  const applyRef = useRef<((pose: Pose, facing?: number) => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const atFilmRef = useRef(true);
  const [atFilm, setAtFilm] = useState(true);
  const [status, setStatus] = useState("몸을 불러오는 중");
  poseRef.current = pose;
  facingRef.current = facing;
  toolRef.current = tool;
  selectionRef.current = selection;
  disabledRef.current = Boolean(disabled);
  onSelectRef.current = onSelect;
  onEditStartRef.current = onEditStart;
  onPoseRef.current = onPose;
  onFacingRef.current = onFacing;
  useImperativeHandle(ref, () => ({ setPose: (next, nextFacing = facingRef.current) => applyRef.current?.(next, nextFacing) }), []);
  useEffect(() => { applyRef.current?.(pose, facing); }, [pose, facing, selection]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xd9d3c8);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    scene.add(new THREE.HemisphereLight(0xfff4e8, 0x8d8478, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    scene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 40),
      new THREE.MeshStandardMaterial({ color: 0xc6bfb4, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const handles = new THREE.Group();
    scene.add(handles);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING, 0.07, 10, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.name = "facing-ring";
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xff002e, roughness: 0.45 }),
    );
    knob.name = "facing-knob";
    scene.add(ring, knob);

    const gizmo = new THREE.Group();
    scene.add(gizmo);
    const gizmoRadius = 1.35;
    const makeRing = (name: string, color: number, radius: number, tube: number) => {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 14, 56),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
      );
      mesh.name = name;
      mesh.renderOrder = 4;
      mesh.userData.base = color;
      gizmo.add(mesh);
      return mesh;
    };
    const ringX = makeRing("gizmo-x", 0xff3b30, gizmoRadius, 0.2);
    ringX.rotation.y = Math.PI / 2;
    ringX.userData.axis = new THREE.Vector3(1, 0, 0);
    const ringY = makeRing("gizmo-y", 0x2fce6b, gizmoRadius, 0.2);
    ringY.rotation.x = Math.PI / 2;
    ringY.userData.axis = new THREE.Vector3(0, 1, 0);
    const ringZ = makeRing("gizmo-z", 0x3d8bff, gizmoRadius, 0.2);
    ringZ.userData.axis = new THREE.Vector3(0, 0, 1);
    const ringView = makeRing("gizmo-view", 0xf7f7f7, gizmoRadius + 0.48, 0.1);
    ringView.userData.axis = new THREE.Vector3(0, 0, 1);
    const gizmoRings = [ringX, ringY, ringZ, ringView];

    const moveGizmo = new THREE.Group();
    scene.add(moveGizmo);
    const moveHandles: THREE.Mesh[] = [];
    const makeArrow = (name: string, color: number, axis: THREE.Vector3) => {
      const shaftMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
      const headMaterial = shaftMaterial.clone();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.15, 12), shaftMaterial);
      shaft.position.y = 1.5;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.5, 14), headMaterial);
      head.position.y = 2.28;
      const group = new THREE.Group();
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      for (const mesh of [shaft, head]) {
        mesh.name = name;
        mesh.renderOrder = 4;
        mesh.userData.base = color;
        mesh.userData.axis = axis;
        group.add(mesh);
        moveHandles.push(mesh);
      }
      moveGizmo.add(group);
    };
    makeArrow("move-x", 0xff3b30, new THREE.Vector3(1, 0, 0));
    makeArrow("move-y", 0x2fce6b, new THREE.Vector3(0, 1, 0));
    makeArrow("move-z", 0x3d8bff, new THREE.Vector3(0, 0, 1));
    const markerPositions = new Map<BodyId, THREE.Vector3>();
    const viewDirection = new THREE.Vector3();
    const unitZ = new THREE.Vector3(0, 0, 1);
    const placeGizmo = () => {
      const anchor = selectionRef.current[selectionRef.current.length - 1];
      const marker = anchor ? markerPositions.get(anchor) : undefined;
      const show = !disabledRef.current && Boolean(marker);
      gizmo.visible = show && toolRef.current === "rotate";
      moveGizmo.visible = show && toolRef.current === "move";
      if (marker) {
        gizmo.position.copy(marker);
        moveGizmo.position.copy(marker);
      }
      camera.getWorldDirection(viewDirection);
      if (viewDirection.lengthSq() > 1e-8) {
        ringView.quaternion.setFromUnitVectors(unitZ, viewDirection);
        (ringView.userData.axis as THREE.Vector3).copy(viewDirection);
      }
    };

    const spheres = new Map<BodyId, THREE.Mesh>();
    const fingerGuides = new THREE.Group();
    scene.add(fingerGuides);
    const guideUp = new THREE.Vector3(0, 1, 0);
    const guideDir = new THREE.Vector3();
    const guides: { mesh: THREE.Mesh; from: BodyId; to: BodyId }[] = [];
    for (const side of ["r", "l"] as const) {
      for (let finger = 0; finger < 5; finger += 1) {
        const joints = [side === "r" ? "rWrist" : "lWrist", ...fingerJointIds(side, finger)] as BodyId[];
        for (let segment = 1; segment < joints.length; segment += 1) {
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.045, 1, 5),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthTest: false, depthWrite: false }),
          );
          mesh.renderOrder = 5;
          fingerGuides.add(mesh);
          guides.push({ mesh, from: joints[segment - 1], to: joints[segment] });
        }
      }
    }
    const paintHandles = (markers: Map<BodyId, THREE.Vector3>) => {
      const chosen = new Set(selectionRef.current);
      for (const [id, position] of markers) {
        let sphere = spheres.get(id);
        const finger = isFingerJoint(id);
        if (!sphere) {
          sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.52, finger ? 12 : 18, finger ? 10 : 14),
            finger
              ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthTest: false, depthWrite: false })
              : new THREE.MeshStandardMaterial({ roughness: 0.4, transparent: true, depthTest: false, depthWrite: false }),
          );
          sphere.name = id;
          sphere.renderOrder = finger ? 6 : 3;
          spheres.set(id, sphere);
          handles.add(sphere);
        }
        sphere.position.copy(position);
        const stored = markerPositions.get(id) ?? new THREE.Vector3();
        stored.copy(position);
        markerPositions.set(id, stored);
        sphere.scale.setScalar((chosen.has(id) ? 1.45 : 1) * (finger ? FINGER_SCALE : 1));
        const material = sphere.material as THREE.MeshBasicMaterial;
        material.color.set(chosen.has(id) ? 0xffffff : jointColor(id));
      }
      const ankleA = markers.get("rAnkle");
      const ankleB = markers.get("lAnkle");
      const centerX = ankleA && ankleB ? (ankleA.x + ankleB.x) / 2 : 0;
      const centerZ = ankleA && ankleB ? (ankleA.z + ankleB.z) / 2 : 0;
      ring.position.set(centerX, 0.04, centerZ);
      const yaw = yawOf(facingRef.current);
      knob.position.set(centerX + Math.sin(yaw) * RING, 0.18, centerZ + Math.cos(yaw) * RING);
      for (const guide of guides) {
        const from = markers.get(guide.from);
        const to = markers.get(guide.to);
        if (!from || !to) {
          guide.mesh.visible = false;
          continue;
        }
        guideDir.copy(to).sub(from);
        const length = guideDir.length();
        if (length < 1e-4) {
          guide.mesh.visible = false;
          continue;
        }
        guide.mesh.visible = true;
        guide.mesh.position.copy(from).addScaledVector(guideDir, 0.5);
        guide.mesh.quaternion.setFromUnitVectors(guideUp, guideDir.multiplyScalar(1 / length));
        guide.mesh.scale.set(1, length, 1);
        (guide.mesh.material as THREE.MeshBasicMaterial).color.set(jointColor(guide.to));
      }
    };

    let frame = 0;
    let stopped = false;
    let watching = false;
    let scale = 1;
    let bodySolid = false;
    let bodyMaterial: THREE.MeshStandardMaterial | null = null;
    let handMaterial: THREE.MeshStandardMaterial | null = null;
    const offset = new THREE.Vector3();
    const filmAxis = new THREE.Vector3(0, 0, 1);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane();
    const hitPoint = new THREE.Vector3();
    const drag = {
      kind: "" as "" | "joint" | "facing" | "axis" | "slide",
      pose: null as Pose | null,
      joints: [] as BodyId[],
      anchor: "" as BodyId | "",
      facing: 0,
      start: new THREE.Vector3(),
      anchorPoint: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      basisU: new THREE.Vector3(),
      basisV: new THREE.Vector3(),
      lastAngle: 0,
      total: 0,
      startSlide: 0,
      pointerY: 0,
      moved: false,
    };
    const basisHelper = new THREE.Vector3();
    const armAxis = (name: string) => {
      if (name === "gizmo-view") return viewDirection.clone();
      const ring = gizmoRings.find((item) => item.name === name);
      return (ring?.userData.axis as THREE.Vector3 | undefined)?.clone() ?? null;
    };
    const setAxisBasis = () => {
      basisHelper.set(1, 0, 0);
      if (Math.abs(drag.axis.dot(basisHelper)) > 0.85) basisHelper.set(0, 1, 0);
      drag.basisU.crossVectors(drag.axis, basisHelper).normalize();
      drag.basisV.crossVectors(drag.axis, drag.basisU).normalize();
    };
    const signedAngle = (point: THREE.Vector3) => {
      offset.copy(point).sub(drag.pivot);
      return Math.atan2(offset.dot(drag.basisV), offset.dot(drag.basisU));
    };

    const resize = () => {
      const width = mount.clientWidth || 640;
      const height = mount.clientHeight || 420;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const paint = () => {
      if (stopped) return;
      controls.update();
      const editing = !disabledRef.current;
      handles.visible = editing;
      fingerGuides.visible = editing;
      if (bodyMaterial && handMaterial) {
        const solid = !editing;
        if (solid !== bodySolid) {
          bodySolid = solid;
          bodyMaterial.opacity = solid ? 1 : 0.42;
          bodyMaterial.transparent = !solid;
          bodyMaterial.depthWrite = solid;
          bodyMaterial.needsUpdate = true;
          handMaterial.transparent = !solid;
          handMaterial.depthWrite = true;
          handMaterial.needsUpdate = true;
        }
      }
      if (watching) {
        offset.copy(camera.position).sub(controls.target);
        const aligned = offset.lengthSq() > 1e-6 && offset.normalize().dot(filmAxis) > 0.998;
        if (aligned !== atFilmRef.current) {
          atFilmRef.current = aligned;
          setAtFilm(aligned);
        }
      }
      placeGizmo();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(paint);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    paint();

    const pointerAt = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };
    const onPlane = (point: THREE.Vector3) => {
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(offset), point);
      return raycaster.ray.intersectPlane(plane, hitPoint)?.clone() ?? null;
    };

    const onDown = (event: PointerEvent) => {
      if (disabledRef.current || event.button !== 0) return;
      pointerAt(event);
      const targets = [...handles.children, ring, knob, ...(gizmo.visible ? gizmoRings : []), ...(moveGizmo.visible ? moveHandles : [])];
      const hits = raycaster.intersectObjects(targets, false);
      const nearest = hits[0];
      if (!nearest) return;
      const fingerHit = hits.find((item) => isFingerJoint(item.object.name as BodyId));
      const hit = fingerHit ?? nearest;
      event.preventDefault();
      event.stopPropagation();
      controls.enabled = false;
      const name = hit.object.name;
      if (name.startsWith("move-")) {
        const axis = (hit.object.userData.axis as THREE.Vector3 | undefined)?.clone();
        const anchor = selectionRef.current[selectionRef.current.length - 1];
        if (!axis || !anchor) return;
        drag.kind = "slide";
        drag.axis.copy(axis);
        drag.pivot.copy(moveGizmo.position);
        drag.pose = structuredClone(poseRef.current);
        drag.joints = [...selectionRef.current];
        drag.anchor = anchor;
        drag.facing = facingRef.current;
        drag.pointerY = pointer.y;
        drag.startSlide = slideAlong();
        drag.moved = false;
        paintMeshes(moveHandles, name, true);
        return;
      }
      if (name.startsWith("gizmo-")) {
        const axis = armAxis(name);
        const anchor = selectionRef.current[selectionRef.current.length - 1];
        if (!axis || !anchor) return;
        drag.kind = "axis";
        drag.axis.copy(axis);
        drag.pivot.copy(gizmo.position);
        drag.pose = structuredClone(poseRef.current);
        drag.joints = [...selectionRef.current];
        drag.anchor = anchor;
        drag.total = 0;
        drag.moved = false;
        setAxisBasis();
        plane.setFromNormalAndCoplanarPoint(drag.axis, drag.pivot);
        const point = raycaster.ray.intersectPlane(plane, hitPoint);
        drag.lastAngle = point ? signedAngle(point) : 0;
        paintMeshes(gizmoRings, name, true);
        return;
      }
      if (name === "facing-ring" || name === "facing-knob") {
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const point = raycaster.ray.intersectPlane(ground, hitPoint)?.clone();
        if (!point) return;
        drag.kind = "facing";
        drag.facing = facingRef.current;
        drag.start.copy(point);
        drag.moved = false;
        return;
      }
      const id = name as BodyId;
      const previous = selectionRef.current;
      const next = event.shiftKey
        ? previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
        : previous.includes(id) ? [...previous.filter((item) => item !== id), id] : [id];
      onSelectRef.current(next);
      if (toolRef.current === "rotate") return;
      const current = onPlane(hit.point);
      if (!current) return;
      drag.kind = "joint";
      drag.pose = structuredClone(poseRef.current);
      drag.joints = next;
      drag.anchor = id;
      drag.facing = facingRef.current;
      drag.start.copy(current);
      drag.anchorPoint.copy(hit.point);
      drag.moved = false;
    };
    const paintMeshes = (items: THREE.Mesh[], activeName: string | null, dimRest: boolean) => {
      for (const item of items) {
        const material = item.material as THREE.MeshBasicMaterial;
        const on = activeName !== null && item.name === activeName;
        material.color.set(on ? 0xfff4c2 : (item.userData.base as number));
        material.opacity = dimRest ? (on ? 1 : 0.28) : 0.95;
      }
    };
    const slideAlong = () => {
      camera.getWorldDirection(viewDirection);
      if (Math.abs(drag.axis.dot(viewDirection)) > 0.72) {
        const distance = Math.max(camera.position.distanceTo(drag.pivot), 0.01);
        const worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
        const sign = drag.axis.dot(viewDirection) < 0 ? 1 : -1;
        return (pointer.y - drag.pointerY) * worldHeight * sign;
      }
      offset.copy(viewDirection).addScaledVector(drag.axis, -viewDirection.dot(drag.axis));
      if (offset.lengthSq() < 1e-8) offset.copy(viewDirection);
      plane.setFromNormalAndCoplanarPoint(offset.normalize(), drag.pivot);
      const point = raycaster.ray.intersectPlane(plane, hitPoint);
      if (!point) return drag.startSlide;
      return point.clone().sub(drag.pivot).dot(drag.axis);
    };
    const onMove = (event: PointerEvent) => {
      pointerAt(event);
      if (!drag.kind) {
        if (gizmo.visible) {
          const hit = raycaster.intersectObjects(gizmoRings, false)[0];
          paintMeshes(gizmoRings, hit?.object.name ?? null, false);
        }
        if (moveGizmo.visible) {
          const hit = raycaster.intersectObjects(moveHandles, false)[0];
          paintMeshes(moveHandles, hit?.object.name ?? null, false);
        }
        return;
      }
      if (drag.kind === "slide") {
        if (!drag.pose || !drag.anchor) return;
        const slide = slideAlong() - drag.startSlide;
        if (Math.abs(slide) < 1e-4) return;
        if (!drag.moved) onEditStartRef.current();
        drag.moved = true;
        const origin = drag.pose[drag.anchor];
        const step = slide / Math.max(scale, 1e-6);
        onPoseRef.current(moveSelection(drag.pose, drag.joints, {
          x: origin.x + drag.axis.x * step,
          y: origin.y - drag.axis.y * step,
          z: (origin.z ?? 0) + drag.axis.z * step,
        }));
        return;
      }
      if (drag.kind === "axis") {
        plane.setFromNormalAndCoplanarPoint(drag.axis, drag.pivot);
        const point = raycaster.ray.intersectPlane(plane, hitPoint);
        if (!point || !drag.pose) return;
        const angle = signedAngle(point);
        let step = angle - drag.lastAngle;
        while (step > Math.PI) step -= Math.PI * 2;
        while (step < -Math.PI) step += Math.PI * 2;
        if (Math.abs(step) < 1e-4) return;
        if (!drag.moved) onEditStartRef.current();
        drag.moved = true;
        drag.total += step;
        drag.lastAngle = angle;
        onPoseRef.current(rotateSelectionAxis(drag.pose, drag.joints, drag.axis, drag.total));
        return;
      }
      if (drag.kind === "facing") {
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const point = raycaster.ray.intersectPlane(ground, hitPoint);
        if (!point) return;
        const center = ring.position;
        const start = Math.atan2(drag.start.x - center.x, drag.start.z - center.z);
        const now = Math.atan2(point.x - center.x, point.z - center.z);
        let delta = now - start;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) < 0.01) return;
        if (!drag.moved) onEditStartRef.current();
        drag.moved = true;
        onFacingRef.current(drag.facing + delta * 180 / Math.PI);
        return;
      }
      if (!drag.pose || !drag.anchor) return;
      const current = onPlane(drag.anchorPoint);
      if (!current) return;
      const delta = current.clone().sub(drag.start);
      if (delta.lengthSq() < 1e-6) return;
      if (!drag.moved) onEditStartRef.current();
      drag.moved = true;
      const local = localDelta(delta, drag.facing);
      const origin = drag.pose[drag.anchor];
      const target = {
        x: origin.x + local.x / scale,
        y: origin.y - local.y / scale,
        z: (origin.z ?? 0) + local.z / scale,
      };
      const next = moveSelection(drag.pose, drag.joints, target);
      onPoseRef.current(next);
    };
    const onUp = () => {
      drag.kind = "";
      drag.pose = null;
      controls.enabled = true;
      paintMeshes(gizmoRings, null, false);
      paintMeshes(moveHandles, null, false);
    };
    renderer.domElement.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    const loaded = loadHumanParts()
      .then((parts) => {
        if (stopped) return;
        const geometry = humanGeometry(parts);
        const skin = { color: 0xc6866a, roughness: 0.62, metalness: 0.02 };
        const material = new THREE.MeshStandardMaterial({ ...skin, transparent: true, opacity: 0.42, depthWrite: false });
        const solidHand = new THREE.MeshStandardMaterial({ ...skin, transparent: true, opacity: 1, depthWrite: true });
        bodyMaterial = material;
        handMaterial = solidHand;
        const mesh = new THREE.Mesh(geometry, [material, solidHand]);
        scene.add(mesh);
        const rest = new Float32Array(geometry.getAttribute("position").array);
        const skinner = createSkinner(parts.rig, rest);
        scale = skinner.scale;
        const positions = geometry.getAttribute("position").array as Float32Array;
        const apply = (next: Pose, nextFacing = facingRef.current) => {
          skinner.apply(next, positions, nextFacing);
          geometry.getAttribute("position").needsUpdate = true;
          geometry.computeVertexNormals();
          paintHandles(skinner.markers);
        };
        applyRef.current = apply;
        apply(poseRef.current, facingRef.current);
        const frameFilm = () => {
          geometry.computeBoundingSphere();
          const sphere = geometry.boundingSphere;
          const radius = sphere?.radius ?? 8;
          const center = sphere?.center ?? new THREE.Vector3(0, radius, 0);
          placeSideCamera(camera, center, radius, ACTOR_ROOM);
          controls.target.copy(center);
          controls.update();
          watching = true;
        };
        resetRef.current = frameFilm;
        frameFilm();
        apply(poseRef.current, facingRef.current);
        setStatus("");
      })
      .catch((caught: unknown) => {
        if (!stopped) setStatus(caught instanceof Error ? caught.message : "몸을 불러오지 못했습니다.");
      });

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      void loaded;
    };
  }, []);

  return (
    <div className="human-mesh">
      <div className="human-mesh-view" ref={mountRef} />
      {status && <p className="meta">{status}</p>}
      {!status && (
        <>
          <div className="human-bar">
            <button type="button" className={atFilm ? "human-reset" : "human-reset away"} onClick={() => resetRef.current?.()}>영상 각도</button>
            <FacingField facing={facing} disabled={disabled} onEditStart={() => onEditStartRef.current()} onFacing={(next) => onFacingRef.current(next)} />
          </div>
        </>
      )}
    </div>
  );
});
