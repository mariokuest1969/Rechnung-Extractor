import { StatsBar } from "@/components/StatsBar";
import { UploadZone } from "@/components/UploadZone";
import { InvoiceTable } from "@/components/InvoiceTable";
import { NoticeBanner } from "@/components/NoticeBanner";
import { SettingsDialog } from "@/components/SettingsDialog";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Download } from "lucide-react";

export default function Home() {
  const { canInstall, install } = usePWAInstall();

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <NoticeBanner />

      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="bg-primary text-primary-foreground p-1 rounded text-xs px-2 tracking-wider">RE2026</span>
            Rechnungserfassung
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Schnelle KI-basierte PDF-Verarbeitung</p>
        </div>
        <div className="flex items-center gap-2">
          {canInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary transition-colors"
              title="Als Desktop-App installieren"
            >
              <Download className="h-3.5 w-3.5" />
              App installieren
            </button>
          )}
          <SettingsDialog />
        </div>
      </header>

      <main className="flex-1 p-6 max-w-[1600px] w-full mx-auto space-y-6">
        <StatsBar />
        <UploadZone />
        <InvoiceTable />
      </main>
    </div>
  );
}
