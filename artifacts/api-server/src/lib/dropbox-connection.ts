export const DROPBOX_RECONNECT_MESSAGE =
  "Die Dropbox-Anmeldung ist abgelaufen oder wurde widerrufen. Bitte Dropbox in den Einstellungen erneut verbinden. Automatische Sync-Versuche sind pausiert.";

export class DropboxAuthError extends Error {
  readonly code = "DROPBOX_RECONNECT_REQUIRED";
  constructor() {
    super(DROPBOX_RECONNECT_MESSAGE);
    this.name = "DropboxAuthError";
  }
}

let reconnectRequired = false;
export function needsDropboxReconnect(): boolean { return reconnectRequired; }
export function resetDropboxConnection(): void { reconnectRequired = false; }
export function requireDropboxReconnect(): never {
  reconnectRequired = true;
  throw new DropboxAuthError();
}
export function assertDropboxConnection(): void {
  if (reconnectRequired) throw new DropboxAuthError();
}
export async function checkDropboxResponse(response: Response): Promise<Response> {
  if (response.status === 401) requireDropboxReconnect();
  return response;
}
