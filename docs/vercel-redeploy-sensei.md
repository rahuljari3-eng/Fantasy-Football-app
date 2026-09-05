# Redeploying Gridiron HQ on Vercel (with Roster Sensei)

Instructions for whoever owns the Vercel project. Assumes:

- The Sensei / chatbot work is already on **`main`**
- Local chat works with an OpenAI key
- Production is set up so `/api/chat` runs on Vercel (serverless or equivalent) — **not** the local-only Vite proxy

---

## What you need from Anish

- The OpenAI API key (or he adds it himself in Vercel — better, so the key isn’t pasted in Slack)
- Optional: model override, usually `gpt-4o-mini`

**Never commit the key.** It lives only in Vercel → Settings → Environment Variables (and locally in `.env`, which is gitignored).

---

## Steps (Vercel dashboard)

1. Open the project on [vercel.com](https://vercel.com) (the Fantasy Football / Gridiron HQ app).
2. Go to **Settings → Environment Variables**.
3. Add:

   | Name | Value | Environments |
   |------|--------|----------------|
   | `OPENAI_API_KEY` | *(the real key)* | Production (and Preview if you want Sensei on PR deploys) |
   | `OPENAI_MODEL` | `gpt-4o-mini` | Same (optional; this is the default if omitted) |

4. Save.
5. Go to **Deployments**.
6. Open the latest Production deployment → **⋯** → **Redeploy**  
   (or push a new commit to `main` — either works).  
   **Important:** after adding env vars, you must redeploy; existing deployments won’t pick them up.
7. Wait for the build to finish (green).
8. Open the live site → **Chat with Roster Sensei** → ask a simple question (e.g. “Who are my RBs and their bye weeks?”).
9. You should get an answer and a collapsed **“N tools used”** line under it.

---

## If chat fails after redeploy

- **“OPENAI_API_KEY is not set”** (or similar) → env var missing, wrong environment (Preview vs Production), or redeploy wasn’t done after adding it.
- **404 on `/api/chat`** → the frontend built, but the API route isn’t deployed. That’s a code/hosting setup issue, not the key — ping Anish.
- **401 / invalid API key** → wrong or revoked OpenAI key; create a new one at platform.openai.com and update the Vercel env var, then redeploy again.
- **Timeouts** → Sensei’s tool loop can take several seconds; if Vercel’s function limit is too low, we may need to raise `maxDuration` later.

---

## CLI alternative (optional)

If you use Vercel CLI instead of the dashboard:

```bash
vercel env add OPENAI_API_KEY production
# paste the key when prompted

vercel env add OPENAI_MODEL production
# enter: gpt-4o-mini

vercel --prod
```

---

## Security notes

- Only people who need it should see the key (Vercel project access).
- Don’t put `OPENAI_API_KEY` in the Vite client or any `VITE_` variable — that would expose it in the browser bundle.
- Rotating the key: create a new key in OpenAI → update Vercel env → redeploy → revoke the old key.
