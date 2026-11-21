// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCaseWorkspace } from "../src/dashboard/components/LocalCaseWorkspace";
import { _resetForTests, getCaseAnnotations } from "../src/store/db";

let host: HTMLElement;
beforeEach(async () => {
  await _resetForTests();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};

describe("local case workspace", () => {
  it("saves Unicode tags and notes locally, suggests tags, and removes a tag", async () => {
    let changes = 0;
    let selected = "";
    render(<LocalCaseWorkspace annotation={{ reportNumber: "VULN-1", note: "", tags: [] }} knownTags={["WPR", "驱动程序"]} onChanged={() => changes++} onSelectTag={(tag) => { selected = tag; }} />, host);
    expect(host.querySelector("#local-case-note")).toBeNull();
    ([...host.querySelectorAll("button")].find((b) => b.textContent === "Add note or tags") as HTMLButtonElement).click();
    await settle();
    expect((host.querySelector("#local-tag-suggestions option") as HTMLOptionElement).value).toBe("WPR");

    const input = host.querySelector("#local-tag-input") as HTMLInputElement;
    input.value = "🔐 驱动程序";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect((await getCaseAnnotations())[0]!.tags).toEqual(["🔐 驱动程序"]);
    expect(changes).toBe(1);

    const note = host.querySelector("#local-case-note") as HTMLTextAreaElement;
    note.value = "Check the WPR service — é, 中文, 🔐";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect((await getCaseAnnotations())[0]!.note).toBe("Check the WPR service — é, 中文, 🔐");

    (host.querySelector('.dialog--local .btn--primary') as HTMLButtonElement).click();
    await settle();
    expect(host.querySelector("dialog")).toBeNull();
    (host.querySelector('.case-local .local-tag--selectable') as HTMLButtonElement).click();
    expect(selected).toBe("🔐 驱动程序");

    (host.querySelector('.case-local__edit') as HTMLButtonElement).click();
    await settle();

    (host.querySelector('[aria-label="Remove tag 🔐 驱动程序"]') as HTMLButtonElement).click();
    await settle();
    expect(await getCaseAnnotations()).toEqual([{ reportNumber: "VULN-1", note: "Check the WPR service — é, 中文, 🔐", tags: [] }]);
  });
});
