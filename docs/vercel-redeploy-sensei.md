# Redeploying Gridiron HQ on Vercel (with Roster Sensei)

Instructions for whoever owns the Vercel project.

Assumes the Sensei / chatbot work is on **`main`** (including the `api/` serverless adapter).

---

## How production chat works

- The Vite frontend is built to `dist/` and hosted on Vercel.
- `POST /api/chat` is handled by a **Vercel serverless function** (`api/[[...route]].ts`) that runs the same Sensei tool loop as local.
- Locally you still run `npm run dev` (Vite + Node API on `:8787`). Production does **not** need that second process.

---

## What you need

- OpenAI API key (prefer adding it yourself in Vercel so it isn’t pasted in chat)
- Optional: `OPENAI_MODEL=gpt-4o-mini` (default if omitted)

**Never commit the key.** Only Vercel Environment Variables (and local `.env`, gitignored).

---

## Steps (Vercel dashboard)

1. Open the project on [vercel.com](https://vercel.com).
2. Go to **Settings → Environment Variables**.
3. Add:

   | Name | Value | Environments |
   |------|--------|----------------|
   | `OPENAI_API_KEY` | *(the real key)* | Production (and Preview if you want Sensei on PR deploys) |
   | `OPENAI_MODEL` | `gpt-4o-mini` | Same (optional) |

4. Save.
5. Go to **Deployments**.
6. Open the latest Production deployment → **⋯** → **Redeploy**  
   (or push a new commit to `main`).  
   **Env vars only apply after a redeploy.**
7. Wait for the build to finish (green).
8. Open the live site → **Chat with Roster Sensei** → ask e.g. “Who are my RBs and their bye weeks?”
9. You should get an answer and a collapsed **“N tools used”** line.

---

## Quick checks

```bash
# Health (replace with your production URL)
curl -s https://YOUR_APP.vercel.app/api/health
# → {"ok":true}
```

---

## If chat fails after redeploy

| Symptom | Likely fix |
|---------|------------|
| “OPENAI_API_KEY is not set” | Env var missing, wrong environment (Preview vs Production), or no redeploy after adding it |
| **404** on `/api/chat` | Deploy doesn’t include the `api/` folder — confirm `main` has `api/[[...route]].ts` and `vercel.json` |
| **401** / invalid API key | Wrong or revoked key — update Vercel env, redeploy, revoke old key in OpenAI |
| **Timeout** | Tool loop took too long — Hobby plans may cap duration; Pro can use `maxDuration` up to 60s (already set in `vercel.json`) |

---

## CLI alternative (optional)

```bash
vercel env add OPENAI_API_KEY production
# paste the key when prompted

vercel env add OPENAI_MODEL production
# enter: gpt-4o-mini

vercel --prod
```

---

## Security notes

- Don’t put `OPENAI_API_KEY` in any `VITE_` variable — that would expose it in the browser bundle.
- Limit who has Vercel project access.
- To rotate: new OpenAI key → update Vercel env → redeploy → revoke old key.
