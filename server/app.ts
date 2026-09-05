import { Hono } from "hono";
import { cors } from "hono/cors";
import { runSenseiTurn, type ChatTurnMessage, type LeagueContext } from "./agent/runSenseiTurn.ts";

/** Shared Hono app used by local `server/index.ts` and the Vercel `api/` adapter. */
export function createApp() {
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    })
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/chat", async (c) => {
    if (!process.env.OPENAI_API_KEY) {
      return c.json(
        { error: "OPENAI_API_KEY is not set on the server. Add it in Vercel env vars or your local .env file." },
        500
      );
    }

    let body: {
      messages?: ChatTurnMessage[];
      leagueContext?: LeagueContext;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const leagueContext = body.leagueContext;
    if (!leagueContext || typeof leagueContext.managedTeamId !== "number") {
      return c.json({ error: "leagueContext.managedTeamId is required" }, 400);
    }
    if (messages.length === 0) {
      return c.json({ error: "messages must be a non-empty array" }, 400);
    }

    try {
      const result = await runSenseiTurn({ messages, leagueContext });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat request failed";
      console.error("[api/chat]", err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

export const app = createApp();
