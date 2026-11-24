export function motionPrompt(description: string, style: string, loop: boolean, action = "", label = "", followVideo = false, turns = false) {
  return [
    "Keep the face, outfit, colors, and proportions of the reference image. Do not design a new character.",
    description ? `Markings on this same character, wherever they sit on the front, back, or side: ${description}.` : "",
    `Style: ${style}.`,
    label ? `Name: ${label}.` : "",
    "Each moment is a different phase of the motion.",
    action ? `Action: ${action}.` : "",
    turns ? "The body may turn, including from a side view until the back faces the camera." : "Side view, facing right the entire time and never turning around.",
    loop
      ? "The clip starts and ends in exactly the same pose."
      : "Play the motion once from the starting pose. Do not repeat it as a seamless loop.",
    followVideo
      ? "Keep the character the same size as the body in the reference image. Do not zoom in to fill the frame. Keep the empty margin around the body. A raised elbow, fist, or jump stays inside the frame. Follow the reference video."
      : "Feet stay on one ground line.",
    followVideo ? "" : "Camera locked, no zoom, no pan.",
    "Keep the reference image's one solid background color across the whole frame. No magenta, no second background color, no scenery, no shadow, no text.",
  ].filter(Boolean).join("\n");
}
