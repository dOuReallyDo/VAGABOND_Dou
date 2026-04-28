# Implementation Plan (Milestones)

1) Architecture lock (Vercel + Vite + /api proxy)
2) Repo scaffold + deploy staging
3) Security hardening: validation, rate limit, logs, error mapping
4) Generation engine: strict schema validation + tool policy
5) UI: form + loading/error + results rendering
6) QA + release playbook + production deploy

**✅ Implemented: URL Safety system** (3-layer: prompt-level whitelist, post-processing sanitization via `sanitizeTravelPlan()`, Google Safe Browsing API). See `src/lib/urlSafety.ts`, `src/lib/safeBrowsing.ts`, and `SECURITY.md` for details.

Each milestone must include:
- what changed + file paths
- how to test
- risk + rollback plan
