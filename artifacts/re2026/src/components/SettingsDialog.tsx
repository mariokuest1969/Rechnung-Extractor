import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2, Loader2, FolderOpen, KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react";
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

export function SettingsDialog() {
  const [open, setOpen]             = useState(false);
  const [folder, setFolder]         = useState("");
  const [token, setToken]           = useState("");
  const [showToken, setShowToken]   = useState(false);
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSettings();

  useEffect(() => {
    if (settings?.dropboxFolder) setFolder(settings.dropboxFolder);
    // Token is write-only from the UI — we never display the actual value
    setToken("");
  }, [settings?.dropboxFolder]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        toast.success("Einstellungen gespeichert");
        queryClient.invalidateQueries({ queryKey: ["getSettings"] });
        setToken("");
        setShowToken(false);
        setOpen(false);
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
    const payload: { dropboxFolder: string; dropboxToken?: string | null } = {
      dropboxFolder: trimmedFolder,
    };
    // Only send token if the field was touched
    if (token !== "") {
      payload.dropboxToken = token.trim() || null;
    }
    updateMutation.mutate({ data: payload });
  };

  const tokenConfigured = settings?.dropboxTokenConfigured ?? false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" title="Einstellungen">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>
            Dropbox-Ordner und optionaler API-Token für die Rechnungserfassung.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">

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

          {/* Dropbox API token */}
          <div className="space-y-2">
            <Label htmlFor="dropbox-token" className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              Dropbox API-Token
              {tokenConfigured && (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-normal">
                  <CheckCircle2 className="h-3 w-3" />
                  Konfiguriert
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="dropbox-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tokenConfigured ? "Neuen Token eingeben zum Überschreiben" : "sl.xxxxxxxxxxxxxxxx…"}
                className="font-mono text-sm pr-9"
                autoComplete="off"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Persönlicher Dropbox-Token aus{" "}
              <a
                href="https://www.dropbox.com/developers/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                dropbox.com/developers/apps
              </a>
              . Leer lassen, um den bestehenden Token beizubehalten. Leerzeichen eingeben + Speichern, um ihn zu löschen.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); setToken(""); setShowToken(false); }}>
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || isLoading}
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            )}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
