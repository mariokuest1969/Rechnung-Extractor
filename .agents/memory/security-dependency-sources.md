---
name: Security dependency sources
description: Scanner limitations and replacement tradeoffs for spreadsheet exports and brace expansion.
---

Do not return to SheetJS `xlsx` for spreadsheet exports solely by using its official CDN release.

**Why:** The workspace dependency scanner marks every npm-ecosystem `xlsx` version as affected by the two older advisories, including the otherwise patched official CDN release. An export-only writer avoids both that unresolved scan result and importing an unnecessary spreadsheet parser.

**How to apply:** Keep invoice exports on an export-only library. Preserve numeric cells, German column headers and widths, and handle asynchronous download failures in the UI.

The upstream `braces` package had no release fixing its recursive AST depth vulnerability when this project was remediated. A guarded derivative was adopted rather than merely suppressing the advisory.

**Why:** Both proxy glob matching and component discovery depend on its API. Replacing it with an unrelated brace-expansion library would break that contract.

**How to apply:** Before changing the derivative, inspect the actual depth guards and test parsing plus direct compile, expand and stringify AST traversal. A renamed package or clean audit alone does not prove the vulnerable behavior is fixed.
