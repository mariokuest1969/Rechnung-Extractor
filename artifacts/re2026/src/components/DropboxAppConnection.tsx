import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  authorizeDropboxApp, completeDropboxApp, useGetDropboxApp,
  getGetDropboxAppQueryKey, getGetDropboxStatusQueryKey, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function useDropboxCallback(onReturn: () => void) {
  const [message, setMessage] = useState("");
  const started = useRef(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (started.current) return;
    const url = new URL(window.location.href);
    const state = url.searchParams.get("state");
    if (!state?.startsWith("dbx_")) return;
    started.current = true;
    const code = url.searchParams.get("code");
    const denied = url.searchParams.get("error");
    ["code", "state", "error", "error_description"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    onReturn();
    if (denied || !code) {
      const text = "Dropbox-Anmeldung abgebrochen. Die bisherige Verbindung bleibt erhalten.";
      setMessage(text);
      toast.error(text);
      return;
    }
    setMessage("Dropbox-Verbindung wird gespeichert…");
    toast.promise(completeDropboxApp({ code, state }).then(async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetDropboxAppQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDropboxStatusQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() }),
      ]);
      setMessage("Dropbox-Anmeldung gespeichert. Den Status des Zielordners siehst du unten.");
    }).catch((error) => {
      setMessage("Dropbox-Anmeldung fehlgeschlagen oder abgelaufen. Bitte erneut verbinden.");
      throw error;
    }), {
      loading: "Dropbox-Verbindung wird gespeichert…",
      success: "Dropbox-Anmeldung gespeichert. Der Zielordner wird jetzt geprüft.",
      error: "Dropbox-Anmeldung fehlgeschlagen oder abgelaufen. Bitte erneut verbinden.",
    });
  }, [queryClient, onReturn]);
  return message;
}

export function DropboxAppConnection() {
  const { data, isLoading, isError } = useGetDropboxApp();
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const redirectUri = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/app`, window.location.origin).href;
  useEffect(() => { if (data) setAppKey(data.appKey); }, [data]);

  async function connect() {
    // Open synchronously from the click: Dropbox cannot be embedded in the preview iframe.
    const loginWindow = window.open("about:blank", "_blank");
    if (!loginWindow) {
      toast.error("Bitte Pop-ups für diese App erlauben und erneut verbinden.");
      return;
    }
    loginWindow.opener = null;
    setBusy(true);
    try {
      const result = await authorizeDropboxApp({
        appKey: appKey.trim(),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        redirectUri,
      });
      setAppSecret("");
      loginWindow.location.href = result.url;
      setBusy(false);
      toast.info("Die Anmeldung läuft im neuen Tab. Nach der Freigabe kehrst du dort zur App zurück.");
    } catch {
      loginWindow.close();
      toast.error("Verbindung konnte nicht gestartet werden. Bitte App Key und App Secret prüfen.");
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Dropbox-App verbinden">
      <p className="text-sm font-semibold">Mit eigener Dropbox-App verbinden</p>
      <div className="space-y-1">
        <Label htmlFor="dropbox-app-key">App Key</Label>
        <Input id="dropbox-app-key" value={appKey} onChange={(e) => setAppKey(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy || isLoading} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dropbox-app-secret">App Secret</Label>
        <Input id="dropbox-app-secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} autoComplete="new-password" spellCheck={false} disabled={busy || isLoading}
          placeholder={data?.configured ? "Hinterlegt – leer lassen zum Beibehalten" : "Dropbox App Secret eingeben"} />
      </div>
      <p className="text-xs text-muted-foreground">
        Einmalig in der <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" className="underline">Dropbox App Console</a> unter OAuth 2 → Redirect URIs diese Rückkehr-Adresse hinzufügen:
      </p>
      <Input aria-label="Dropbox Rückkehr-Adresse" readOnly value={redirectUri} className="text-xs" />
      <Button type="button" variant="outline" size="sm" onClick={() => {
        navigator.clipboard.writeText(redirectUri).then(() => toast.success("Adresse kopiert")).catch(() => toast.error("Bitte die Adresse markieren und kopieren."));
      }}>Adresse kopieren</Button>
      <p className="text-xs text-muted-foreground">
        Die Dropbox-App benötigt Zugriff auf den Zielordner sowie die Berechtigungen
        {" "}files.metadata.read und files.content.read. Für Ordner außerhalb des App-Ordners ist „Full Dropbox“ erforderlich.
      </p>
      {isError && <p role="alert" className="text-xs text-destructive">Gespeicherte App-Daten konnten nicht geladen werden. Bitte die Seite neu laden.</p>}
      <Button type="button" className="w-full" disabled={busy || isLoading || isError || !appKey.trim() || (!appSecret.trim() && !(data?.configured && appKey.trim() === data.appKey))} onClick={connect}>
        {busy ? "Weiter zu Dropbox…" : data?.configured ? "Dropbox erneut verbinden" : "Mit Dropbox verbinden"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Dropbox öffnet sich in einem neuen Tab. Dort anmelden und Zugriff erlauben. Danach wird der Zugriff automatisch erneuert.
        Das App Secret wird verschlüsselt gespeichert und nicht wieder angezeigt.
        Eine bestehende Verbindung wird erst nach erfolgreicher Anmeldung ersetzt.
      </p>
    </section>
  );
}
