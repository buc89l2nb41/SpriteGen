import { useEffect, useRef, useState } from "react";
import { ACTOR_FRAMES, ACTOR_SECONDS } from "./clips";
import { HumanMesh, type HumanMeshHandle } from "./HumanMesh";
import {
  editFacing,
  editFrame,
  facingAt,
  frameFacing,
  frameLabel,
  jointLabel,
  moveSelection,
  rotateSelectionAxis,
  loadMotion,
  poseAt,
  resizeTimeline,
  saveMotion,
  subscribeMotions,
  swapLimbs,
  takeCarry,
  unlockFrame,
  type BodyId,
  type Frame,
  type Pose,
} from "./pose";
import { drawTurnedBones } from "./poseDraw";
import { MomentDraft, PoseMoments } from "./PoseMoments";
import { motionMoments, poseFromCoords, poseFromFeedback, promptReadsMotion, timelineFromMomentPoses, timelineFromPrompt } from "./posePrompt";

function toolName(tool: "move" | "rotate") {
  return tool === "rotate" ? "회전" : "이동";
}

function chosenLabel(ids: BodyId[]) {
  if (!ids.length) return "없음";
  const name = jointLabel[ids[ids.length - 1]];
  return ids.length === 1 ? name : `${name} 외 ${ids.length - 1}`;
}

function nudgePose(pose: Pose, joints: BodyId[], tool: "move" | "rotate", key: string, shift: boolean) {
  const anchor = joints[joints.length - 1];
  if (!anchor) return null;
  if (tool === "rotate") {
    const turn = { ArrowLeft: ["y", -1], ArrowRight: ["y", 1], ArrowUp: ["x", -1], ArrowDown: ["x", 1] }[key] as ["x" | "y", number] | undefined;
    if (!turn) return null;
    const amount = turn[1] * (shift ? 0.18 : 0.08);
    const axis = turn[0] === "x" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    return rotateSelectionAxis(pose, joints, axis, amount);
  }
  const step = shift ? 0.02 : 0.008;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
  if (!delta) return null;
  const point = pose[anchor];
  return moveSelection(pose, joints, { x: point.x + delta[0], y: point.y + delta[1], z: point.z });
}

