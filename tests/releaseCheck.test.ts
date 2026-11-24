import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRelease } from "../src/background/releaseCheck";
import { isNewerRelease, releaseUrl } from "../src/shared/release";
import { installChromeShim } from "./chromeShim";

const endpoint = "https://api.github.com/repos/xaitax/msrc-dashboard/releases/latest";
const minute = 60_000;
const day = 24 * 60 * minute;
const tag = "v0.10.0";
const release = { tag_name: tag, draft: false, prerelease: false };

describe("release version", () => {
  it("compares Chromium version components numerically, including a fourth component and omitted zeros", () => {
    expect(isNewerRelease(tag, "0.9.9")).toBe(true);
    expect(isNewerRelease("0.9.9", "0.10")).toBe(false);
    expect(isNewerRelease("v2.1.0.0", "2.1")).toBe(false);
    expect(isNewerRelease("v2.1.0.1", "2.1")).toBe(true);
    for (const invalid of ["v0.0.0", "v1.02", "v1.0.0-beta", "v1.0.0+main", "v65536", "v2.3.4.5.6", "v1.0\n", "v1.0\r", "v1.0\u2028", "main"]) {
      expect(isNewerRelease(invalid, "0.1")).toBe(false);
      expect(isNewerRelease(tag, invalid)).toBe(false);
    }
  });

  it("derives the link from the project and the validated tag", () => {
    expect(releaseUrl(tag)).toBe("https://github.com/xaitax/msrc-dashboard/releases/tag/v0.10.0");
    expect(releaseUrl("../../../other")).toBe("https://github.com/xaitax/msrc-dashboard/releases");
  });
});

describe("public release lookup", () => {
  let now: number;
  let network = vi.fn<typeof fetch>();
  beforeEach(() => {
    installChromeShim();
    now = Date.UTC(2026, 10, 24);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    network = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(release)));
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shares concurrent requests and caches the public result for a day", async () => {
    const checkedAt = now;
    const requests = await Promise.all([checkRelease(), checkRelease(true)]);
    expect(requests).toEqual(Array(2).fill({ latestTag: tag, checkedAt, unavailable: false }));
    expect(network).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store",
    }));
    now += day - 1;
    expect((await checkRelease()).checkedAt).toBe(checkedAt);
    now += 1;
    expect((await checkRelease()).checkedAt).toBe(now);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("keeps the last success offline and permits a manual retry before the automatic one", async () => {
    const previous = await checkRelease();
    now += day;
    network.mockRejectedValueOnce(new TypeError("offline"));
    expect(await checkRelease()).toEqual({ ...previous, unavailable: true });
    expect((await checkRelease(true)).unavailable).toBe(true);
    now += minute;
    expect((await checkRelease()).unavailable).toBe(true);
    expect(await checkRelease(true)).toEqual({ latestTag: tag, checkedAt: now, unavailable: false });
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("refreshes on a manual click while another tab reads a still-valid automatic cache", async () => {
    await checkRelease();
    now += 3 * 60 * minute;
    network.mockClear();
    network.mockResolvedValueOnce(Response.json({ ...release, tag_name: "v0.11.0" }));
    const [, manual, secondManual] = await Promise.all([checkRelease(), checkRelease(true), checkRelease(true)]);
    expect(manual.latestTag).toBe("v0.11.0");
    expect(secondManual).toEqual(manual);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, { "retry-after": "600" }],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((Date.UTC(2026, 10, 24) + 10 * minute) / 1000) }],
  ] as const)("honors GitHub's %s rate-limit deadline even after a manual click", async (status, headers) => {
    network.mockResolvedValueOnce(new Response(null, { status, headers }));
    expect((await checkRelease()).unavailable).toBe(true);
    now += 10 * minute - 1;
    expect((await checkRelease(true)).unavailable).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
    now += 1;
    expect((await checkRelease(true)).unavailable).toBe(false);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: "weekly" },
    { tag_name: tag },
  ])("ignores an unrecognized or unpublished release and retries automatically", async (invalid) => {
    network.mockResolvedValueOnce(Response.json(invalid));
    expect(await checkRelease()).toEqual({ latestTag: null, checkedAt: null, unavailable: true });
    now += 15 * minute;
    expect((await checkRelease()).latestTag).toBe(tag);
  });

  it("returns the live result when extension storage fails", async () => {
    const storage = installChromeShim().storage.local;
    vi.spyOn(storage, "get").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(storage, "set").mockRejectedValue(new Error("unavailable"));
    expect(await checkRelease()).toEqual({ latestTag: tag, checkedAt: now, unavailable: false });
  });
});
