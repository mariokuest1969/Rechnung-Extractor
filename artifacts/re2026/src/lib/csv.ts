import { Invoice } from "@workspace/api-client-react";

export function exportInvoicesToCSV(invoices: Invoice[]) {
  const headers = [
    "Dateiname",
    "Rechnungssteller",
    "Datum",
    "Rechnungsnummer",
    "Brutto",
    "Steuersatz",
    "Steuer",
    "Netto",
    "Währung",
    "Bemerkung"
  ];

  const rows = invoices.map(inv => [
    inv.dateiname || "",
    inv.rechnungssteller || "",
    inv.datum || "",
    inv.rechnungsnummer || "",
    inv.bruttoBetrag != null ? inv.bruttoBetrag.toString().replace(".", ",") : "",
    inv.steuersatz != null ? inv.steuersatz.toString().replace(".", ",") : "",
    inv.steuerBetrag != null ? inv.steuerBetrag.toString().replace(".", ",") : "",
    inv.nettoBetrag != null ? inv.nettoBetrag.toString().replace(".", ",") : "",
    inv.waehrung || "EUR",
    inv.bemerkung || ""
  ]);

  const csvContent = [
    headers.join(";"),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `rechnungen_export_${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
