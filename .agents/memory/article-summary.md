---
name: Article aggregation rules
description: Why the article summary deliberately uses conservative grouping and incomplete totals
---

Do not merge same-named articles across suppliers, units, currencies, or tax rates. Do not infer quantities or amounts that extraction did not provide.

**Why:** Position numbers are invoice row numbers, not stable product identifiers. Matching descriptions across suppliers can describe different products or packages, and silently estimating missing amounts would make the summary misleading.

**How to apply:** Keep grouping conservative unless the user explicitly introduces a product mapping. Expose partial sums and invoices without positions rather than treating missing data as zero.
