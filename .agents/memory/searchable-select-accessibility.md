---
name: Searchable select accessibility
description: Accessible naming for cmdk search inputs
---

Set the cmdk Command root's `label` when naming its search field; an input-only `aria-label` is not sufficient.

**Why:** cmdk generates an `aria-labelledby` reference to its own label, which takes precedence over the input's `aria-label`. This surfaced in accessible-role integration tests.

**How to apply:** For new searchable selections, name the Command root and verify the input can be found by its accessible name.
