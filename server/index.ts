import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.API_PORT || 8787);

console.log(`Roster Sensei API listening on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
