#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm --filter @workspace/db --fail-if-no-match run setup:dev
