import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  res.json({ apiKey });
}
