// POST /api/treatments — see handler.ts. Next 16 route handler: the Node.js runtime is the fixed default.
import Anthropic from "@anthropic-ai/sdk";
import { handleTreatments } from "./handler";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleTreatments(request, { apiKey: process.env.ANTHROPIC_API_KEY, makeClient: (apiKey) => new Anthropic({ apiKey }) });
}