export function BodyEditor(props: {
  motion: string;
  motionLabel: string;
  busy: boolean;
  onMake: (frames: Frame[]) => void;
}) {
  const session = useState(() => loadMotion(props.motion))[0];
  const [frames, setFrames] = useState<Frame[]>(session.frames);
  const [current, setCurrent] = useState(0);
  const [selection, setSelection] = useState<BodyId[]>(["rWrist"]);
  const [tool, setTool] = useState<"move" | "rotate">("move");
  const [canUndo, setCanUndo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [poseText, setPoseText] = useState("");
  const [poseNote, setPoseNote] = useState("");
  const [moments, setMoments] = useState<MomentDraft[]>([]);
  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  const [reviewPose, setReviewPose] = useState<Pose | null>(null);
  const [editingMoment, setEditingMoment] = useState<number | null>(null);
  const editingRef = useRef<number | null>(null);
  const poseTextRef = useRef(poseText);
  poseTextRef.current = poseText;
  const humanRef = useRef<HumanMeshHandle>(null);
  const undoRef = useRef<({ kind: "frames"; frames: Frame[] } | { kind: "moment"; index: number; pose: Pose })[]>([]);
  const selectionRef = useRef(selection);
  const toolRef = useRef(tool);
  const currentRef = useRef(current);
  selectionRef.current = selection;
  toolRef.current = tool;
  currentRef.current = current;
  const framesRef = useRef(frames);
  const motionRef = useRef(props.motion);
  const savedJson = useRef("");
  framesRef.current = frames;
  const frame = frames[current] ?? frames[0];
  const editingPose = editingMoment === null ? null : moments[editingMoment]?.pose ?? null;
  function setEditing(index: number | null) {
    editingRef.current = index;
    setEditingMoment(index);
  }

  function scrollStageTo(selector: string) {
    const target = document.querySelector(selector);
    if (!(target instanceof HTMLElement)) return;
    let node: HTMLElement | null = target.parentElement;
    while (node) {
      if (node.scrollHeight > node.clientHeight + 20) {
        const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
        node.scrollTop = Math.max(0, top - 8);
        return;
      }
      node = node.parentElement;
    }
  }

  useEffect(() => {
    const json = JSON.stringify(frames);
    if (json === savedJson.current) return;
    const timer = window.setTimeout(() => {
      savedJson.current = json;
      saveMotion(motionRef.current, framesRef.current);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [frames]);

  useEffect(() => subscribeMotions(() => {
    const next = loadMotion(motionRef.current);
    const json = JSON.stringify(next.frames);
    if (json === savedJson.current) return;
    savedJson.current = json;
    setFrames(next.frames);
  }), []);

  useEffect(() => {
    if (props.motion === motionRef.current) return;
    if (takeCarry(props.motion)) {
      motionRef.current = props.motion;
      savedJson.current = JSON.stringify(framesRef.current);
      saveMotion(props.motion, framesRef.current);
      return;
    }
    saveMotion(motionRef.current, framesRef.current);
    motionRef.current = props.motion;
    const next = loadMotion(props.motion);
    savedJson.current = JSON.stringify(next.frames);
    setFrames(next.frames);
    setCurrent(0);
    setPlaying(false);
    undoRef.current = [];
    setCanUndo(false);
  }, [props.motion]);

  useEffect(() => {
    let timer = 0;
    const show = (pose: Pose, facing: number) => {
      humanRef.current?.setPose(pose, facing);
    };
    if (!playing || !frame) {
      const pose = editingPose ?? reviewPose ?? frame?.pose;
      if (pose) show(pose, editingPose || reviewPose ? frameFacing(frame) : frameFacing(frame));
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const loop = ((now - started) / 1000) % (ACTOR_FRAMES / 12);
      const t = loop / (ACTOR_FRAMES / 12);
      show(poseAt(framesRef.current, t), facingAt(framesRef.current, t));
      timer = window.requestAnimationFrame(tick);
    };
    timer = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(timer);
  }, [frame, playing, reviewPose, editingPose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoEdit();
        return;
      }
      if (playing) return;
      const joints = selectionRef.current;
      const pose = currentPose();
      if (!joints.length || !pose) return;
      const nudged = nudgePose(pose, joints, toolRef.current, event.key, event.shiftKey);
      if (!nudged) return;
      event.preventDefault();
      rememberUndo();
      const editing = editingRef.current;
      commitPose(nudged, Math.min(currentRef.current, framesRef.current.length - 1), editing);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  function currentPose() {
    const editing = editingRef.current;
    if (editing !== null) return momentsRef.current[editing]?.pose ?? null;
    return framesRef.current[Math.min(currentRef.current, framesRef.current.length - 1)]?.pose ?? null;
  }

  function rememberUndo() {
    const editing = editingRef.current;
    if (editing !== null) {
      const pose = momentsRef.current[editing]?.pose;
      if (!pose) return;
      undoRef.current.push({ kind: "moment", index: editing, pose: structuredClone(pose) });
    } else {
      undoRef.current.push({ kind: "frames", frames: structuredClone(framesRef.current) });
    }
    if (undoRef.current.length > 50) undoRef.current.shift();
    setCanUndo(true);
  }

  function commitPose(pose: Pose, index: number, moment: number | null) {
    if (moment !== null) {
      setMoments((existing) => existing.map((item, itemIndex) => (
        itemIndex === moment && item.pose ? { ...item, accepted: false, pose } : item
      )));
      return;
    }
    setFrames((existing) => editFrame(existing, index, pose));
  }

  function setMiddleKey(key: boolean) {
    if (editingRef.current !== null) return;
    const index = currentRef.current;
    const existing = framesRef.current;
    if (index <= 0 || index >= existing.length - 1) return;
    if (Boolean(existing[index].key) === key) return;
    setPlaying(false);
    rememberUndo();
    setFrames(key ? editFrame(existing, index, existing[index].pose) : unlockFrame(existing, index));
  }

  function undoEdit() {
    const step = undoRef.current.pop();
    setCanUndo(undoRef.current.length > 0);
    if (!step) return;
    if (step.kind === "frames") setFrames(step.frames);
    else {
      setMoments((existing) => existing.map((item, index) => (
        index === step.index && item.pose ? { ...item, accepted: false, pose: step.pose } : item
      )));
    }
  }

  function patchMoment(index: number, patch: Partial<MomentDraft>) {
    setMoments((existing) => existing.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function applyPoseText() {
    const framePose = framesRef.current[current]?.pose;
    const text = poseTextRef.current;
    if (!framePose || !text.trim()) return;
    setPlaying(false);
    if (promptReadsMotion(text)) {
      try {
        const labels = motionMoments(text);
        setReviewPose(null);
        setMoments(labels.map((label) => ({
          label,
          pose: null,
          previous: null,
          feedback: "",
          adjust: "",
          accepted: false,
          error: "",
          busy: false,
        })));
        setPoseNote("각 순간에서 OpenPose 만들기를 누르면 AI가 관절 좌표를 적고, 이 몸 길이에 맞춰 올립니다.");
      } catch (caught) {
        setPoseNote(caught instanceof Error ? caught.message : "동작을 나누지 못했습니다.");
      }
      return;
    }
    try {
      const result = timelineFromPrompt(framesRef.current, text);
      setFrames(result.frames);
      if (result.focus !== null) setCurrent(result.focus);
      setPoseNote(result.note);
    } catch (caught) {
      setPoseNote(caught instanceof Error ? caught.message : "자세를 고치지 못했습니다.");
    }
  }

  async function makeMomentPose(index: number) {
    const moment = momentsRef.current[index];
    if (!moment || moment.busy) return;
    if (editingRef.current === index) setEditing(null);
    patchMoment(index, { busy: true, error: "" });
    try {
      const response = await fetch("/api/pose-coords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moment: moment.label }),
      });
      const data = await response.json() as { joints?: unknown; error?: string };
      if (!response.ok || !data.joints) throw new Error(data.error || "관절 좌표를 받지 못했습니다.");
      const read = poseFromCoords(data.joints, /떠|점프/.test(moment.label));
      setPlaying(false);
      setReviewPose(read.pose);
      patchMoment(index, { pose: read.pose, previous: moment.pose, adjust: read.adjust, accepted: false, busy: false, error: "" });
      setPoseNote("이 OpenPose를 몸에 올렸습니다. 아래 3D 몸이 적용 결과입니다. 칸에 넣으려면 고른 자세로 칸 채우기를 누르세요.");
      window.requestAnimationFrame(() => scrollStageTo(".human-mesh"));
    } catch (caught) {
      patchMoment(index, { busy: false, error: caught instanceof Error ? caught.message : "관절 좌표를 받지 못했습니다." });
    }
  }

  async function sendFeedback(index: number) {
    const moment = momentsRef.current[index];
    const text = moment?.feedback.trim() ?? "";
    if (!moment?.pose || moment.busy || !text) return;
    const current = moment.pose;
    if (editingRef.current === index) setEditing(null);
    patchMoment(index, { busy: true, error: "" });
    try {
      const response = await fetch("/api/pose-coords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moment: moment.label, feedback: text, joints: current }),
      });
      const data = await response.json() as { joints?: unknown; error?: string };
      if (!response.ok || !data.joints) throw new Error(data.error || "고친 관절 좌표를 받지 못했습니다.");
      const read = poseFromFeedback(data.joints, current);
      setPlaying(false);
      setReviewPose(read.pose);
      patchMoment(index, { pose: read.pose, previous: current, feedback: "", adjust: read.adjust, accepted: false, busy: false, error: "" });
      setPoseNote(`"${text}" 피드백을 반영해 몸에 올렸습니다. 마음에 들지 않으면 되돌리기를 누르세요.`);
      window.requestAnimationFrame(() => scrollStageTo(".human-mesh"));
    } catch (caught) {
      patchMoment(index, { busy: false, error: caught instanceof Error ? caught.message : "고친 관절 좌표를 받지 못했습니다." });
    }
  }

  function undoMoment(index: number) {
    const moment = momentsRef.current[index];
    if (!moment?.previous || moment.busy) return;
    if (editingRef.current === index) setEditing(null);
    setReviewPose(moment.previous);
    patchMoment(index, { pose: moment.previous, previous: moment.pose, adjust: "이전 자세로 되돌렸습니다. 한 번 더 누르면 다시 바뀐 자세로 갑니다.", accepted: false });
    setPoseNote("이전 자세로 되돌렸습니다.");
  }

  function previewMoment(index: number) {
    const pose = momentsRef.current[index]?.pose;
    if (!pose) return;
    if (editingRef.current !== null) setEditing(null);
    setPlaying(false);
    setReviewPose(pose);
    window.requestAnimationFrame(() => scrollStageTo(".human-mesh"));
  }

  function acceptMoment(index: number) {
    patchMoment(index, { accepted: true });
    setPoseNote("확정한 자세가 모이면 칸에 넣습니다.");
  }

  function retryMoment(index: number) {
    if (editingRef.current === index) setEditing(null);
    setReviewPose(null);
    patchMoment(index, { pose: null, previous: null, feedback: "", adjust: "", accepted: false, error: "" });
    setPoseNote("이 순간의 OpenPose를 지웠습니다. 다시 만들 수 있습니다.");
  }

  function editPoints(index: number) {
    if (editingRef.current === index) {
      const pose = momentsRef.current[index]?.pose;
      setEditing(null);
      setReviewPose(pose ?? null);
      setPoseNote("고친 점 위치를 이 순간에 남겨 두었습니다. 칸에 넣으려면 고른 자세로 칸 채우기를 누르세요.");
      return;
    }
    const moment = momentsRef.current[index];
    if (!moment?.pose) return;
    setPlaying(false);
    setReviewPose(null);
    setEditing(index);
    setPoseNote(`${moment.label}의 점을 이동과 회전으로 고칩니다.`);
    window.requestAnimationFrame(() => scrollStageTo(".human-mesh"));
  }

  function applyMoments() {
    const cards = momentsRef.current;
    const poses = cards.map((moment) => moment.pose).filter((pose): pose is Pose => Boolean(pose));
    if (cards.length === 0 || poses.length !== cards.length || cards.some((moment) => moment.busy)) {
      setPoseNote("각 순간에 OpenPose가 있어야 칸을 채울 수 있습니다.");
      return;
    }
    const result = timelineFromMomentPoses(framesRef.current, poses);
    setEditing(null);
    setReviewPose(null);
    setFrames(result.frames);
    if (result.focus !== null) setCurrent(result.focus);
    setPoseNote(result.note);
    window.requestAnimationFrame(() => {
      document.querySelector(".human-mesh")?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }

  return (
    <div className="body-editor">
      <div className="body-editor-head">
        <p className="meta">관절</p>
        <p className="plain">{`이동을 누르면 고른 관절에 축 화살표가 나옵니다. 빨간 화살표는 가로, 초록 화살표는 위, 파란 화살표는 앞뒤이고, 화살표를 끌면 그 축으로만 점이 움직입니다. 점을 직접 끌면 보는 면을 따라 움직입니다. 회전을 누르면 축 고리가 나오고, 고리를 끌면 그 축으로만 아래 관절이 돕니다. 발밑 원을 끌거나 영상 각도 옆의 방향에 각도를 적으면 그 칸의 몸이 돕니다. 옆모습이 0도, 후면이 90도이고, 가운데 보간 칸은 그 각도를 잇습니다. 빈 곳을 끌면 보는 각도가 바뀌고, 영상 각도로 옆을 되돌립니다. 영상 만들기는 그 몸을 옆 카메라로 ${ACTOR_SECONDS}초 찍습니다.`}</p>
      </div>
      <div className="pose-prompt">
        <label>
          <span>자세 프롬프트</span>
          <span className="pose-prompt-row">
            <textarea
              className="short"
              value={poseText}
              placeholder="승룡권 쓰는 모션"
              onChange={(event) => setPoseText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  applyPoseText();
                }
              }}
            />
            <button type="button" className="primary" onClick={applyPoseText}>전송</button>
          </span>
        </label>
      </div>
      {poseNote && <p className="plain">{poseNote}</p>}
      {moments.length > 0 && (
        <PoseMoments
          moments={moments}
          onMake={(index) => void makeMomentPose(index)}
          onPreview={previewMoment}
          onAccept={acceptMoment}
          onRetry={retryMoment}
          onEditPoints={editPoints}
          onFeedbackText={(index, text) => patchMoment(index, { feedback: text })}
          onFeedback={(index) => void sendFeedback(index)}
          onUndo={undoMoment}
          editingIndex={editingMoment}
          onApply={applyMoments}
          onCancel={() => {
            setEditing(null);
            setMoments([]);
            setReviewPose(null);
          }}
        />
      )}
      <p className="meta">
        {editingMoment !== null
          ? "점을 끌어 이 순간의 관절만 고칩니다. 위의 그림은 바뀌지 않습니다."
          : "점은 몸보다 앞에 크게 보입니다. 몸 안쪽 관절도 끌 수 있습니다. 손은 불투명하고 손가락은 색 막대로 이어집니다. 마디는 작은 점이고, 다른 관절보다 앞에 그려집니다. 마디를 끌면 그 아래가 같이 접힙니다. 점 색으로 관절을 구분합니다. 어깨, 팔꿈치, 손목, 골반, 무릎, 발목이 서로 다르고, 엄지, 검지, 중지, 약지, 소지도 서로 다릅니다. 같은 손가락은 양쪽이 같은 색입니다. 고른 점은 흰색입니다. 이동의 빨간 화살표는 가로, 초록 화살표는 위, 파란 화살표는 앞뒤입니다. 회전의 빨간 고리는 가로, 초록 고리는 위, 파란 고리는 앞뒤, 흰 고리는 보는 방향입니다. 발밑 원을 끌면 몸이 돌고, 보간 칸은 그 각도를 잇습니다. Shift로 여러 점을 고릅니다."}
      </p>
      <div className="actions">
        <button type="button" className={tool === "move" ? "active" : ""} onClick={() => setTool("move")}>이동</button>
        <button type="button" className={tool === "rotate" ? "active" : ""} onClick={() => setTool("rotate")}>회전</button>
        <button type="button" disabled={!canUndo || playing} onClick={undoEdit}>실행 취소</button>
      </div>
      <div className="pose-views">
        <HumanMesh
          ref={humanRef}
          pose={editingPose ?? reviewPose ?? frame.pose}
          facing={frameFacing(frame)}
          tool={tool}
          selection={selection}
          disabled={playing}
          onSelect={setSelection}
          onEditStart={rememberUndo}
          onPose={(pose) => commitPose(pose, current, editingRef.current)}
          onFacing={(facing) => {
            if (editingRef.current !== null) return;
            setFrames((existing) => editFacing(existing, currentRef.current, facing));
          }}
        />
      </div>
      <div className="pose-frames">
        {frames.map((item, index) => (
          <button
            key={index}
            type="button"
            className={index === current && !playing ? "active" : ""}
            onClick={() => {
              setPlaying(false);
              if (editingRef.current !== null) {
                setEditing(null);
                setReviewPose(null);
              }
              setCurrent(index);
            }}
          >
            <PoseThumb pose={item.pose} facing={frameFacing(item)} />
            <span>{frameLabel(index, frames.length, item.key)}{Math.abs(frameFacing(item)) > 0.5 ? ` ${Math.round(frameFacing(item))}°` : ""}</span>
          </button>
        ))}
      </div>
      <p className="plain">
        {editingMoment !== null && moments[editingMoment]
          ? `점 위치 고치는 중 · ${moments[editingMoment].label} · ${toolName(tool)} · 선택 ${chosenLabel(selection)}`
          : `${toolName(tool)} · 선택 ${chosenLabel(selection)} · ${frame ? frameLabel(current, frames.length, frame.key) : ""} · Shift로 점을 더 고릅니다`}
      </p>
      <div className="actions">
        <button type="button" className={playing ? "active" : ""} onClick={() => {
          if (!playing && editingRef.current !== null) setEditing(null);
          setPlaying((value) => !value);
        }}>
          {playing ? "편집으로" : "재생"}
        </button>
        <button type="button" disabled={props.busy} onClick={() => props.onMake(framesRef.current)}>
          {props.busy ? "저장 중" : `${props.motionLabel} 영상 만들기`}
        </button>
      </div>
      <label>
        <span>프레임 {frames.length}</span>
        <input
          type="range"
          min={2}
          max={8}
          value={frames.length}
          onChange={(event) => {
            const count = Number(event.target.value);
            setFrames((existing) => resizeTimeline(existing, count));
            setCurrent((index) => Math.min(index, count - 1));
          }}
        />
      </label>
      <div className="actions">
        <button type="button" onClick={() => setFrames((existing) => editFrame(existing, current, swapLimbs(existing[current].pose)))}>팔다리 바꾸기</button>
        {current > 0 && current < frames.length - 1 && (
          <span className="frame-key">
            <button type="button" className={frame.key ? "" : "active"} onClick={() => setMiddleKey(false)}>보간</button>
            <button type="button" className={frame.key ? "active" : ""} onClick={() => setMiddleKey(true)}>수정</button>
          </span>
        )}
      </div>
    </div>
  );
}

function PoseThumb({ pose, facing }: { pose: Pose; facing: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawTurnedBones(ctx, pose, facing, canvas.width, canvas.height);
  }, [pose, facing]);
  return <canvas ref={ref} width={96} height={128} />;
}
