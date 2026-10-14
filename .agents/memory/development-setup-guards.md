---
name: Development setup guards
description: Distinguishing a published runtime from a development task workspace.
---

Do not use `REPLIT_ENVIRONMENT=production` to infer that a process is connected to the production database.

**Why:** A development task workspace reported that value while using the managed development database. Official Replit documentation instead identifies `REPLIT_DEPLOYMENT=1` as the published-runtime marker.

**How to apply:** Guard dev-only setup against `REPLIT_DEPLOYMENT=1` and `NODE_ENV=production`, and use only the workspace-provided development connection. Never introduce deploy-build or startup DDL.
