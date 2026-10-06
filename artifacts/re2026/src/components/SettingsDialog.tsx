import { useState, useEffect } from "react";
import {
  getGetDropboxStatusQueryKey,
  useGetDropboxStatus,
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings2,
  Loader2,
  FolderOpen,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropboxAppConnection, useDropboxCallback } from "./DropboxAppConnection";

export function SettingsDialog() {
  const [open, setOpen]             = useState(false);
  const [folder, setFolder]         = useState("");
  const callbackMessage = useDropboxCallback(() => setOpen(true));
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSettings();
  const {
    data: dropboxStatus,
    isLoading: isStatusLoading,
    isFetching: isStatusFetching,
  } = useGetDropboxStatus({
    query: {
      queryKey: getGetDropboxStatusQueryKey(),
      retry: false,
      refetchInterval: 60_000,
    },
  });

  useEffect(() => {
    if (settings?.dropboxFolder) setFolder(settings.dropboxFolder);
  }, [settings?.dropboxFolder]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        toast.success("Einstellungen gespeichert");
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetDropboxStatusQueryKey(),
        });
      },
      onError: () => toast.error("Fehler beim Speichern"),
    },
  });

  const handleSave = () => {
    const trimmedFolder = folder.trim();
    if (!trimmedFolder) {
      toast.error("Bitte einen gültigen Dropbox-Pfad eingeben");
      return;
    }
    const payload: { dropboxFolder: string } = {
      dropboxFolder: trimmedFolder,
    };
    updateMutation.mutate({ data: payload });
  };

  const isConnected = dropboxStatus?.state === "connected";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          title={
            isConnected
              ? "Einstellungen – Dropbox verbunden"
              : "Einstellungen – Dropbox prüfen"
          }
        >
          <Settings2 className="h-4 w-4" />
          {dropboxStatus && (
            <span
              className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-background ${
                isConnected ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>
            Dropbox-Verbindung und Zielordner für die Rechnungserfassung.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {callbackMessage && (
            <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{callbackMessage}</p>
          )}
          <div
            className={`rounded-lg border p-3 ${
              isConnected
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {isStatusLoading || isStatusFetching ? (
                <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />
              ) : isConnected ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 text-amber-700" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {isStatusLoading
                    ? "Dropbox wird geprüft…"
                    : isConnected
                      ? "Dropbox verbunden"
                      : "Dropbox-Verbindung prüfen"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dropboxStatus?.message ??
                    "Der aktuelle Verbindungsstatus wird geladen."}
                </p>
                {dropboxStatus && (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {dropboxStatus.folder}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="Verbindung erneut prüfen"
                disabled={isStatusFetching}
                onClick={() =>
                  queryClient.invalidateQueries({
                    queryKey: getGetDropboxStatusQueryKey(),
                  })
                }
              >
                <RefreshCw
                  className={`h-4 w-4 ${isStatusFetching ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>

          {/* Dropbox folder */}
          <div className="space-y-2">
            <Label htmlFor="dropbox-folder" className="flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              Dropbox-Ordner
            </Label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lade Einstellungen…
              </div>
            ) : (
              <Input
                id="dropbox-folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="/Apps/roc.Kasse/RE-2026"
                className="font-mono text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Pfad exakt wie in Dropbox angegeben (Groß-/Kleinschreibung beachten).
            </p>
          </div>

          <DropboxAppConnection />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            Schließen
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || isLoading}
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            )}
            Ordner speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
