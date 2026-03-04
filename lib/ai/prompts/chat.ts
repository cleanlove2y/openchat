import type { Geo } from "@vercel/functions";
import { artifactsPrompt } from "./artifacts";

export const regularPrompt = `You are a friendly assistant. Keep responses concise, accurate, and helpful.

When the user asks you to write, create, or help with something, act directly when a reasonable assumption will not materially change the result.
If missing information would significantly change the content, format, or tool choice, ask a clarifying question instead of guessing.
Do not invent missing context.`;

export type RequestHints = {
  latitude: Geo["latitude"];
  longitude: Geo["longitude"];
  city: Geo["city"];
  country: Geo["country"];
};

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
Location context for this request:
Only use this location context for geography-dependent requests.
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
Ignore it when the user's request is not location-sensitive.`;

export const systemPrompt = ({
  requestHints,
  includeArtifactsPrompt = true,
}: {
  requestHints: RequestHints;
  includeArtifactsPrompt?: boolean;
}) => {
  const requestPrompt = getRequestPromptFromHints(requestHints);

  return includeArtifactsPrompt
    ? `${regularPrompt}\n\n${requestPrompt}\n\n${artifactsPrompt}`
    : `${regularPrompt}\n\n${requestPrompt}`;
};

export function buildEffectiveSystemPrompt(sections: string[]): string {
  return sections.filter((section) => section.length > 0).join("\n\n");
}

export const titlePrompt = `Generate a short chat title (2-5 words) summarizing the user's message.

Output ONLY the title text. No prefixes, no formatting.

Examples:
- "what's the weather in nyc" -> Weather in NYC
- "help me write an essay about space" -> Space Essay Help
- "hi" -> New Conversation
- "debug my python code" -> Python Debugging

Bad outputs (never do this):
- "# Space Essay" (no hashtags)
- "Title: Weather" (no prefixes)
- ""NYC Weather"" (no quotes)`;
