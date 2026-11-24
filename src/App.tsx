import { useEffect, useRef, useState, type DragEvent } from "react";
import { BodyEditor } from "./BodyEditor";
import { actorShotPngs } from "./actorShot";
import { actorPoses } from "./clips";
import {
  KLING_PRICES,
  methodById,
  methods,
  motionLabel,
  motionPrice,
  MOTION_MAX_SECONDS,
  MOTION_MIN_SECONDS,
  type KlingQuality,
  type MethodId,
} from "./methods";
import { adoptMotion, motionTurns, subscribeMotions, type Frame } from "./pose";
import { characterPrompt } from "./characterPrompt";
import { motionPrompt } from "./motionPrompt";

type Result = {
  source: string;
  raw: string;
  frames: string[];
  sheet: string;
  score: number;
  notes: string[];
  log: string;
  motion?: string;
  video?: string;
  folder?: string;
  cellWidth?: number;
  cellHeight?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  number?: number;
  at?: number;
  prompt?: string;
};

type HistoryItem = {
  number: number;
  at: number;
  folder: string;
  source: string;
  motion: string;
  frames: string[];
  sheet: string;
  video: string;
  prompt: string;
  sourceWidth?: number;
  sourceHeight?: number;
  cellWidth?: number;
  cellHeight?: number;
};

type Screen = "character" | MethodId;

const menu: { id: Screen; label: string; hint: string }[][] = [
  [{ id: "character", label: "캐릭터", hint: "기준 그림" }],
  methods.map((item) => ({ id: item.id, label: item.label, hint: item.hint })),
];

const sourceLabels: Record<string, string> = {
  kling: "문장참고",
  pose: "포즈참고",
  puppet: "영상참고",
  "puppet-video": "영상참고",
  "video-finish": "최근 영상",
  "still-finish": "자세 그림",
  cursor: "Cursor 스트립",
  sample: "샘플",
  "fal-pose": "FLUX 자세",
  luma: "Luma Ray 3.2",
  hailuo: "Hailuo-02",
  wan: "Wan 2.2 pose",
  h3: "H3 프리비즈",
  video: "영상",
};

function formatWhen(at: number) {
  const date = new Date(at);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${hour}:${minute}`;
}

function promptName(prompt = "") {
  const match = prompt.match(/^Name:\s*(.+?)\.?\s*$/m);
  return match?.[1]?.trim() ?? "";
}

function downloadStem(result: { prompt?: string; motion?: string }) {
  const name = promptName(result.prompt) || motionTitle(result.motion) || "sprite";
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "sprite";
}

function motionTitle(motion = "") {
  if (!motion || motion === "current" || motion === "draft" || motion === "sprite" || motion.startsWith("set-")) return "";
  return motionLabel(motion);
}

function resultStamp(result: { source: string; motion?: string; prompt?: string; number?: number; at?: number }) {
  const methodName = sourceLabels[result.source] ?? result.source;
  const label = promptName(result.prompt) || motionTitle(result.motion);
  const name = label ? `${methodName} · ${label}` : methodName;
  return [result.number ? `#${result.number}` : "", result.at ? formatWhen(result.at) : "", name].filter(Boolean).join(" · ");
}

function methodScreen(source: string): MethodId | null {
  if (source === "kling" || source === "pose" || source === "puppet") return source;
  if (source === "puppet-video") return "puppet";
  return null;
}

const quietBusy = new Set(["take", "body", "matte", "matte-choice", "use", "stills", "redraw", "clip"]);
const workMotion = "current";

type PuppetShot = { image: string; label: string; feedback: string; usePrev: boolean; useNext: boolean };

