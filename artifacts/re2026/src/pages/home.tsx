import { StatsBar } from "@/components/StatsBar";
import { UploadZone } from "@/components/UploadZone";
import { InvoiceTable } from "@/components/InvoiceTable";
import { NoticeBanner } from "@/components/NoticeBanner";
import { SettingsDialog } from "@/components/SettingsDialog";

export default function Home() {
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
        <SettingsDialog />
      </header>

      <main className="flex-1 p-6 max-w-[1600px] w-full mx-auto space-y-6">
        <StatsBar />
        <UploadZone />
        <InvoiceTable />
      </main>
    </div>
  );
}
