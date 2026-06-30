import { Info } from "lucide-react";
import { useState } from "react";

export function NoticeBanner() {
  const [visible, setVisible] = useState(true);
  
  // Im echten System würden wir den Status vom Backend abfragen.
  // Hier zeigen wir den Banner initial an.
  
  if (!visible) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 px-4 py-3 text-sm flex items-center justify-center w-full border-b border-blue-100 dark:border-blue-900/50">
      <Info className="h-4 w-4 mr-2 flex-shrink-0" />
      <span>
        <strong>Hinweis:</strong> Kein OpenAI API-Key konfiguriert. Texterkennung läuft im Basis-Modus (Regex).
      </span>
      <button 
        onClick={() => setVisible(false)}
        className="ml-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200 underline text-xs font-medium"
      >
        Ausblenden
      </button>
    </div>
  );
}
