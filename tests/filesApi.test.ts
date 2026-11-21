import { afterEach, describe, expect, it, vi } from "vitest";
import { msrcApi } from "../src/background/api";

vi.mock("../src/background/auth", () => ({
  getAccessToken: async () => "test-token",
  invalidateAccessToken: async () => {},
}));

const API = "https://api.msrc.microsoft.com";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const file = (id: string, name: string, createdOn: string, reportId = "VULN-244632") => ({ id, name, createdOn, reportId, uploadStatus: "completed" });

afterEach(() => vi.unstubAllGlobals());

describe("portal file history", () => {
  it("reads later uploads with repeated names from every reportId page", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("Authorization") });
      return seen.length === 1
        ? json({
            value: [
              file("old-arm", "arm64.zip", "2026-10-18T19:09:54Z"),
              file("old-x64", "x64.zip", "2026-10-18T19:09:56Z"),
              file("video", "demo.mp4", "2026-10-18T19:10:02Z"),
            ],
            "@odata.nextLink": `${API}/portal/v2.0/file?$skip=3`,
          })
        : json({
            value: [
              file("new-arm", "arm64.zip", "2026-10-19T10:40:00Z"),
              file("new-x64", "x64.zip", "2026-10-19T10:40:01Z"),
              file("wrong-case", "other.zip", "2026-10-19T10:40:02Z", "VULN-1"),
            ],
          });
    });

    const files = await msrcApi.listFiles("VULN-244632");
    expect(files.map((f) => f.id)).toEqual(["old-arm", "old-x64", "video", "new-arm", "new-x64"]);
    expect(files.filter((f) => f.name === "arm64.zip")).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(new URL(seen[0]!.url).searchParams.get("$filter")).toBe("reportId eq 'VULN-244632'");
    expect(new URL(seen[0]!.url).searchParams.get("$top")).toBe("50");
    expect(seen.every((r) => r.auth === "Bearer test-token")).toBe(true);
  });

  it("never follows a file pagination link to another host", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      return json({ value: [], "@odata.nextLink": "https://example.invalid/steal" });
    });
    await expect(msrcApi.listFiles("VULN-244632")).rejects.toThrow(/invalid pagination URL/);
    expect(seen).toHaveLength(1);
  });
});
