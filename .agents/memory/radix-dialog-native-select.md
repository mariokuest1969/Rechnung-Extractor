---
name: Radix Dialog + native select crash
description: Native <select> inside Radix Dialog closes the dialog when the browser dropdown opens, because Radix treats the native popup as an outside interaction.
---

## Rule
Never use a native `<select>` inside a Radix UI `<Dialog>`. Replace with Radix `<Select>` from `@/components/ui/select`.

**Why:** When the user opens a native `<select>` dropdown, the browser renders the picker outside the dialog's DOM. Radix Dialog detects this as `onInteractOutside` and closes the dialog. The user sees the dialog disappear — they call it a "crash".

**How to apply:**
- Any `<select onChange>` inside `<DialogContent>` → replace with `<Select onValueChange>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`.
- As belt-and-suspenders, add `onInteractOutside={(e) => e.preventDefault()}` to `<DialogContent>` for any dialog that must stay open during complex interactions.
- Add a visible close button (X icon) whenever outside-click is blocked, so users can still close the dialog.
