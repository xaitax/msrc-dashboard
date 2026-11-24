// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseDetails, ReleaseNotice } from "../src/dashboard/components/ReleaseUpdate";
import { useReleaseUpdate } from "../src/dashboard/useReleaseUpdate";
import type { ReleaseCheck } from "../src/shared/release";

const sendMessage = vi.fn<() => Promise<ReleaseCheck | undefined>>();
function Harness() {
  const update = useReleaseUpdate();
  return <><ReleaseNotice update={update} /><ReleaseDetails update={update} /></>;
}

async function mount() {
  act(() => render(<Harness />, document.body));
  await act(async () => {});
}
const unmount = () => act(() => render(null, document.body));
async function manualCheck() {
  act(() => document.querySelector<HTMLButtonElement>(".profile-release button")!.click());
  await act(async () => {});
}
const notice = () => document.querySelector(".release-notice");
const status = () => document.querySelector('[role="status"]')?.textContent;
const nextRelease = (latestTag: string) => sendMessage.mockResolvedValue({ latestTag, checkedAt: Date.now(), unavailable: false });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.4.0" }), sendMessage } });
});
afterEach(() => {
  unmount();
  sendMessage.mockReset();
  vi.unstubAllGlobals();
});

describe("GitHub release notices", () => {
  it("shows newer releases and remembers precisely which release was dismissed", async () => {
    nextRelease("v0.5.0");
    await mount();
    expect(notice()?.textContent).toContain("v0.5.0");
    await act(async () => { notice()!.querySelector("button")!.click(); });
    unmount();
    await mount();
    expect(notice()).toBeNull();
    expect(document.querySelector<HTMLAnchorElement>(".profile-release a")?.href).toBe("https://github.com/xaitax/msrc-dashboard/releases/tag/v0.5.0");
    nextRelease("v0.6.0");
    await manualCheck();
    expect(notice()?.textContent).toContain("v0.6.0");
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "release:check", force: true });
  });

  it("keeps a failed check distinct from a current installation", async () => {
    nextRelease("v0.4.0");
    await mount();
    expect(notice()).toBeNull();
    expect(status()).toBe("You’re up to date.");
    sendMessage.mockResolvedValue(undefined);
    await manualCheck();
    expect(notice()).toBeNull();
    expect(status()).toContain("Couldn’t check GitHub");
  });
});
