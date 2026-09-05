import { app } from "../server/app.js";

// Node.js serverless runtime (not Edge) so we can use the OpenAI SDK + fs-free imports from src/.
// Export the Hono app directly (Vercel's own Hono-aware handling calls its
// .fetch() correctly) -- wrapping it in hono/vercel's handle() instead
// produces a plain (req) => Response function, which this project's Vercel
// runtime invokes with the legacy Node (req, res) calling convention and
// silently discards the returned Response, hanging every request until
// FUNCTION_INVOCATION_TIMEOUT.
export const config = {
  maxDuration: 60,
};

export default app;
