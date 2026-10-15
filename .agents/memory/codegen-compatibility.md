---
name: OpenAPI generator compatibility
description: Dependency updates can change generated Zod APIs and browser type requirements
---

Check generator output compatibility with the workspace's actual Zod major version after dependency upgrades, especially when dependencies use pnpm catalog references.

**Why:** An upgraded Orval resolved its own Zod 4 dependency while the runtime still used Zod 3, producing incompatible validators. Its updated client output also introduced iterable browser headers.

**How to apply:** Specify the intended validator version in generator configuration and retain browser iterable types for clients. Regenerate and typecheck shared libraries before checking consuming apps; do not manually patch generated code.
