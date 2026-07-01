import { useClerk } from "@clerk/react";
import { FileText, Shield, Download } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Landing() {
  const { redirectToSignIn } = useClerk();

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-lg font-bold tracking-wider">RE2026</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Rechnungserfassung</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            KI-gestützte PDF-Rechnungserfassung und -verwaltung.<br/>
            Importieren, prüfen und exportieren Sie Rechnungen effizient.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card border border-border">
            <FileText className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">PDF Import</span>
          </div>
          <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card border border-border">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">KI-Erkennung</span>
          </div>
          <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card border border-border">
            <Download className="h-5 w-5 text-primary" />
            <span className="text-xs text-muted-foreground">CSV / Excel</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => redirectToSignIn({ redirectUrl: `${basePath}/app` })}
            className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 transition-opacity"
          >
            Anmelden
          </button>
          <a
            href={`${basePath}/sign-up`}
            className="w-full py-2.5 px-4 border border-border text-foreground font-medium rounded-md hover:bg-muted transition-colors text-center text-sm"
          >
            Konto erstellen
          </a>
        </div>
      </div>
    </div>
  );
}
