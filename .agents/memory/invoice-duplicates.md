---
name: Duplicate invoice safety
description: Conservative duplicate criteria and persistent Dropbox exclusions
---

The user requested duplicate invoices, not repeated article positions. Treat matching invoice metadata as a candidate for manual review, never as proof of an identical document.

**Why:** Repeated products across invoices are legitimate; invoices with the same identifying metadata can still differ in booking fields or notes.

**How to apply:** Require explicit selection and confirmation, preserve at least one invoice in every group, and revalidate on the server before deleting.

Deleting a duplicate from the app must not delete its Dropbox source file or allow automatic sync to recreate it.

**Why:** The source document should remain recoverable, while an automatic reimport would undo the user's cleanup.

**How to apply:** Commit persistent import exclusions and deletions atomically. Coordinate deletion with the final import write, not just the initial scan, since extraction can outlive a deletion.

Keep the confirmation step within the same dialog instead of stacking an AlertDialog inside it.

**Why:** In this UI, canceling the nested confirmation also dismissed the parent review and discarded selection; outside-interaction guards did not fix it.

**How to apply:** Swap review/confirmation content while retaining selection, and make Cancel explicitly return to review.
