type ReasoningLikePart = {
  type?: string;
  text?: string;
  state?: string;
};

export function collectMessageReasoning(parts: ReasoningLikePart[]) {
  const segments: string[] = [];
  let isStreaming = false;

  for (const part of parts) {
    if (part.type !== "reasoning") {
      continue;
    }

    if (part.state === "streaming") {
      isStreaming = true;
    }

    const text = typeof part.text === "string" ? part.text.trim() : "";
    if (text) {
      segments.push(text);
    }
  }

  return {
    segments,
    isStreaming,
    hasReasoning: segments.length > 0 || isStreaming,
  };
}
