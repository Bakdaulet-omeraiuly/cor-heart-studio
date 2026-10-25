// POST /api/treatments/explain — see handler.ts.
import Anthropic from "@anthropic-ai/sdk";
import { handleExplain } from "./handler";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleExplain(request, { apiKey: process.env.ANTHROPIC_API_KEY, makeClient: (apiKey) => new Anthropic({ apiKey }) });
}
