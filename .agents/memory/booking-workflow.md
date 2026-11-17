---
name: Booking workflow requirements
description: User-defined review states, net tax split and confirmation-first recurring bookings
---

The user wants the states „Fertig“, „Zu bearbeiten“ and „Nur eingelesen – nicht geprüft“ visible in the invoice list. Hiding list columns must not hide their fields in the editing form.

**Why:** The user needs to distinguish completed work from imported but unreviewed records.

**How to apply:** Keep review status explicit and the detail form independent of list visibility.

The user specifies „netto 7/19/0 und ergibt dann gesamt brutto und gesamt steuer“.

**Why:** The user wants to enter net amounts by tax rate and obtain calculated totals, not enter gross amounts per rate.

**How to apply:** Use net-based split inputs and consistent total tax/gross calculations.

Beleglose Buchungen may recur monthly, quarterly or annually, but due bookings must be confirmed first.

**Why:** The user explicitly chose „Fällige Buchungen erst bestätigen“ rather than automatic creation.

**How to apply:** Show due proposals and create real bookings only after explicit confirmation.
