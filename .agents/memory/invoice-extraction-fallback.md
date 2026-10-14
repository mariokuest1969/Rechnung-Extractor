---
name: Invoice AI extraction silent fallback
description: Why invoice fields can look empty/garbage across the board, and how to diagnose
---

# Invoice AI extraction: silent regex fallback

Upload previews must surface PDF parsing, empty-text, and AI extraction failures instead of using the historical silent fallback. Other import/re-extraction callers retain their existing fallback behavior unless explicitly changed.

**Why:** A fallback presented as a successful preview allows users to unknowingly confirm empty or unreliable accounting data; changing every import path at once would broaden the scope and alter established behavior.

**How to apply:** Keep preview extraction strict. When investigating other import paths, use the fallback diagnostics below rather than assuming they also surface errors.

If extracted invoice fields (rechnungssteller, brutto, datum, rechnungsnummer)
look empty or wrong across MANY invoices at once, the AI extractor most likely
failed and silently fell back to a weak regex parser — it does NOT surface an
error to the user.

**Root cause seen in practice:** OpenAI returned `429 insufficient_quota` on the
user's own `OPENAI_API_KEY`, so every extraction degraded to regex.

**Fix applied:** extraction now prefers the Replit AI Integrations proxy
(`AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`), falling
back to `OPENAI_API_KEY` only when the proxy vars are absent. Selection is by env
presence, not per-request failure — so a broken-but-present proxy still falls to
regex.

**How to diagnose:** check api-server logs for `429` / `insufficient_quota` or
regex-fallback log lines. Non-null counts in the DB do NOT prove quality — the
regex path can populate fields with wrong values.

**Dev vs prod:** dev and production use SEPARATE databases. A batch re-extract run
from the api-server hits DATABASE_URL (development) only. Production invoices are
not touched; prod re-extraction has no direct write path (prod SQL access is
read-only) — new imports after a re-publish use AI, but pre-existing prod rows
keep their old data.
