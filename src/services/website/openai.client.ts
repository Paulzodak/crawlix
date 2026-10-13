import OpenAI from "openai";
import { config } from "../../config/index.js";

let client: OpenAI | null = null;

/** Shared OpenAI client, or null when no API key is configured. */
export function getOpenAIClient(): OpenAI | null {
  if (!config.openai.apiKey) return null;
  client ??= new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}
