import { useState } from "react";
import {
  useListLieferanten,
  useCreateLieferant,
  useUpdateLieferant,
  useDeleteLieferant,
  getListLieferantenQueryKey,
  Lieferant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface EditState {
  id: number | null;
  name: string;
  kuerzel: string;
  steuernummer: string;
}

const EMPTY: EditState = { id: null, name: "", kuerzel: "", steuernummer: "" };

export function LieferantenDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { data: lieferanten = [] } = useListLieferanten();
  const [editing, setEditing] = useState<EditState | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListLieferantenQueryKey() });

  const createMutation = useCreateLieferant({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast.success("Lieferant angelegt"); },
      onError: () => toast.error("Fehler beim Anlegen"),
    },
  });

  const updateMutation = useUpdateLieferant({
    mutation: {
      onSuccess: () => { invalidate(); setEditing(null); toast.success("Lieferant gespeichert"); },
      onError: () => toast.error("Fehler beim Speichern"),
    },
  });

  const deleteMutation = useDeleteLieferant({
    mutation: {
      onSuccess: () => { invalidate(); toast.success("Lieferant gelöscht"); },
      onError: () => toast.error("Fehler beim Löschen"),
    },
  });

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    const body = {
      name: editing.name.trim(),
      kuerzel: editing.kuerzel.trim() || null,
      steuernummer: editing.steuernummer.trim() || null,
    };
    if (editing.id === null) {
      createMutation.mutate({ data: body });
    } else {
      updateMutation.mutate({ id: editing.id, data: body });
    }
  };

  const fromLieferant = (l: Lieferant): EditState => ({
    id: l.id,
    name: l.name,
    kuerzel: l.kuerzel ?? "",
    steuernummer: l.steuernummer ?? "",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lieferantenverzeichnis</DialogTitle>
        </DialogHeader>

        {/* New / Edit form */}
        {editing !== null ? (
          <div className="space-y-3 border border-border rounded-md p-4 bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">
              {editing.id === null ? "Neuer Lieferant" : "Lieferant bearbeiten"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Firmenname"
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              </div>
              <div>
                <Label className="text-xs">Kürzel</Label>
                <Input
                  value={editing.kuerzel}
                  onChange={(e) => setEditing({ ...editing, kuerzel: e.target.value })}
                  placeholder="z.B. MUSTER"
                />
              </div>
              <div>
                <Label className="text-xs">Steuernummer</Label>
                <Input
                  value={editing.steuernummer}
                  onChange={(e) => setEditing({ ...editing, steuernummer: e.target.value })}
                  placeholder="z.B. 123/456/78901"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                <X className="h-4 w-4 mr-1" /> Abbrechen
              </Button>
              <Button size="sm" onClick={save} disabled={!editing.name.trim()}>
                <Check className="h-4 w-4 mr-1" /> Speichern
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setEditing(EMPTY)}
          >
            <Plus className="h-4 w-4 mr-1" /> Neuer Lieferant
          </Button>
        )}

        {/* List */}
        <div className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-md">
          {lieferanten.length === 0 && (
            <p className="text-sm text-muted-foreground p-4 text-center">Noch keine Lieferanten</p>
          )}
          {lieferanten.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{l.name}</p>
                {(l.kuerzel || l.steuernummer) && (
                  <p className="text-xs text-muted-foreground">
                    {[l.kuerzel, l.steuernummer].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                onClick={() => setEditing(fromLieferant(l))}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate({ id: l.id })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
