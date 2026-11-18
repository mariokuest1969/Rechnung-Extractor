# Beleglose und bestätigte wiederkehrende Buchungen

Das exportierte Drizzle-Schema wird vor dem aktualisierten API-Start über
`pnpm --filter @workspace/db run setup:dev` in der Entwicklung angewendet.
Für Produktion ausschließlich den freigegebenen Schema-Prozess verwenden.
Der Server prüft das Schema nur lesend und führt keine Migrationen aus.
Die äquivalente wiederholbar ausführbare SQL-Migration liegt unter
`scripts/bookings-schema.sql`; sie wird nicht automatisch ausgeführt.

Die Änderung ist additiv: vorhandene Rechnungen erhalten `herkunft = 'pdf'`,
ohne dass Beträge, Status, Dateiverknüpfungen oder Steueraufteilungen geändert
werden. Neue Tabellen halten Vorlagen und bestätigte Termine getrennt von
tatsächlichen Buchungen. Einmalige manuelle Buchungen tragen `manual`,
bestätigte Wiederholungen `recurring`.

## Kalender und Bestätigung

- Termine sind ISO-Kalendertage, keine Zeitstempel. „Heute“ gilt in Europe/Berlin.
- Monatlich, vierteljährlich und jährlich entsprechen 1, 3 und 12 Kalendermonaten.
- Der ursprüngliche Starttag ist der Anker: 31. Januar → letzter Februartag →
  31. März. Ein jährlicher 29. Februar wird in Nichtschaltjahren zum 28. Februar,
  im nächsten Schaltjahr wieder zum 29. Februar.
- Alle überfälligen unbestätigten Termine werden einzeln angezeigt.
- Das Anzeigen und Hintergrund-Aktualisieren erzeugt keine Buchung.
- Erst „Buchung bestätigen“ erzeugt einen Eintrag mit Status „Nur eingelesen –
  nicht geprüft“, auch wenn in der Vorlage ein anderer Status eingestellt ist.

## Pausieren, Ändern und Beenden

Pausieren blendet Vorschläge aus und verhindert ihre Bestätigung. Beim Fortsetzen
werden sämtliche noch unbestätigten Termine einschließlich der Pause wieder
angeboten; es wird kein Zeitraum still übersprungen.

Änderungen der Vorlage gelten für alle noch unbestätigten Termine, einschließlich
überfälliger Vorschläge; vorhandene Buchungen bleiben unverändert. Sobald ein
Termin bestätigt wurde, sind Starttermin und Intervall gesperrt. Für einen neuen
Rhythmus die alte Vorlage beenden und eine neue anlegen.

Beenden ist endgültig: unbestätigte Vorschläge entfallen, bereits erzeugte
Buchungen und ihre Bestätigungsnachweise bleiben erhalten.

## Atomarität

Bestätigung, Bearbeitung, Pausieren und Beenden sperren dieselbe Vorlagenzeile.
Buchung und Bestätigungsnachweis werden in einer gemeinsamen Transaktion erzeugt.
Zusätzlich schützt ein Unique-Constraint `(template_id, due_date)`.
Beim Löschen einer Buchung wird nur die Referenz im Nachweis auf NULL gesetzt.
Eine wiederholte Bestätigung liefert denselben Nachweis, statt neu zu buchen.

Geldbeträge werden auf Cent-Präzision und `numeric(12,2)`-Grenzen validiert.
Steuersummen werden serverseitig berechnet und nicht aus dem Browser übernommen.
