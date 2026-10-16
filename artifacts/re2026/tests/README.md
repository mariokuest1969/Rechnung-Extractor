# Article download integration tests

Run from the workspace root:

```sh
pnpm --filter @workspace/re2026 test:downloads
```

The suite mounts the real `ArticleSummaryDialog` in jsdom and interacts with its
scope, dates, view, sort and download controls. The CSV exporter and browser
`write-excel-file` implementation run unchanged. Only object URLs and the final
anchor click are intercepted: the generated Blob bytes are saved in a temporary
directory, then parsed with `csv-parse` and `read-excel-file`. Temporary files
are removed after each test.

Coverage includes both views × both scopes × both formats, inclusive date
boundaries, undated selected invoices, sort order, filenames, UTF-8 BOM,
semicolon/quote/newline escaping, formula-like text, negative/zero amounts,
missing values, numeric Excel cells, empty/invalid scopes, and visible export
failures with retry.

This is a component/file integration test, not a browser end-to-end test:
authentication, operating-system save dialogs and browser-specific download
policies are not exercised. It requires neither a running API nor invoice data
in the database. Existing `src/lib/*.test.ts` Node tests remain separate.
