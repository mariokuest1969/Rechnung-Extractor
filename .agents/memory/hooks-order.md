---
name: React hooks before conditional return
description: React Rules of Hooks require ALL hook calls to appear before any conditional return in a component.
---

## Rule
All `useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`, custom hooks — must be called before any `if (!x) return null` or similar early return.

**Why:** React tracks hooks by call order. A conditional return before a hook call means the hook is skipped on some renders, breaking the call order and causing a runtime error ("Rendered more hooks than previous render").

**How to apply:**
- Put ALL hooks at the top of the component function body.
- Put early returns (null guards, loading guards) AFTER all hook declarations.
- Regular functions and derived variables (non-hooks) can safely come after the early return.
- Comment clearly: `// ALL hooks must come before any conditional return`
