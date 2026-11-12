// Access token for writes made by the dashboard page itself (reports, messages).
// Only the service worker holds the session; it hands extension pages a token.
import { send, type TokenReply } from "../shared/protocol";
import { WriteError } from "./reportApi";

export async function pageToken(fresh?: boolean): Promise<string> {
  const r = await send<TokenReply>({ type: "auth:token", fresh });
  if (r && "token" in r) return r.token;
  if (r?.error === "signed_out") throw new WriteError("You're signed out of MSRC. Sign in on the portal, then try again. Your text stays here.");
  throw new WriteError(`Couldn't get an MSRC session${r ? `: ${r.error}` : ""}.`);
}

/** Ask the service worker for a sync now (e.g. to pick up what was just written). */
export const syncSoon = (): void => void send({ type: "sync:now" });
