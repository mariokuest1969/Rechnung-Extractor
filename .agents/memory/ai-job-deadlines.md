---
name: AI job deadlines
description: Reliability rule for bounded invoice AI and Dropbox processing.
---

Long-running invoice operations should return an asynchronous job immediately. Apply the timeout only to download/extraction before persistence starts, and keep the job `processing` throughout database persistence. Publish `success` or `error` only after the transaction has definitively committed or rolled back.

**Why:** A synchronous response deadline can race an in-flight database commit, causing the UI to report timeout even though accounting data changes afterward. Job state removes that ambiguity.

**How to apply:** Race only pre-persistence document work against a deadline and propagate cancellation through cooperative calls. Once persistence starts, use database-side limits and do not set a terminal job state until the transaction promise settles.