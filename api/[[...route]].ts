import { handle } from "hono/vercel";
import { app } from "../server/app.ts";

// Node.js serverless runtime (not Edge) so we can use the OpenAI SDK + fs-free imports from src/.
export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default handle(app);
