---
name: Test bundle dependency resolution
description: Dependency resolution when bundled tests import workspace packages.
---

When tests bundle workspace source but leave npm dependencies external, resolve each dependency from its owning package rather than assuming the test runner can import it.

**Why:** pnpm's package isolation means a dependency installed for the database package may not be resolvable from a generated API test bundle. Directly externalizing a TypeScript workspace package also leaves extensionless directory imports for Node to reject.

**How to apply:** Bundle workspace TypeScript and resolve external runtime dependencies from the package declaring them. Do not add duplicate application dependencies solely to make a test bundle resolve.

Mock module boundaries narrowly; a matching filename does not imply a matching responsibility.

**Why:** A route mock for settings also intercepted the database schema with the same basename, leaving schema bindings undefined in bundled tests.

**How to apply:** Exclude schema imports or match exact route/library locations when replacing external-service modules.
