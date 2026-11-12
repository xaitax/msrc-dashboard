import { describe, expect, it } from "vitest";
import { loadInternals, loadSettings } from "../src/dashboard/portalInfo";

function fakeFetch(pages: Record<string, string>) {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    const body = pages[url];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const NOW = new Date("2026-11-12T12:00:00Z");

describe("the portal's public settings", () => {
  it("reads them from the portal's config file, without a token", async () => {
    const { fetch, asked } = fakeFetch({ "https://msrc.microsoft.com/config/appsettings.json": JSON.stringify({ "frontend:RP_SystemAlert_Show": "true", "frontend:RP_SystemAlert_Content": "Hello" }) });
    const s = await loadSettings(fetch, NOW);
    expect(asked).toEqual(["https://msrc.microsoft.com/config/appsettings.json"]);
    expect(s.alert?.content).toBe("Hello");
  });

  it("fails in words when the file can't be read", async () => {
    const { fetch } = fakeFetch({});
    await expect(loadSettings(fetch, NOW)).rejects.toThrow("portal settings: HTTP 404");
  });
});

describe("the portal's internals", () => {
  const BASE = "https://msrc.microsoft.com/report/vulnerability/static/js/";
  const pages = {
    "https://msrc.microsoft.com/report/vulnerability": '<html><script type="module" crossorigin src="/report/vulnerability/static/js/index.AbC_1.js"></script></html>',
    [`${BASE}index.AbC_1.js`]: 'import{a}from"./lib.X1.js";import{n as z}from"./featureFlags.F_2.js";import"./react-dom.R.js";x={apiRoot:`https://api.msrc.microsoft.com`,clientId:`c1`,authority:`https://login/B2C_1A_P`}',
    [`${BASE}lib.X1.js`]: "Ov=new Set([`api.msrc.microsoft.com`,`api-corp.example.com`])",
    [`${BASE}featureFlags.F_2.js`]: "a={NOTIFICATIONS:i(`Notifications`)};n({key:a.NOTIFICATIONS,label:`Notifications`,description:`The bell.`,type:t.Boolean})",
  };

  it("follows the page to its main script and the chunks it imports", async () => {
    const { fetch, asked } = fakeFetch(pages);
    const r = await loadInternals(fetch);
    expect(r.environments).toEqual([{ apiRoot: "https://api.msrc.microsoft.com", clientId: "c1", signInPolicy: "B2C_1A_P", insightsKey: null, supportEmail: null }]);
    expect(r.apiHosts).toEqual(["api.msrc.microsoft.com", "api-corp.example.com"]);
    expect(r.flagInfo).toEqual({ Notifications: { label: "Notifications", description: "The bell." } });
    expect(asked).not.toContain(`${BASE}react-dom.R.js`);
  });

  it("refuses a script outside the portal", async () => {
    const { fetch } = fakeFetch({ "https://msrc.microsoft.com/report/vulnerability": '<script type="module" src="https://cdn.example.com/index.A.js"></script>' });
    await expect(loadInternals(fetch)).rejects.toThrow("portal internals: main script not found");
  });
});
