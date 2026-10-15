---
name: Bulk editing validation
description: Compatibility choices behind bulk invoice field validation.
---

Do not restrict tax rates to the UI's preset buttons or require booking amounts to be positive.

**Why:** The bulk editor permits custom rates, and negative booking amounts are useful for credit notes. Validation should reject malformed or unrepresentable values without removing these use cases, rather than imposing a country-specific list.

**How to apply:** When extending invoice validation, retain custom fractional rates and signed amounts. Check precision before deriving accounting values: calculating with a higher-precision rate than the database stores can leave the saved rate inconsistent with the saved tax.

Do not rely solely on Zod 3 `multipleOf(0.01)` for decimal precision.

**Why:** Regression testing showed that `1e-7` passes that validator despite not being a cent multiple, due to its handling of exponential notation.

**How to apply:** Pair generated multiple-of constraints with an explicit precision refinement and test very small exponential values as well as ordinary three-decimal inputs.
