import { describe, expect, it, vi } from "vitest";
import { buildBooking, emptyDraft, splitGross, type BookingDraft } from "@/lib/manual-booking";
import { createInvoiceCSVTable } from "@/lib/csv";
import { createInvoiceExcelSheet } from "@/lib/xlsx-export";
import type { Invoice } from "@workspace/api-client-react";
import { formatDate } from "@/lib/format";

const draft = (p: Partial<BookingDraft>): BookingDraft => ({ ...emptyDraft(), datum: "2026-03-31", buchungstext: "Miete", ...p });

describe("booking calendar dates", () => {
  it("keeps calendar days identical in Berlin and zones west of UTC", () => {
    try {
      for (const timezone of ["Europe/Berlin", "America/Los_Angeles", "Pacific/Honolulu", "UTC"]) {
        vi.stubEnv("TZ", timezone);
        expect(formatDate("2026-11-18")).toBe("18.11.2026");
        expect(formatDate("2024-02-29")).toBe("29.02.2024");
        expect(formatDate("2026-03-29")).toBe("29.03.2026");
      }
    } finally { vi.unstubAllEnvs(); }
  });
  it("does not silently normalize malformed or missing dates", () => {
    expect(formatDate("2026-02-30")).toBe("2026-02-30");
    expect(formatDate("unbekannt")).toBe("unbekannt");
    expect(formatDate(null)).toBe("—");
  });
});

describe("splitGross (backend-identical rounding)", () => {
  it("rounds half cents commercially, symmetric for credits", () => {
    expect(splitGross(119, 19)).toEqual({ nettoBetrag: 100, steuerBetrag: 19 });
    expect(splitGross(0.01, 19)).toEqual({ nettoBetrag: 0.01, steuerBetrag: 0 });
    expect(splitGross(-0.01, 19)).toEqual({ nettoBetrag: -0.01, steuerBetrag: 0 });
    expect(splitGross(10.7, 7)).toEqual({ nettoBetrag: 10, steuerBetrag: 0.7 });
    expect(splitGross(-10.7, 7)).toEqual({ nettoBetrag: -10, steuerBetrag: -0.7 });
    // 0.07 / 1.07 = 0.0654 -> 0.07 net? 7*10000/10700 = 6.54 -> 7 cents
    expect(splitGross(0.07, 7)).toEqual({ nettoBetrag: 0.07, steuerBetrag: 0 });
  });
  it("is exact for the largest allowed amounts", () => {
    expect(splitGross(9999999999.99, 19)).toEqual({ nettoBetrag: 8403361344.53, steuerBetrag: 1596638655.46 });
    expect(splitGross(-9999999999.99, 19)).toEqual({ nettoBetrag: -8403361344.53, steuerBetrag: -1596638655.46 });
  });
  it("handles zero rate and zero gross", () => {
    expect(splitGross(42.5, 0)).toEqual({ nettoBetrag: 42.5, steuerBetrag: 0 });
    expect(splitGross(0, 19)).toEqual({ nettoBetrag: 0, steuerBetrag: 0 });
  });
});

describe("buildBooking", () => {
  it("builds single mode with computed totals and keeps explicit zero", () => {
    const r = buildBooking(draft({ bruttoBetrag: "0", steuersatz: "19" }), { includeStatus: true });
    expect(r.data).toMatchObject({ steuerModus: "single", bruttoBetrag: 0, steuersatz: 19, nettoBetrag: 0, steuerBetrag: 0, bearbeitungsstatus: "unreviewed" });
  });
  it("handles credits", () => {
    const r = buildBooking(draft({ bruttoBetrag: "-119,00", steuersatz: "19" }), { includeStatus: false });
    expect(r.data).toMatchObject({ bruttoBetrag: -119, nettoBetrag: -100, steuerBetrag: -19 });
    expect(r.data && "bearbeitungsstatus" in r.data).toBe(false);
  });
  it("requires gross and rate in single mode", () => {
    const r = buildBooking(draft({ bruttoBetrag: "", steuersatz: "" }), { includeStatus: true });
    expect(r.data).toBeUndefined();
    expect(r.errors.bruttoBetrag).toBeTruthy();
    expect(r.errors.steuersatz).toBeTruthy();
  });
  it("rejects more than two decimals instead of rounding", () => {
    expect(buildBooking(draft({ bruttoBetrag: "10.005" }), { includeStatus: true }).errors.bruttoBetrag).toBeTruthy();
    expect(buildBooking(draft({ bruttoBetrag: "10", buchungskonto1Betrag: "1.234" }), { includeStatus: true }).errors.buchungskonto1Betrag).toBeTruthy();
    expect(buildBooking(draft({ steuerModus: "split", netto7: "1.001" }), { includeStatus: true }).errors.netto7).toBeTruthy();
  });
  it("builds split mode including explicit zero and credits", () => {
    const r = buildBooking(draft({ steuerModus: "split", netto7: "0", netto19: "-100", netto0: "" }), { includeStatus: true });
    expect(r.data).toMatchObject({ steuerModus: "split", netto7: 0, netto19: -100, netto0: null });
  });
  it("rejects split with no net amount", () => {
    const r = buildBooking(draft({ steuerModus: "split" }), { includeStatus: true });
    expect(r.errors.tax).toBeTruthy();
  });
  it("validates required text, date and currency", () => {
    const r = buildBooking(draft({ buchungstext: " ", datum: "", waehrung: "eu", bruttoBetrag: "1" }), { includeStatus: true });
    expect(Object.keys(r.errors).sort()).toEqual(["buchungstext", "datum", "waehrung"]);
  });
});

describe("origin export", () => {
  const inv = (p: Partial<Invoice>): Invoice => ({ id: 1, bearbeitungsstatus: "unreviewed", createdAt: "", ...p });
  it("exports origin, status and booking fields in CSV and XLSX", () => {
    const list = [inv({ herkunft: "recurring", buchungstext: "Miete", buchungskonto1: "4210", buchungskonto1Betrag: 0 }), inv({ herkunft: "manual", bearbeitungsstatus: "done" }), inv({})];
    const csv = createInvoiceCSVTable(list);
    const col = (h: string) => csv.headers.indexOf(h);
    expect(csv.rows.map((r) => String(r[col("Herkunft")]))).toEqual(["Wiederkehrend", "Ohne Beleg", "PDF"].map((v) => expect.stringContaining(v)) as unknown as string[]);
    expect(String(csv.rows[1]![col("Bearbeitungsstatus")])).toContain("Fertig");
    expect(String(csv.rows[0]![col("Buchungskonto 1")])).toContain("4210");
    const sheet = createInvoiceExcelSheet(list);
    const header = sheet.data[0]!.map((c) => (c as { value: unknown }).value);
    const h = header.indexOf("Herkunft");
    expect(h).toBeGreaterThan(-1);
    expect((sheet.data[1]![h] as { value: unknown }).value).toBe("Wiederkehrend");
    expect((sheet.data[2]![header.indexOf("Bearbeitungsstatus")] as { value: unknown }).value).toBe("Fertig");
  });
});
