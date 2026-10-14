---
name: Invoice upload atomicity
description: Why invoice upload batches should succeed or fail as a whole.
---

Treat each direct or confirmed upload batch as all-or-nothing rather than silently returning a subset.

**Why:** Returning success after skipping failed files hides missing invoices; retrying the whole selection can then duplicate the invoices that did save.

**How to apply:** Validate/extract every item before saving the batch. Preserve the array response expected by existing clients and return an explicit error when the batch cannot be saved.
