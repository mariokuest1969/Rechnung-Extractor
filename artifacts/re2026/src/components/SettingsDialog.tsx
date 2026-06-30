import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2, Loader2, FolderOpen } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSettings();

  useEffect(() => {
    if (settings?.dropboxFolder) {
      setFolder(settings.dropboxFolder);
    }
  }, [settings?.dropboxFolder]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: (data) => {
        toast.success("Einstellungen gespeichert");
        queryClient.invalidateQueries({ queryKey: ["getSettings"] });
        setFolder(data.dropboxFolder);
        setOpen(false);
      },
      onError: () => toast.error("Fehler beim Speichern"),
    },
  });

  const handleSave = () => {
    const trimmed = folder.trim();
    if (!trimmed) {
      toast.error("Bitte einen gültigen Dropbox-Pfad eingeben");
      return;
    }
    updateMutation.mutate({ data: { dropboxFolder: trimmed } });
  };

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
            Konfigurieren Sie den Dropbox-Ordner, der automatisch auf neue PDF-Rechnungen überwacht wird.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
              Der Pfad muss exakt so eingegeben werden, wie er in Dropbox erscheint (Groß-/Kleinschreibung beachten).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
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
