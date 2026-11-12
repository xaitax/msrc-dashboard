import { Fragment } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { PortalSettings } from "../../core/portalConfig";
import { publicCveUrl } from "../../core/publicCves";
import { errorText } from "../../shared/protocol";
import { API_ROOT } from "../../shared/urls";
import type { PortalInternals } from "../portalInfo";

// A look under the portal's hood: what msrc.microsoft.com publishes about
// itself to every visitor. Read without the researcher's session; nothing on
// this page is specific to an account.

interface Props {
  loadSettings: () => Promise<PortalSettings>;
  loadInternals: () => Promise<PortalInternals>;
}

type Loaded<T> = { ok: true; v: T } | { ok: false; error: string } | null;

const settle = <T,>(p: Promise<T>): Promise<Loaded<T>> => p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, error: errorText(e) }));

export function InternalsPage({ loadSettings, loadInternals }: Props) {
  const [settings, setSettings] = useState<Loaded<PortalSettings>>(null);
  const [internals, setInternals] = useState<Loaded<PortalInternals>>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    void Promise.all([settle(loadSettings()).then(setSettings), settle(loadInternals()).then(setInternals)]).finally(() => setBusy(false));
  }, [loadSettings, loadInternals]);
  useEffect(load, [load]);

  const s = settings?.ok ? settings.v : null;
  const x = internals?.ok ? internals.v : null;
  const c = s?.classifier;

  return (
    <main class="page page--narrow internals">
      <header class="page__head">
        <h1 class="page__title">Portal internals</h1>
        <p class="page__lead">
          What the MSRC portal publishes about itself to every visitor: its public settings file and the scripts it runs. Read from msrc.microsoft.com without your session; nothing here is about your account.
        </p>
        <button type="button" class="btn" onClick={load} disabled={busy}>
          {busy ? "Loading…" : "Reload"}
        </button>
      </header>

      {settings && !settings.ok && <p class="is-err">Settings: {settings.error}</p>}

      {c && (
        <section class="int">
          <h2>AI pre-screening</h2>
          <p class="int__lead">The model MSRC uses to judge whether a submission is an MSRC case at all, and the categories it sorts reports into.</p>
          <dl class="int__facts">
            <div>
              <dt>Model</dt>
              <dd>{c.model ?? "—"}</dd>
            </div>
            <div>
              <dt>Reasoning effort</dt>
              <dd>{c.reasoningEffort ?? "—"}</dd>
            </div>
            <div>
              <dt>Confidence needed</dt>
              <dd>{c.confidenceThreshold !== null ? `${Math.round(c.confidenceThreshold * 100)}%` : "—"}</dd>
            </div>
            <div>
              <dt>Endpoints</dt>
              <dd>
                {c.endpoints.length
                  ? c.endpoints.map((e) => (
                      <code key={e} class="block">
                        {e}
                      </code>
                    ))
                  : "—"}
              </dd>
            </div>
          </dl>
          <table class="int__table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Effect, by its name</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {c.categories.map((k) => (
                <tr key={k.name} class={k.enabled ? "" : "is-off"}>
                  <td>{k.name}</td>
                  <td>{k.closes ? "Closes the report" : "—"}</td>
                  <td>{k.enabled ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section class="int">
        <h2>Environments</h2>
        <p class="int__lead">Configurations compiled into the production portal's script, test and development included.</p>
        {internals && !internals.ok && <p class="is-err">{internals.error}</p>}
        {!internals && <p class="muted">Reading the portal's scripts…</p>}
        {x && (
          <>
            <div class="int__envs">
              {x.environments.map((e) => (
                <div key={`${e.apiRoot}|${e.clientId}|${e.signInPolicy}`} class="int__env">
                  <p class="int__env-head">
                    <code>{e.apiRoot}</code>
                    {e.apiRoot === API_ROOT && <span class="int__tag">This portal</span>}
                  </p>
                  <dl>
                    <dt>Sign-in policy</dt>
                    <dd>{e.signInPolicy ?? "—"}</dd>
                    <dt>Client id</dt>
                    <dd>
                      <code>{e.clientId ?? "—"}</code>
                    </dd>
                    <dt>Telemetry key</dt>
                    <dd>
                      <code>{e.insightsKey ?? "—"}</code>
                    </dd>
                    <dt>Support mailbox</dt>
                    <dd>{e.supportEmail ?? "—"}</dd>
                  </dl>
                </div>
              ))}
            </div>
            {x.apiHosts.length > 0 && (
              <>
                <h3>API hosts the portal accepts</h3>
                <ul class="int__hosts">
                  {x.apiHosts.map((h) => (
                    <li key={h}>
                      <code>{h}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {s && s.flags.length > 0 && (
        <section class="int">
          <h2>Feature flags</h2>
          <p class="int__lead">The portal's switches, with MSRC's own descriptions. Role and allow lists are counted, not shown.</p>
          <table class="int__table int__table--flags">
            <thead>
              <tr>
                <th>Flag</th>
                <th>Value</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {s.flags.map((f) => {
                const info = x?.flagInfo[f.key];
                return (
                  <tr key={f.key}>
                    <td>
                      <code>
                        {f.key.split("_").map((part, i) => (
                          <Fragment key={i}>
                            {i > 0 && (
                              <>
                                _<wbr />
                              </>
                            )}
                            {part}
                          </Fragment>
                        ))}
                      </code>
                    </td>
                    <td>{f.value || "—"}</td>
                    <td>{info ? `${info.label}: ${info.description}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {s && s.serverFlags.length > 0 && (
        <section class="int">
          <h2>Server switches</h2>
          <p class="int__lead">Back-end feature switches in the same file.</p>
          <ul class="int__switches">
            {s.serverFlags.map((f) => (
              <li key={f.id} class={f.enabled ? "is-on" : "is-off"}>
                <code>{f.id}</code> <span>{f.enabled ? "on" : "off"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s && s.exploited.length > 0 && (
        <section class="int">
          <h2>Marked as actively exploited</h2>
          <p class="int__lead">CVEs the Security Update Guide highlights as exploited in the wild.</p>
          <ul class="int__hosts">
            {s.exploited.map((cve) => (
              <li key={cve}>
                <a href={publicCveUrl(cve)} target="_blank" rel="noopener noreferrer">
                  {cve}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
