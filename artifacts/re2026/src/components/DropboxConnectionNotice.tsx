import { Button } from "@/components/ui/button";

export function DropboxConnectionNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950">
      <p className="font-semibold">Dropbox erneut verbinden</p>
      <p className="mt-1 text-sm">{message}</p>
      <Button className="mt-3" variant="outline" size="sm"
        onClick={() => window.dispatchEvent(new Event("open-dropbox-settings"))}>
        Dropbox-Einstellungen öffnen
      </Button>
    </div>
  );
}
