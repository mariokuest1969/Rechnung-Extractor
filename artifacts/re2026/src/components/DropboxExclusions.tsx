import { useState } from "react";
import {
  type DropboxExclusion,
  getListDropboxExclusionsQueryKey,
  useListDropboxExclusions,
  useReleaseDropboxExclusion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DropboxExclusions() {
  const [selected, setSelected] = useState<DropboxExclusion | null>(null);
  const queryClient = useQueryClient();
  const list = useListDropboxExclusions({
    query: { refetchInterval: 30_000, staleTime: 0 },
  });
  const release = useReleaseDropboxExclusion({
    mutation: {
      onSuccess: () => {
        setSelected(null);
        toast.success("Datei für den nächsten Dropbox-Abgleich freigegeben");
        queryClient.invalidateQueries({ queryKey: getListDropboxExclusionsQueryKey() });
      },
      onError: () => {
        toast.error("Freigabe fehlgeschlagen. Bitte Liste aktualisieren und erneut versuchen.");
        queryClient.invalidateQueries({ queryKey: getListDropboxExclusionsQueryKey() });
      },
    },
  });

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Ausgeschlossene Dropbox-Dateien">
      <h3 className="text-sm font-semibold">Ausgeschlossene Dropbox-Dateien</h3>
      <p className="text-xs text-muted-foreground">
        Diese Dateien wurden bei der Dublettenbereinigung vom Import ausgeschlossen.
        Eine Freigabe erlaubt den erneuten PDF-Import beim nächsten Abgleich,
        sofern die Datei im eingestellten Dropbox-Ordner vorhanden ist.
        Gelöschte manuelle Buchungsangaben werden nicht wiederhergestellt.
      </p>
      {selected ? (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold">Diese Datei wieder freigeben?</p>
          <p className="break-all text-sm">{selected.filename || "Dateiname nicht gespeichert"}</p>
          <p className="break-all font-mono text-xs">{selected.fileId}</p>
          <p className="text-xs">
            Die PDF wird erneut ausgelesen. Frühere manuelle Änderungen, Kontierungen
            und Notizen bleiben gelöscht. Dadurch kann erneut eine Dublette entstehen.
            Andere Ausschlüsse bleiben unverändert.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={release.isPending} onClick={() => setSelected(null)}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={release.isPending} onClick={() => release.mutate({ data: { fileId: selected.fileId } })}>
              {release.isPending ? "Wird freigegeben…" : "Freigabe bestätigen"}
            </Button>
          </div>
        </div>
      ) : list.isLoading ? (
        <p role="status" className="text-sm">Ausschlüsse werden geladen…</p>
      ) : list.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Ausschlüsse konnten nicht geladen werden.</p>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>Erneut versuchen</Button>
        </div>
      ) : list.data?.length ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {list.data.map(file => (
            <li key={file.fileId} className="space-y-1 rounded-md border p-3">
              <p className="break-all text-sm font-medium">{file.filename || "Dateiname nicht gespeichert"}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{file.fileId}</p>
              <p className="text-xs text-muted-foreground">
                Ausgeschlossen am {new Date(file.excludedAt).toLocaleString("de-DE")}
              </p>
              <Button size="sm" variant="outline" onClick={() => setSelected(file)}>Wieder freigeben</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Keine Dropbox-Dateien ausgeschlossen.</p>
      )}
    </section>
  );
}
