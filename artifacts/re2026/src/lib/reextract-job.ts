export async function runPersistentReextractJob<T>(
  id: number,
  request: typeof fetch = fetch,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 750)),
): Promise<{ invoice: T; extractedPositionCount: number }> {
  const startResponse = await request(`/api/invoices/${id}/reextract`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const startData = await startResponse.json().catch(() => null) as { jobId?: string; error?: string } | null;
  if (!startResponse.ok || !startData?.jobId) {
    throw new Error(startData?.error || `Serverfehler (${startResponse.status})`);
  }

  // Retry only reads, never POST: a lost response must not duplicate extraction.
  let unavailable = 0;
  for (let attempt = 0; attempt < 240; attempt++) {
    await pause();
    let response: Response;
    try {
      response = await request(`/api/invoices/reextract-jobs/${encodeURIComponent(startData.jobId)}`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      if (++unavailable < 40) continue;
      throw new Error("Server nicht erreichbar. Bitte den Rechnungsstatus prüfen und erneut auslesen.");
    }
    const data = await response.json().catch(() => null) as {
      status?: string; error?: string; invoice: T; extractedPositionCount: number;
    } | null;
    // A terminal job error can itself use HTTP 500/504. Do not retry it.
    if (data?.status === "error") throw new Error(data.error);
    if ([502, 503, 504].includes(response.status) || (!data && response.ok)) {
      if (++unavailable < 40) continue;
      throw new Error("Server vorübergehend nicht erreichbar. Bitte erneut auslesen.");
    }
    unavailable = 0;
    if (!response.ok) {
      throw new Error(data?.error || `Serverfehler (${response.status})`);
    }
    if (data?.status === "success") return data;
    if (data?.status !== "processing") throw new Error("Ungültiger Auftragsstatus");
  }
  throw new Error("Auftrag konnte nicht abgeschlossen werden. Bitte den Rechnungsstatus prüfen und erneut auslesen.");
}