function readFile(file: File, what: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${what}을 읽지 못했습니다.`));
    reader.readAsDataURL(file);
  });
}

function puppetLabel(index: number, count: number) {
  if (index === 0) return "1 · 시작";
  if (index === count - 1) return `${count} · 끝`;
  return String(index + 1);
}

function fitPuppetShots(existing: PuppetShot[], count: number): PuppetShot[] {
  const safe = Math.max(2, Math.min(8, Math.round(count)));
  const next = existing.slice(0, safe).map((shot, index) => ({
    image: shot.image ?? "",
    label: puppetLabel(index, safe),
    feedback: shot.feedback ?? "",
    usePrev: Boolean(shot.usePrev) && index > 0,
    useNext: Boolean(shot.useNext) && index < safe - 1,
  }));
  while (next.length < safe) {
    const index = next.length;
    next.push({ image: "", label: puppetLabel(index, safe), feedback: "", usePrev: false, useNext: false });
  }
  return next;
}

function readStill(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("이미지를 읽지 못했습니다."));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

function SelectedCharacter(props: { image: string | null; onDrop: (file: File) => void }) {
  function takeDrop(event: DragEvent) {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.name));
    if (file) props.onDrop(file);
  }
  return (
    <>
      <h2 className="result-name">기준 그림</h2>
      {props.image ? (
        <>
          <p className="plain">SpriteGen/.gen/character.png</p>
          <div className="player" onDragOver={(event) => event.preventDefault()} onDrop={takeDrop}>
            <img src={props.image} alt="기준 캐릭터" />
          </div>
        </>
      ) : (
        <div className="player" onDragOver={(event) => event.preventDefault()} onDrop={takeDrop}>
          <p className="meta">아직 고른 그림이 없습니다. 파일을 올리거나 이 칸에 놓으세요.</p>
        </div>
      )}
    </>
  );
}

function ChosenCharacter(props: { image: string }) {
  return (
    <div className="chosen-character">
      <p className="meta">기준 캐릭터</p>
      <img className="character-preview" src={props.image} alt="기준 캐릭터" />
    </div>
  );
}

function usable(seconds: number) {
  return seconds >= MOTION_MIN_SECONDS && seconds <= MOTION_MAX_SECONDS;
}

function MatteChoices(props: {
  offer: { compare: string; aHow: string; bHow: string; cHow: string; dHow: string; hasB: boolean };
  busy: string;
  onChoose: (pick: "a" | "b" | "c" | "d") => void;
}) {
  const saving = props.busy === "matte-choice";
  return (
    <div className="matte-offer">
      <img src={props.offer.compare} alt="A, B, C와 배경을 그대로 둔 D를 나란히 비교" />
      <p className="meta">A {props.offer.aHow}</p>
      <p className="meta">B {props.offer.bHow}</p>
      <p className="meta">C {props.offer.cHow}</p>
      <p className="meta">D {props.offer.dHow}</p>
      <div className="actions">
        <button type="button" disabled={Boolean(props.busy)} onClick={() => props.onChoose("a")}>
          {saving ? "저장 중" : "A 사용"}
        </button>
        <button type="button" disabled={Boolean(props.busy) || !props.offer.hasB} onClick={() => props.onChoose("b")}>
          {saving ? "저장 중" : "B 사용"}
        </button>
        <button type="button" disabled={Boolean(props.busy)} onClick={() => props.onChoose("c")}>
          {saving ? "저장 중" : "C 사용"}
        </button>
        <button type="button" disabled={Boolean(props.busy)} onClick={() => props.onChoose("d")}>
          {saving ? "저장 중" : "D 사용"}
        </button>
      </div>
    </div>
  );
}

function FinalPrompt(props: { value: string; edited: boolean; onChange: (value: string) => void; onReset: () => void; note?: string }) {
  return (
    <div className="final-prompt">
      <label>
        <span>보낼 문장</span>
        <textarea
          className="final-prompt-text"
          value={props.value}
          maxLength={4000}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </label>
      <p className="plain">{props.note ?? "이 문장이 한 편 뽑기에서 fal.ai로 전송됩니다."}</p>
      {props.edited && (
        <div className="actions">
          <button type="button" onClick={props.onReset}>기본 문장으로</button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [description, setDescription] = useState(() => localStorage.getItem("pp-description") ?? "");
  const [poseTick, setPoseTick] = useState(0);
  const [action, setAction] = useState(() => localStorage.getItem("pp-action") ?? "");
  const [style, setStyle] = useState("pixel art");
  const [quality, setQuality] = useState<KlingQuality>(() => (localStorage.getItem("pp-kling-quality") === "pro" ? "pro" : "standard"));
  const [drawText, setDrawText] = useState("");
  const [drawPromptEdit, setDrawPromptEdit] = useState<string | null>(null);
  const [drawn, setDrawn] = useState("");
  const [model, setModel] = useState(() => localStorage.getItem("pp-model") || "auto");
  const [models, setModels] = useState<{ id: string; label: string }[]>([{ id: "auto", label: "계정 기본" }]);
  const [status, setStatus] = useState({
    key: false,
    agent: false,
    character: false,
    fal: false,
    take: false,
    takeSeconds: 0,
    takeTrimmed: false,
    takeExtendedFrom: 0,
    bodySeconds: 0,
    puppetSeconds: 0,
  });
  const [screen, setScreen] = useState<Screen>("character");
  const [promptEdit, setPromptEdit] = useState<string | null>(null);
  const [setName, setSetName] = useState(() => localStorage.getItem("pp-name") ?? "");
  const [loop, setLoop] = useState(() => localStorage.getItem("pp-loop") === "1");
  const [puppetShots, setPuppetShots] = useState<PuppetShot[]>([]);
  const [puppetFrameError, setPuppetFrameError] = useState("");
  const [redrawIndex, setRedrawIndex] = useState<number | null>(null);
  const [puppetFrames, setPuppetFrames] = useState(() => {
    const saved = Number(localStorage.getItem("pp-puppet-frames"));
    return saved >= 2 && saved <= 8 ? saved : 6;
  });
  const stillToken = useRef(0);
  const [showSource, setShowSource] = useState(false);
  const [matteOffer, setMatteOffer] = useState<{ folder: string; compare: string; aHow: string; bHow: string; cHow: string; dHow: string; hasB: boolean } | null>(null);
  const [live, setLive] = useState<{ title: string; phase: string; since: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busySince, setBusySince] = useState(0);
  const [character, setCharacter] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sets, setSets] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useState(0);
  const [clipStamp, setClipStamp] = useState(0);
  const [takeStamp, setTakeStamp] = useState(0);
  const [puppetSource, setPuppetSource] = useState<"stills" | "take">("stills");
  const result = sets[active] ?? null;
  const loadedPrompt = useRef<string | null>(null);
  const seededName = useRef(localStorage.getItem("pp-name") !== null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/status");
      const statusBody = await response.json();
      setStatus(statusBody);
      if (!localStorage.getItem("pp-draft-kept") && !localStorage.getItem("pp-action") && statusBody.savedAction) {
        setAction(statusBody.savedAction);
        localStorage.setItem("pp-action", statusBody.savedAction);
        localStorage.setItem("pp-draft-kept", "1");
        if (statusBody.savedLoop) {
          setLoop(true);
          localStorage.setItem("pp-loop", "1");
        }
      }
      const from = localStorage.getItem("pp-set");
      if (from) adoptMotion(from, workMotion);
    })();
    void loadHistory();
    void fetch("/api/models")
      .then((response) => response.json())
      .then((body: { models?: { id: string; label: string }[] }) => {
        if (body.models?.length) setModels(body.models);
      });
  }, []);

  useEffect(() => subscribeMotions(() => setPoseTick((value) => value + 1)), []);

  const busyRef = useRef("");
  busyRef.current = busy;

  useEffect(() => {
    if (busy) setBusySince((current) => current || Date.now());
    else setBusySince(0);
  }, [busy]);

  useEffect(() => {
    let stop = false;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    async function poll() {
      try {
        const response = await fetch("/api/live");
        const body = await response.json() as { live: { title: string; phase: string; since: number } | null };
        if (stop) return;
        if (body.live) setLive(body.live);
        else if (!busyRef.current) setLive(null);
      } catch {
        // 서버가 잠시 응답하지 않아도 마지막 진행 문구를 유지합니다.
      }
    }
    void poll();
    const poller = window.setInterval(() => void poll(), 1500);
    return () => {
      stop = true;
      window.clearInterval(tick);
      window.clearInterval(poller);
    };
  }, []);

  useEffect(() => {
    if (!result?.frames.length || busy) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % result.frames.length);
    }, 140);
    return () => window.clearInterval(timer);
  }, [result, busy]);

  useEffect(() => {
    setSets((current) => {
      let changed = false;
      const next = current.map((item) => {
        if (!item.folder) return item;
        const found = history.find((entry) => entry.folder === item.folder);
        if (!found || (item.number === found.number && item.at === found.at && item.prompt === found.prompt)) return item;
        changed = true;
        return { ...item, number: found.number, at: found.at, prompt: found.prompt };
      });
      return changed ? next : current;
    });
  }, [history]);

  useEffect(() => {
    if (seededName.current || !history.length) return;
    const named = history.map((item) => promptName(item.prompt)).find(Boolean);
    if (!named) return;
    seededName.current = true;
    setSetName(named);
    localStorage.setItem("pp-name", named);
  }, [history]);

  useEffect(() => {
    if (loadedPrompt.current !== null) {
      setPromptEdit(loadedPrompt.current);
      loadedPrompt.current = null;
      return;
    }
    setPromptEdit(null);
  }, [screen]);

  const puppetMotion = useRef(workMotion);
  useEffect(() => {
    stillToken.current += 1;
    const switched = puppetMotion.current !== workMotion;
    puppetMotion.current = workMotion;
    setPuppetFrameError("");
    setRedrawIndex(null);
    setPuppetShots((existing) => fitPuppetShots(switched ? [] : existing, puppetFrames));
  }, [puppetFrames]);

  async function refresh() {
    const response = await fetch("/api/status");
    setStatus(await response.json());
  }

  async function loadHistory() {
    const response = await fetch("/api/history");
    const body = await response.json() as { items?: HistoryItem[] };
    setHistory(body.items ?? []);
  }

  async function post<T>(path: string, payload: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "요청이 실패했습니다.");
    return body;
  }

  async function attempt(name: string, fallback: string, work: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy("");
    }
  }

  function openSaved(item: HistoryItem) {
    setShowSource(false);
    setMatteOffer(null);
    setSets([{
      source: item.source,
      raw: "",
      frames: item.frames,
      sheet: item.sheet,
      score: 0,
      notes: [],
      log: "",
      motion: item.motion || undefined,
      video: item.video || undefined,
      folder: item.folder,
      number: item.number,
      at: item.at,
      prompt: item.prompt,
      cellWidth: item.cellWidth,
      cellHeight: item.cellHeight,
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
    }]);
    setActive(0);
    setFrame(0);
    const next = methodScreen(item.source);
    const named = promptName(item.prompt);
    if (named) {
      seededName.current = true;
      setSetName(named);
      localStorage.setItem("pp-name", named);
    }
    if (next === "kling") {
      const looped = /starts and ends in exactly the same pose/.test(item.prompt);
      setLoop(looped);
      localStorage.setItem("pp-loop", looped ? "1" : "0");
      const actionLine = item.prompt.match(/^Action:\s*(.+?)\.?\s*$/m)?.[1]?.trim() ?? "";
      if (actionLine) {
        setAction(actionLine);
        localStorage.setItem("pp-action", actionLine);
      }
    }
    if (item.prompt.trim()) {
      if (next && next !== screen) loadedPrompt.current = item.prompt;
      setPromptEdit(item.prompt);
    }
    if (next) setScreen(next);
    document.querySelector(".stage")?.scrollTo({ top: 0 });
  }

  async function useDrawn() {
    if (!drawn) return;
    await attempt("character", "캐릭터를 저장하지 못했습니다.", async () => {
      const body = await post<{ character: string }>("/api/character", { image: drawn });
      setCharacter(body.character);
      setDrawn("");
      await refresh();
    });
  }

  async function uploadCharacter(file: File | undefined) {
    if (!file) return;
    await attempt("character", "캐릭터를 저장하지 못했습니다.", async () => {
      const body = await post<{ character: string }>("/api/character", { image: await readFile(file, "이미지") });
      setCharacter(body.character);
      await refresh();
    });
  }

  async function drawWithCursor() {
    setDrawn("");
    setLive({ title: "캐릭터 그리기", phase: "Cursor가 캐릭터를 그리고 있습니다", since: Date.now() });
    await attempt("draw", "캐릭터를 그리지 못했습니다.", async () => {
      const body = await post<{ image: string }>("/api/character-draw", { description: drawText, style, model, prompt: drawPrompt });
      setDrawn(body.image);
    });
  }

  function openScreen(next: Screen) {
    setScreen(next);
    setError("");
  }

  const selected = methodById(screen);
  const motionName = setName.replace(/\s+/g, " ").trim();
  const bodySeconds = status.bodySeconds;
  const puppetSeconds = status.puppetSeconds;
  const takeReady = status.take && usable(status.takeSeconds);
  const puppetReady = usable(puppetSeconds);
  const useUploaded = selected?.id !== "pose" && takeReady && (!puppetReady || puppetSource === "take");
  const sourceSeconds = selected?.id === "pose"
    ? (usable(bodySeconds) ? bodySeconds : 0)
    : useUploaded ? status.takeSeconds : puppetReady ? puppetSeconds : 0;
  const priceLine = selected?.id === "kling" ? KLING_PRICES[quality] : motionPrice(sourceSeconds);
  const builtPrompt = selected
    ? motionPrompt(
        description.trim(),
        style.trim() || "pixel art",
        selected.id === "kling" ? loop : false,
        selected.id === "kling" ? action.trim() : "",
        motionName,
        selected.kind === "motion",
        poseTick >= 0 && motionTurns(workMotion),
      )
    : "";
  const sendPrompt = promptEdit ?? builtPrompt;
  const builtDrawPrompt = characterPrompt(drawText.trim(), style.trim() || "pixel art");
  const drawPrompt = drawPromptEdit ?? builtDrawPrompt;
  const methodBlocked = !character || !status.fal || !sendPrompt.trim() || (selected?.kind === "motion" && sourceSeconds === 0);

  function rememberName(value: string) {
    seededName.current = true;
    setSetName(value);
    localStorage.setItem("pp-name", value);
  }

  async function generateMethod() {
    if (!character || !selected) return;
    const videoNote = selected.id !== "puppet" ? "" : useUploaded ? `직접 올린 영상 ${status.takeSeconds.toFixed(1)}초` : `그림으로 만든 영상 ${puppetSeconds.toFixed(1)}초`;
    const agreed = window.confirm(`${selected.title}\n${priceLine}${motionName ? `\n동작: ${motionName}` : ""}${videoNote ? `\n영상: ${videoNote}` : ""}\n\n화면의 보낼 문장을 그대로 보냅니다. 이 버튼은 유료 호출 한 번입니다. 영상이 끝나면 영상 위치 그대로 칸으로 저장합니다.`);
    if (!agreed) return;
    setShowSource(false);
    setLive({ title: motionName ? `${selected.title} · ${motionName}` : selected.title, phase: "요청을 보내는 중입니다", since: Date.now() });
    await attempt("method", "영상 생성에 실패했습니다.", async () => {
      const body = await post<Result>("/api/generate-method", {
        description,
        style,
        motion: workMotion,
        method: selected.id,
        action: selected.id === "kling" ? action : "",
        quality,
        name: motionName,
        loop,
        video: selected.id === "puppet" && useUploaded ? "take" : "puppet",
        prompt: sendPrompt,
      });
      setSets([{ ...body, prompt: sendPrompt }]);
      setActive(0);
      setFrame(0);
    });
    void loadHistory();
  }

  async function makeBodyClip(source: { frames: Frame[] }) {
    await attempt("body", "몸 영상을 저장하지 못했습니다.", async () => {
      const pngs = await actorShotPngs(actorPoses(source.frames));
      await post("/api/local-clip", { motion: workMotion, frames: pngs });
      setClipStamp(Date.now());
      await refresh();
    });
  }

  async function makePuppetStills() {
    const text = action.trim();
    if (!text || text.length > 80) {
      setError("동작 설명은 80자 안으로 적어 주세요.");
      return;
    }
    const count = Math.max(2, Math.min(8, Math.round(puppetFrames)));
    const agreed = window.confirm(`회색 인형 ${count}장\n동작: ${text}\n\n각 장마다 Cursor로 그림을 한 번 그립니다. 이 버튼은 유료 호출 ${count}번입니다.`);
    if (!agreed) return;
    const token = ++stillToken.current;
    const next = fitPuppetShots([], count);
    setPuppetShots(next);
    await attempt("stills", "회색 인형 그림을 만들지 못했습니다.", async () => {
      for (let index = 0; index < count; index += 1) {
        if (token !== stillToken.current) return;
        const body = await post<{ image: string }>("/api/puppet-frame", { action: text, index, count });
        if (token !== stillToken.current) return;
        next[index] = { ...next[index], image: body.image };
        setPuppetShots(next.map((shot) => ({ ...shot })));
      }
    });
  }

  async function putPuppetFiles(files: File[], start: number) {
    const list = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name)).slice(0, puppetFrames - start);
    if (!list.length) {
      setPuppetFrameError("PNG, JPEG, WebP만 넣을 수 있습니다.");
      return;
    }
    try {
      const images: string[] = [];
      for (const file of list) images.push(await readStill(file));
      setPuppetFrameError("");
      setPuppetShots((existing) => {
        const shots = fitPuppetShots(existing, puppetFrames);
        images.forEach((image, offset) => {
          const index = start + offset;
          if (shots[index]) shots[index] = { ...shots[index], image };
        });
        return shots;
      });
    } catch (caught) {
      setPuppetFrameError(caught instanceof Error ? caught.message : "이미지를 읽지 못했습니다.");
    }
  }

  async function redrawPuppetFrame(index: number) {
    const shot = puppetShots[index];
    const text = action.trim();
    const feedback = shot?.feedback?.trim() ?? "";
    if (!shot || !text || text.length > 80) {
      setPuppetFrameError("동작 설명을 80자 안으로 적어 주세요.");
      return;
    }
    if (feedback.length > 200) {
      setPuppetFrameError("피드백은 200자 안으로 적어 주세요.");
      return;
    }
    const usePrev = Boolean(shot.usePrev) && index > 0;
    const useNext = Boolean(shot.useNext) && index < puppetShots.length - 1;
    const refs = [usePrev ? "앞 그림" : "", useNext ? "뒷 그림" : ""].filter(Boolean).join(", ");
    const agreed = window.confirm(`${shot.label}만 다시 그리기\n동작: ${text}${feedback ? `\n고칠 점: ${feedback}` : ""}\n참고: ${refs || "없음"}\n\n이 버튼은 Cursor 유료 호출 한 번입니다.`);
    if (!agreed) return;
    setPuppetFrameError("");
    setRedrawIndex(index);
    setBusy("redraw");
    setError("");
    try {
      const body = await post<{ image: string }>("/api/puppet-frame", {
        action: text,
        index,
        count: puppetShots.length,
        feedback,
        previous: usePrev ? puppetShots[index - 1]?.image : "",
        next: useNext ? puppetShots[index + 1]?.image : "",
      });
      if (!body.image) throw new Error("다시 그린 그림이 없습니다.");
      setPuppetShots((existing) => existing.map((item, itemIndex) => (
        itemIndex === index ? { ...item, image: body.image, feedback: item.feedback ?? "", usePrev: Boolean(item.usePrev), useNext: Boolean(item.useNext) } : item
      )));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "이 장을 다시 그리지 못했습니다.";
      setPuppetFrameError(message);
      setError(message);
    } finally {
      setRedrawIndex(null);
      setBusy("");
    }
  }

  async function makePuppetClip() {
    if (puppetShots.length !== puppetFrames) return;
    await attempt("clip", "회색 인형 영상을 저장하지 못했습니다.", async () => {
      await post("/api/puppet-clip", { motion: workMotion, frames: puppetShots.map((shot) => shot.image) });
      setPuppetSource("stills");
      setClipStamp(Date.now());
      await refresh();
    });
  }

  async function uploadTake(file: File | undefined) {
    if (!file) return;
    await attempt("take", "영상을 저장하지 못했습니다.", async () => {
      await post("/api/performance", { video: await readFile(file, "영상") });
      setPuppetSource("take");
      setTakeStamp(Date.now());
      await refresh();
    });
  }

  async function clearBackdrop() {
    if (!result?.folder) return;
    const folder = result.folder;
    await attempt("matte", "배경 비교를 만들지 못했습니다.", async () => {
      const body = await post<{ compare?: string; aHow?: string; bHow?: string; cHow?: string; dHow?: string; hasB?: boolean }>("/api/clear-backdrop", { folder });
      if (!body.compare || !body.aHow || !body.bHow || !body.cHow || !body.dHow) throw new Error("배경 비교를 만들지 못했습니다.");
      setMatteOffer({ folder, compare: body.compare, aHow: body.aHow, bHow: body.bHow, cHow: body.cHow, dHow: body.dHow, hasB: Boolean(body.hasB) });
    });
  }

  async function chooseMatte(pick: "a" | "b" | "c" | "d") {
    if (!result?.folder || matteOffer?.folder !== result.folder) return;
    const folder = result.folder;
    await attempt("matte-choice", "고른 배경을 저장하지 못했습니다.", async () => {
      const body = await post<{ frames?: string[]; sheet?: string; notes?: string[] }>("/api/clear-backdrop", { folder, choice: pick });
      if (!body.frames || !body.sheet) throw new Error("고른 배경을 저장하지 못했습니다.");
      const frames = body.frames;
      const sheet = body.sheet;
      const notes = body.notes ?? [];
      setSets((current) => current.map((item, index) => index === active ? { ...item, frames, sheet, notes } : item));
      setMatteOffer(null);
      void loadHistory();
    });
  }

  function download() {
    if (!result) return;
    const link = document.createElement("a");
    link.href = result.sheet;
    link.download = `${downloadStem(result)}-sheet.png`;
    link.click();
  }

  async function downloadFrame(index: number) {
    const picture = result?.frames[index];
    if (!result || !picture) return;
    const response = await fetch(picture);
    if (!response.ok) throw new Error("칸을 받지 못했습니다.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${downloadStem(result)}_${String(index).padStart(2, "0")}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const making = Boolean(live) || (busy !== "" && !quietBusy.has(busy));
  const elapsed = Math.max(0, Math.round((now - (live?.since || busySince || now)) / 1000));

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Sprite<span>Gen</span></div>
        <nav className="menu">
          {menu.map((group, index) => (
            <div key={index} className="menu-group">
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.hint}
                  className={screen === item.id ? "active" : ""}
                  onClick={() => openScreen(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </header>
      {making && (
        <div className="live" role="status">
          <strong>진행중</strong>
          <span>{live?.title ?? "영상"}</span>
          <span>{live?.phase ?? "요청을 보내는 중입니다"}</span>
          <span>{elapsed}초</span>
        </div>
      )}
      <main className="shell">
        <section className="panel">
          {screen === "character" && (
            <>
              <h2>캐릭터</h2>
              <p className="plain">세 방식 모두 이 그림 한 장을 기준으로 씁니다. 그림을 올리거나 Cursor로 그린 뒤 기준으로 삼으세요.</p>
              <label>
                <span>기준 캐릭터 올리기</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void uploadCharacter(event.target.files?.[0])}
                />
              </label>
              {character && <img className="character-preview" src={character} alt="기준 캐릭터" />}
              <div className="maker">
                <p className="meta">Cursor로 그리기</p>
                <label>
                  <span>그릴 캐릭터</span>
                  <textarea
                    className="short"
                    value={drawText}
                    placeholder="빨간 머리띠를 한 격투가, 흰 도복"
                    onChange={(event) => setDrawText(event.target.value)}
                  />
                </label>
                <label>
                  <span>스타일</span>
                  <select value={style} onChange={(event) => setStyle(event.target.value)}>
                    <option value="pixel art">픽셀아트</option>
                    <option value="chibi pixel art">치비</option>
                    <option value="clean cartoon sprite">카툰</option>
                  </select>
                </label>
                <label>
                  <span>Cursor 모델</span>
                  <select
                    value={models.some((item) => item.id === model) ? model : "auto"}
                    onChange={(event) => {
                      setModel(event.target.value);
                      localStorage.setItem("pp-model", event.target.value);
                    }}
                  >
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <FinalPrompt
                  value={drawPrompt}
                  edited={drawPromptEdit !== null}
                  onChange={setDrawPromptEdit}
                  onReset={() => setDrawPromptEdit(null)}
                  note="이 문장이 그리기에서 Cursor로 전송됩니다."
                />
                <div className="actions">
                  <button type="button" className="primary" disabled={Boolean(busy) || !drawText.trim() || !drawPrompt.trim() || !status.key} onClick={() => void drawWithCursor()}>
                    {busy === "draw" ? "그리는 중" : "그리기"}
                  </button>
                </div>
                {drawn && (
                  <>
                    <img className="character-preview" src={drawn} alt="Cursor가 그린 캐릭터 후보" />
                    <div className="actions">
                      <button type="button" className="primary" disabled={Boolean(busy) || !drawn} onClick={() => void useDrawn()}>기준으로 쓰기</button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => setDrawn("")}>버리기</button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {selected?.id === "puppet" && (
            <>
              <h2>{selected.title}</h2>
              <section className="step">
                <p className="meta">1. 기준 캐릭터</p>
                {character ? <img className="character-preview" src={character} alt="기준 캐릭터" /> : <p className="error">캐릭터 메뉴에서 기준 그림을 먼저 고르세요.</p>}
              </section>
              <section className="step">
                <p className="meta">2. 동작 이름</p>
                <p className="plain">이 이름은 결과와 보낼 문장에 들어갑니다.</p>
                <label>
                  <span>동작 이름</span>
                  <input value={setName} maxLength={40} onChange={(event) => rememberName(event.target.value)} />
                </label>
              </section>
              <section className="step">
                <p className="meta">3. 회색 인형 그림</p>
                <p className="plain">각 장에 이미지를 직접 넣거나, 동작 설명으로 회색 인형을 그릴 수 있습니다. 한 장만 다시 그릴 때 참고할 앞 그림이나 뒷 그림을 체크할 수 있습니다. 체크하지 않으면 그 그림은 보내지 않습니다.</p>
                <label>
                  <span>동작 설명</span>
                  <textarea
                    className="short"
                    value={action}
                    onChange={(event) => {
                      setAction(event.target.value);
                      localStorage.setItem("pp-action", event.target.value);
                    }}
                  />
                </label>
                <label>
                  <span>프레임 {puppetFrames}</span>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    value={puppetFrames}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      const count = Number(event.target.value);
                      setPuppetFrames(count);
                      localStorage.setItem("pp-puppet-frames", String(count));
                    }}
                  />
                </label>
                <label>
                  <span>순서대로 이미지 넣기</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      const input = event.target;
                      void putPuppetFiles([...(input.files ?? [])], 0).finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                </label>
                <div className="actions">
                  <button type="button" className="primary" disabled={Boolean(busy) || !status.agent || !action.trim()} onClick={() => void makePuppetStills()}>
                    {busy === "stills" ? `${Math.min(puppetFrames, puppetShots.filter((shot) => shot.image).length + 1)}/${puppetFrames} 그리는 중` : "회색 인형 만들기"}
                  </button>
                </div>
                {puppetFrameError && <p className="error">{puppetFrameError}</p>}
                {puppetShots.length > 0 && (
                  <div className="step-stills">
                    {puppetShots.map((item, index) => (
                      <figure
                        key={`${item.label}-${item.image.length}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (busy) return;
                          const file = [...event.dataTransfer.files].find((entry) => /\.(png|jpe?g|webp)$/i.test(entry.name));
                          if (file) void putPuppetFiles([file], index);
                        }}
                      >
                        {item.image ? <img src={item.image} alt={item.label} /> : <div className="still-empty">비어 있음</div>}
                        <figcaption>{item.label}</figcaption>
                        <label>
                          <span>{item.image ? "이 장 바꾸기" : "이미지 넣기"}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={Boolean(busy)}
                            onChange={(event) => {
                              const input = event.target;
                              const file = input.files?.[0];
                              void putPuppetFiles(file ? [file] : [], index).finally(() => {
                                input.value = "";
                              });
                            }}
                          />
                        </label>
                        {item.image && (
                          <>
                            <textarea
                              className="short"
                              value={item.feedback ?? ""}
                              placeholder="이 장만 고칠 점"
                              onChange={(event) => {
                                const feedback = event.target.value;
                                setPuppetShots((existing) => existing.map((shot, shotIndex) => (
                                  shotIndex === index ? { ...shot, feedback } : shot
                                )));
                              }}
                            />
                            {index > 0 && (
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.usePrev)}
                                  onChange={(event) => {
                                    const usePrev = event.target.checked;
                                    setPuppetShots((existing) => existing.map((shot, shotIndex) => (
                                      shotIndex === index ? { ...shot, usePrev } : shot
                                    )));
                                  }}
                                />
                                <span>앞 그림</span>
                              </label>
                            )}
                            {index < puppetShots.length - 1 && (
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.useNext)}
                                  onChange={(event) => {
                                    const useNext = event.target.checked;
                                    setPuppetShots((existing) => existing.map((shot, shotIndex) => (
                                      shotIndex === index ? { ...shot, useNext } : shot
                                    )));
                                  }}
                                />
                                <span>뒷 그림</span>
                              </label>
                            )}
                            <button type="button" disabled={Boolean(busy)} onClick={() => void redrawPuppetFrame(index)}>
                              {redrawIndex === index ? "그리는 중" : "이 장만 다시 그리기"}
                            </button>
                          </>
                        )}
                      </figure>
                    ))}
                  </div>
                )}
              </section>
              <section className="step">
                <p className="meta">4. 회색 인형 영상</p>
                <p className="plain">확인한 그림을 순서대로 이어 3초 참고 영상으로 저장합니다. 비용은 없습니다. 그림을 바꾸거나 넣은 뒤에는 영상을 다시 저장해야 다음 단계에 반영됩니다.</p>
                <div className="actions">
                  <button type="button" className="primary" disabled={Boolean(busy) || puppetShots.length !== puppetFrames || puppetShots.some((shot) => !shot.image)} onClick={() => void makePuppetClip()}>
                    {busy === "clip" ? "영상 저장 중" : "이 그림들로 영상 만들기"}
                  </button>
                </div>
                <p className="plain">{puppetReady && takeReady
                  ? "그림으로 만든 영상과 직접 올린 영상이 둘 다 있습니다. 다음에 쓸 영상을 고르세요."
                  : puppetReady
                    ? `저장한 인형 영상 ${puppetSeconds.toFixed(1)}초가 다음 단계에 쓰입니다.`
                    : takeReady
                      ? `저장한 인형 영상이 없어 직접 올린 영상 ${status.takeSeconds.toFixed(1)}초를 씁니다.`
                      : "확인한 그림으로 영상을 저장하거나, 직접 찍은 영상을 올리세요."}</p>
                {puppetSeconds > 0 && (
                  <video className="source-clip" src={`/api/media?id=puppet&motion=${workMotion}&t=${clipStamp}`} autoPlay loop muted playsInline />
                )}
                <label>
                  <span>직접 올린 영상</span>
                  <input type="file" accept="video/mp4,video/webm" onChange={(event) => void uploadTake(event.target.files?.[0])} />
                </label>
                {takeReady && (
                  <>
                    <p className="plain">
                      올린 영상 {status.takeSeconds.toFixed(1)}초
                      {status.takeTrimmed
                        ? `. ${MOTION_MAX_SECONDS}초를 넘겨 앞 ${MOTION_MAX_SECONDS - 1}초만 남겼습니다.`
                        : status.takeExtendedFrom > 0
                          ? `. 원래 ${status.takeExtendedFrom.toFixed(1)}초라서 동작을 늦춰 3초로 늘렸습니다.`
                          : "."}
                    </p>
                    <video className="source-clip" src={`/api/media?id=take&t=${takeStamp}`} controls autoPlay loop muted playsInline />
                  </>
                )}
                {puppetReady && takeReady && (
                  <div className="motions">
                    <button type="button" className={puppetSource === "stills" ? "active" : ""} disabled={Boolean(busy)} onClick={() => setPuppetSource("stills")}>
                      그림으로 만든 영상 {puppetSeconds.toFixed(1)}초
                    </button>
                    <button type="button" className={puppetSource === "take" ? "active" : ""} disabled={Boolean(busy)} onClick={() => setPuppetSource("take")}>
                      직접 올린 영상 {status.takeSeconds.toFixed(1)}초
                    </button>
                  </div>
                )}
              </section>
              <section className="step">
                <p className="meta">5. 캐릭터 스프라이트</p>
                <p className="plain">{useUploaded ? `직접 올린 영상 ${status.takeSeconds.toFixed(1)}초` : puppetReady ? `그림으로 만든 영상 ${puppetSeconds.toFixed(1)}초` : "저장한 영상"}를 기준 캐릭터가 따라 하고, 그 영상을 8칸으로 나눕니다. {priceLine}.</p>
                <label>
                  <span>한 줄 설명</span>
                  <textarea
                    value={description}
                    placeholder="같은 캐릭터의 무늬입니다. 가슴의 호랑이, 등의 흰 용처럼 앞과 뒤와 옆을 같이 적습니다."
                    onChange={(event) => {
                      setDescription(event.target.value);
                      localStorage.setItem("pp-description", event.target.value);
                    }}
                  />
                </label>
                <FinalPrompt
                  value={sendPrompt}
                  edited={promptEdit !== null}
                  onChange={setPromptEdit}
                  onReset={() => setPromptEdit(null)}
                />
                <p className="plain">확인 창을 닫으면 비용이 없습니다.</p>
                <div className="actions">
                  <button className="primary" type="button" disabled={Boolean(busy) || methodBlocked} onClick={() => void generateMethod()}>
                    {busy === "method" ? "영상 만들고 칸 맞추는 중" : motionName ? `${motionName} 한 편 뽑기` : "한 편 뽑기"}
                  </button>
                </div>
              </section>
            </>
          )}
          {selected && selected.id !== "puppet" && (
            <>
              <h2>{selected.title}</h2>
              {character && <ChosenCharacter image={character} />}
              <p className="plain">{priceLine}. {selected.note}</p>
              {selected.id === "kling" && (
                <label>
                  <span>품질</span>
                  <select
                    value={quality}
                    onChange={(event) => {
                      const next = event.target.value === "pro" ? "pro" : "standard";
                      setQuality(next);
                      localStorage.setItem("pp-kling-quality", next);
                    }}
                  >
                    <option value="standard">Standard · {KLING_PRICES.standard}</option>
                    <option value="pro">Pro · {KLING_PRICES.pro}</option>
                  </select>
                </label>
              )}
              <label>
                <span>한 줄 설명</span>
                <textarea
                  value={description}
                  placeholder="같은 캐릭터의 무늬입니다. 가슴의 호랑이, 등의 흰 용처럼 앞과 뒤와 옆을 같이 적습니다."
                  onChange={(event) => {
                    setDescription(event.target.value);
                    localStorage.setItem("pp-description", event.target.value);
                  }}
                />
              </label>
              <label>
                <span>동작 이름</span>
                <input
                  value={setName}
                  maxLength={40}
                  onChange={(event) => rememberName(event.target.value)}
                />
              </label>
              {selected.id === "kling" && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(event) => {
                      setLoop(event.target.checked);
                      localStorage.setItem("pp-loop", event.target.checked ? "1" : "0");
                    }}
                  />
                  <span>시작과 끝이 같은 동작</span>
                </label>
              )}
              {selected.id !== "pose" && (
                <label>
                  <span>동작 설명</span>
                  <textarea
                    className="short"
                    value={action}
                    onChange={(event) => {
                      setAction(event.target.value);
                      localStorage.setItem("pp-action", event.target.value);
                    }}
                  />
                </label>
              )}
              {selected.id === "pose" && (
                <div className="maker">
                  <p className="meta">3D 몸 영상</p>
                  <p className="plain">{usable(bodySeconds)
                    ? `이 동작의 3D 몸 영상 ${bodySeconds.toFixed(1)}초가 뽑기에 쓰입니다.`
                    : "이 동작의 3D 몸 영상이 없습니다. 오른쪽에서 자세를 고치고 영상 만들기를 누르세요."}</p>
                  {bodySeconds > 0 && (
                    <video className="source-clip" src={`/api/media?id=performance&motion=${workMotion}&t=${clipStamp}`} autoPlay loop muted playsInline />
                  )}
                </div>
              )}
              {!character && <p className="error">캐릭터 메뉴에서 기준 그림을 먼저 올리세요.</p>}
              <FinalPrompt
                value={sendPrompt}
                edited={promptEdit !== null}
                onChange={setPromptEdit}
                onReset={() => setPromptEdit(null)}
              />
              <p className="plain">확인 창을 닫으면 비용이 없습니다.</p>
              <div className="actions">
                <button
                  className="primary"
                  type="button"
                  disabled={Boolean(busy) || methodBlocked}
                  onClick={() => void generateMethod()}
                >
                  {busy === "method" ? "영상 만들고 칸 맞추는 중" : motionName ? `${motionName} 한 편 뽑기` : "한 편 뽑기"}
                </button>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </section>
        <section className="stage">
          {selected?.id === "pose" && !making && (
            <BodyEditor
              motion={workMotion}
              motionLabel={motionName || "동작"}
              busy={busy === "body"}
              onMake={(frames) => void makeBodyClip({ frames })}
            />
          )}
          {screen === "character" && !making && (
            <SelectedCharacter image={character} onDrop={(file) => void uploadCharacter(file)} />
          )}
          {(screen !== "character" || making) && <>
          {making ? (
            <div className="progress-card" role="status">
              <p className="progress-kicker">진행중</p>
              <h2 className="result-name">{live?.title ?? "영상"}</h2>
              <p className="plain">{live?.phase ?? "요청을 보내는 중입니다"}</p>
              <p className="meta">{elapsed}초째</p>
            </div>
          ) : result && (
            <>
              <h2 className="result-name">{resultStamp(result)}</h2>
              {result.folder && <p className="plain">SpriteGen/.gen/{result.folder}</p>}
            </>
          )}
          <div className="player">
            {making ? (
              character
                ? <img className="progress-still" src={character} alt="만들고 있는 영상의 기준 캐릭터" />
                : <p className="meta">진행중</p>
            ) : showSource && result?.video
              ? <video src={result.video} autoPlay loop muted playsInline />
              : result?.frames.length
                ? <img src={result.frames[frame]} alt={resultStamp(result)} />
                : result?.video
                  ? <video src={result.video} autoPlay loop muted playsInline />
                  : <p className="meta">아직 결과가 없습니다</p>}
          </div>
          {result && !making && result.frames.length > 0 && (
            <div className="frame-pick">
              {result.frames.map((src, index) => (
                <button
                  key={`${src}-${index}`}
                  type="button"
                  aria-label={`${index + 1}번 칸 저장`}
                  onClick={() => void downloadFrame(index).catch((caught) => setError(caught instanceof Error ? caught.message : "칸을 받지 못했습니다."))}
                >
                  <img src={src} alt={`${index + 1}번 칸`} />
                </button>
              ))}
            </div>
          )}
          {result && !making && (
            <>
              {sets.length > 1 && (
              <div className="sets">
                {sets.map((item, index) => (
                  <button key={`${item.source}-${item.motion}-${index}`} type="button" className={index === active ? "active" : ""} onClick={() => { setActive(index); setFrame(0); setShowSource(false); setMatteOffer(null); }}>
                    {resultStamp(item)}
                  </button>
                ))}
              </div>
              )}
              <div className="actions">
                {result.video && result.frames.length > 0 && (
                  <button type="button" onClick={() => { setShowSource((current) => !current); }}>
                    {showSource ? "스프라이트 보기" : "원본 영상 보기"}
                  </button>
                )}
                <button type="button" disabled={!result.folder || Boolean(busy) || result.frames.length === 0} onClick={() => void clearBackdrop()}>
                  {busy === "matte" ? "배경 지우는 중" : "배경 투명화"}
                </button>
                <button type="button" className="end" disabled={!result.sheet} onClick={download}>시트 받기</button>
              </div>
              {matteOffer && matteOffer.folder === result.folder && (
                <MatteChoices offer={matteOffer} busy={busy} onChoose={(pick) => void chooseMatte(pick)} />
              )}
              {result.prompt && (
                <div className="prompt-box">
                  <p className="meta">입력된 프롬프트</p>
                  <pre>{result.prompt}</pre>
                </div>
              )}
            </>
          )}
          {history.length > 0 && (
            <div className="history">
              <p className="meta">지난 결과</p>
              <div className="sets">
                {history.map((item) => (
                  <button key={item.folder} type="button" className={!making && result?.folder === item.folder ? "active" : ""} disabled={making} onClick={() => openSaved(item)}>
                    {resultStamp(item)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {result && !making && (
            <>
              {result.notes.length > 0 && <div className="score">{result.score}</div>}
              {result.raw && <img className="raw" src={result.raw} alt="생성 원본 스트립" />}
              <ul className="notes">
                {result.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </>
          )}
          </>}
        </section>
      </main>
      <footer className="status">
        <span>agent {status.agent ? "ready" : "missing"}</span>
        <span>key {status.key ? "saved" : "empty"}</span>
        <span>character {character ? "ready" : "empty"}</span>
        <span>fal {status.fal ? "ready" : "empty"}</span>
        <span>take {status.take ? "saved" : "empty"}</span>
        <span>model {model}</span>
        <span>{result ? result.source : "idle"}</span>
      </footer>
    </div>
  );
}
