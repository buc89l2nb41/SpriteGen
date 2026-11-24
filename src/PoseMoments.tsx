import { useEffect, useRef } from "react";
import type { Pose } from "./pose";
import { drawWideOpenPose } from "./poseDraw";

export type MomentDraft = {
  label: string;
  pose: Pose | null;
  previous: Pose | null;
  feedback: string;
  adjust: string;
  accepted: boolean;
  error: string;
  busy: boolean;
};

function MomentStick({ pose }: { pose: Pose }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawWideOpenPose(ctx, pose, canvas.width, canvas.height);
  }, [pose]);
  return <canvas ref={ref} width={384} height={512} />;
}

export function PoseMoments(props: {
  moments: MomentDraft[];
  onMake: (index: number) => void;
  onPreview: (index: number) => void;
  onAccept: (index: number) => void;
  onRetry: (index: number) => void;
  onEditPoints: (index: number) => void;
  onFeedbackText: (index: number, text: string) => void;
  onFeedback: (index: number) => void;
  onUndo: (index: number) => void;
  editingIndex: number | null;
  onApply: () => void;
  onCancel: () => void;
}) {
  const ready = props.moments.length > 0 && props.moments.every((moment) => moment.pose && !moment.busy);
  return (
    <div className="pose-moments">
      <p className="plain">각 순간을 AI가 OpenPose 관절 좌표로 적고, 이 몸의 팔다리 길이에 맞춰 올립니다. 손가락 마디까지 끌어 고치거나, 피드백을 적어 지금 자세에서 고치게 할 수 있습니다.</p>
      {props.moments.map((moment, index) => (
        <section key={`${moment.label}-${index}`} className={props.editingIndex === index ? "pose-moment editing" : "pose-moment"}>
          <p className="meta">{index + 1}. {moment.label}{props.editingIndex === index ? " · 점 고치는 중" : moment.accepted ? " · 확정" : ""}</p>
          {moment.pose && (
            <div className="pose-moment-pics">
              <figure>
                <MomentStick pose={moment.pose} />
                <figcaption>이 몸 길이에 맞춘 OpenPose입니다. 몸에 올려 보기를 누르면 아래 3D 몸이 이 자세가 됩니다.</figcaption>
              </figure>
            </div>
          )}
          {moment.adjust && <p className="plain">{moment.adjust}</p>}
          {moment.error && <p className="plain">{moment.error}</p>}
          <div className="actions">
            <button type="button" disabled={moment.busy} onClick={() => props.onMake(index)}>
              {moment.busy ? "만드는 중" : moment.pose ? "OpenPose 다시 만들기" : "OpenPose 만들기"}
            </button>
            {moment.pose && (
              <>
                <button type="button" className="primary" disabled={moment.busy} onClick={() => props.onPreview(index)}>몸에 올려 보기</button>
                <button type="button" className="primary" onClick={() => props.onEditPoints(index)}>
                  {props.editingIndex === index ? "점 고치기 끝" : "점 위치 고치기"}
                </button>
                <button type="button" onClick={() => props.onAccept(index)}>확정</button>
                <button type="button" onClick={() => props.onRetry(index)}>지우기</button>
              </>
            )}
          </div>
          {moment.pose && (
            <div className="pose-prompt">
              <div className="pose-prompt-row">
                <textarea
                  className="short"
                  value={moment.feedback}
                  placeholder="피드백: 팔이 조금 더 위로 올라가야 할 것 같아"
                  disabled={moment.busy}
                  onChange={(event) => props.onFeedbackText(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      props.onFeedback(index);
                    }
                  }}
                />
                <button type="button" className="primary" disabled={moment.busy || !moment.feedback.trim()} onClick={() => props.onFeedback(index)}>
                  {moment.busy ? "고치는 중" : "피드백 반영"}
                </button>
                {moment.previous && (
                  <button type="button" disabled={moment.busy} onClick={() => props.onUndo(index)}>되돌리기</button>
                )}
              </div>
            </div>
          )}
        </section>
      ))}
      <div className="actions">
        <button type="button" className="primary" disabled={!ready} onClick={props.onApply}>
          {props.moments.some((moment) => moment.busy) ? "만드는 중" : "고른 자세로 칸 채우기"}
        </button>
        <button type="button" onClick={props.onCancel}>후보 닫기</button>
      </div>
    </div>
  );
}
