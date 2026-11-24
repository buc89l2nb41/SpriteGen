export function characterPrompt(description: string, style: string) {
  return [
    "Draw one game character, full body from head to feet, standing in a neutral pose.",
    "Side view, facing right. Arms and legs clearly visible.",
    "Flat pure magenta background, hex FF00FF. No scenery, no shadow, no text, no border.",
    description ? `Character: ${description}` : "",
    style ? `Style: ${style}` : "",
  ].filter(Boolean).join("\n");
}
