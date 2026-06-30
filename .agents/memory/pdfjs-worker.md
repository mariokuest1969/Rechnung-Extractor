---
name: pdfjs worker in Vite strict mode
description: With fs.strict:true in Vite config, the ?url import of the pdfjs-dist worker file fails at build time.
---

## Rule
Copy the pdfjs worker to the artifact's `/public` folder and reference it as a static string, never via `?url` import.

**Why:** Vite's `fs.strict: true` restricts file serving to the project root. The `pdfjs-dist` package lives in `node_modules` which is outside the served root, so `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` throws "Does the file exist?" at startup.

**How to apply:**
```bash
cp node_modules/.pnpm/pdfjs-dist@<version>/node_modules/pdfjs-dist/build/pdf.worker.min.mjs artifacts/re2026/public/pdf.worker.min.mjs
```
Then in code: `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";` at module level (before any component renders). pdfjs version: 5.4.296.
