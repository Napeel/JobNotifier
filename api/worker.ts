import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleWorkerRequest } from "../src/serverless.ts";

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  await handleWorkerRequest({ request, response });
}
