import { Info, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useHealthCheck } from "@workspace/api-client-react";

export function NoticeBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useHealthCheck();

  if (dismissed) return null;

  if (data?.openaiConfigured) {
    return (
      <div className="bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 px-4 py-2 text-sm flex items-center justify-center w-full border-b border-green-100 dark:border-green-900/50">
        <CheckCircle className="h-4 w-4 mr-2 flex-shrink-0" />
        <span>
          <strong>OpenAI aktiv:</strong> KI-gestützte Rechnungserkennung ist eingeschaltet (gpt-4o-mini).
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-4 text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-blue-200 underline text-xs font-medium"
        >
          Ausblenden
        </button>
      </div>
    );
  }

  if (data && !data.openaiConfigured) {
    return (
      <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 px-4 py-3 text-sm flex items-center justify-center w-full border-b border-blue-100 dark:border-blue-900/50">
        <Info className="h-4 w-4 mr-2 flex-shrink-0" />
        <span>
          <strong>Hinweis:</strong> Kein OpenAI API-Key konfiguriert. Texterkennung läuft im Basis-Modus (Regex).
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200 underline text-xs font-medium"
        >
          Ausblenden
        </button>
      </div>
    );
  }

  return null;
}
