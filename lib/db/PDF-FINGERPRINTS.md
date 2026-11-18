# PDF fingerprints: additive rollout and historical data

`invoices.pdf_sha256` is nullable text with no default and no uniqueness
constraint. Duplicate rows must remain available for manual review.
Deploy the additive schema change before starting the updated API:

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_sha256 text;
```

Development and post-merge setup use the existing guarded `setup:dev` schema
push. Production schema changes must follow the project's deployment process;
the development setup must not be run against production.

No SQL or metadata-based backfill is valid: a hash requires the actual bytes.
Historical uploads did not retain their PDF bytes, so their hash remains NULL.
Historical Dropbox IDs refer to mutable files, not necessarily the originally
imported revision. Do not silently hash the current Dropbox file onto old
extracted data. Explicit re-extraction updates the data and hash together,
after a successful download and extraction, in the existing transaction.
Unavailable files and failed extractions leave the invoice untouched.

New direct uploads and Dropbox imports hash the original downloaded bytes.
Reviewed uploads carry a signed fingerprint from preview to confirmation;
client-provided raw hashes are ignored. Legacy confirmations without a token
remain supported with NULL hashes. Invalid/expired tokens reject the whole
batch. Preview tokens expire after 24 hours or an API restart; re-extract the
upload to obtain a fresh token. Signing keys are process-local, so a future
multi-instance deployment will need shared signing-key management.

SHA-256 matches prove byte equality, not equality of manual booking fields.
Exact-byte groups take priority over metadata groups; groups are disjoint,
and no transitive combination of hash and metadata matches is allowed.
After cleanup, additional metadata groups may become visible.
Deletion still requires explicit confirmation, revalidates under the existing
table lock, retains a copy per group, and atomically excludes deleted Dropbox
IDs from later imports. No documents are deleted from Dropbox.
