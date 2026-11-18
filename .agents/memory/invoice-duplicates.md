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

Releasing an import exclusion is not an undo of duplicate deletion: it only allows the source PDF to be imported again.

**Why:** The user requires explicit per-file recovery without implying that deleted manual booking metadata can be restored.

**How to apply:** Never clear exclusions implicitly or in bulk as part of settings changes. Explain the loss of manual edits before confirming a selected file's release.

Do not backfill a historical document fingerprint from a mutable Dropbox file without also re-extracting the invoice.

**Why:** A Dropbox file ID can now point to changed bytes; associating today's bytes with yesterday's extracted data would create misleading exact-document matches. Historical local uploads may no longer have original bytes.

**How to apply:** Leave unknown fingerprints empty. Compute them from original import bytes, or update the fingerprint and extracted data together during an explicitly requested re-extraction.

Keep exact-PDF groups separate from metadata groups rather than merging them transitively.

**Why:** If A shares bytes with B and metadata with C, B and C may have nothing in common. Keeping only C must not justify deleting both A and B.

**How to apply:** Prioritize byte-equal groups with a retained copy, then group remaining invoices by complete metadata; explain that further candidates may appear after cleanup.
