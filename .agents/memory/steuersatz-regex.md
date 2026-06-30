---
name: pdf-extractor steuersatz overflow
description: The regex that extracts VAT rate from PDF text can match large non-VAT numbers (e.g. invoice numbers) near "MwSt", causing DB numeric overflow.
---

## Rule
Constrain steuersatz extraction to 1–2 digit patterns and validate the parsed value is in range 1–50 before storing.

**Why:** A permissive regex like `(\d+)[,.]?\d*\s*%\s*MwSt` can match "8619 % MwSt" (from an invoice number or quantity near "MwSt" text), yielding steuersatz=8619 which overflows the DB `numeric` column and causes insert failure.

**How to apply:** Use `\d{1,2}` in the capture group and add a range check after parsing:
```typescript
if (!isNaN(parsed) && parsed > 0 && parsed <= 50) { result.steuersatz = parsed; }
```
Also check both orderings: "19% MwSt" AND "MwSt 19%".
