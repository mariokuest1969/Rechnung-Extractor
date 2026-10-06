import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { AuthorizeDropboxAppBody, CompleteDropboxAppBody } from "@workspace/api-zod";
import { beginDropboxAuthorization, dropboxAppInfo, finishDropboxAuthorization } from "../lib/dropbox-oauth";

const router: IRouter = Router();
router.use("/settings/dropbox-app", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/settings/dropbox-app", async (_req, res) => {
  try { res.json(await dropboxAppInfo()); }
  catch { res.status(503).json({ error: "Dropbox-App-Konfiguration konnte nicht gelesen werden." }); }
});
router.post("/settings/dropbox-authorize", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = AuthorizeDropboxAppBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Bitte gültige App-Daten eingeben." }); return; }
  try {
    const redirect = new URL(parsed.data.redirectUri);
    // The return destination must be the requesting app, not a third-party site.
    if (redirect.origin !== req.headers.origin || redirect.protocol !== "https:" || redirect.search || redirect.hash || redirect.username || redirect.password) {
      res.status(400).json({ error: "Ungültige Rückkehr-Adresse. Bitte die App über HTTPS öffnen." }); return;
    }
    res.json(await beginDropboxAuthorization(parsed.data, getAuth(req).userId!));
  } catch {
    res.status(400).json({ error: "Anmeldung konnte nicht gestartet werden. Bitte App Key und App Secret prüfen." });
  }
});
router.post("/settings/dropbox-complete", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = CompleteDropboxAppBody.safeParse(req.body);
  if (!parsed.success || !/^dbx_[a-f0-9]{64}$/.test(parsed.data.state) || parsed.data.code.length > 4096) {
    res.status(400).json({ error: "Ungültige Dropbox-Antwort." }); return;
  }
  try { res.json(await finishDropboxAuthorization(parsed.data.state, parsed.data.code, getAuth(req).userId!)); }
  catch { res.status(400).json({ error: "Dropbox-Anmeldung fehlgeschlagen oder abgelaufen. Bitte erneut verbinden." }); }
});
export default router;
