// @vitest-environment happy-dom
// The case page's message box: nothing reaches MSRC without the preview popup's Send button.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageBox } from "../src/dashboard/components/MessageBox";
import { MaybeSentError, WriteError, type ReportApi } from "../src/dashboard/reportApi";

type Sent = { rn: string; body: string; topic: string | null | undefined };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => ((resolve = r), (reject = j)));
  return { promise, resolve, reject };
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};

let host: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

function fakeApi(impl: (s: Sent) => Promise<void> = async () => {}) {
  const sent: Sent[] = [];
  const api = {
    sendMessage: (rn: string, body: string, topic?: string | null) => {
      sent.push({ rn, body, topic });
      return impl({ rn, body, topic });
    },
  } as unknown as ReportApi;
  return { api, sent };
}

let sentCount = 0;
function mount(api: ReportApi, own: { body: string; createdOn: string }[] = []) {
  render(<MessageBox api={api} reportNumber="VULN-100140" caseLabel="100140" ownMessages={own} onSent={() => sentCount++} />, host);
}
const button = (re: RegExp) => [...host.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined;
const text = () => host.querySelector("#in-msg") as HTMLTextAreaElement;
async function type(v: string) {
  text().value = v;
  text().dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
}
async function pickTopic(v: string) {
  const sel = host.querySelector("#msg-topic") as HTMLSelectElement;
  sel.value = v;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
}
const dialog = () => host.querySelector("dialog[open]");

describe("message box", () => {
  it("sends nothing until the preview popup's Send button, then exactly the previewed text", async () => {
    const { api, sent } = fakeApi();
    mount(api);
    await settle();
    expect(button(/^Review and send/)!.disabled).toBe(true);
    await type("Thank you! **Quick question** about the bounty.");
    await pickTopic("Bounty");
    await act(async () => button(/^Review and send/)!.click());
    await settle();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("100140");
    expect(dialog()!.textContent).toContain("Bounty");
    expect(dialog()!.querySelector("strong")?.textContent).toBe("Quick question"); // rendered preview
    expect(sent).toHaveLength(0);

    await act(async () => button(/^Cancel$/)!.click());
    await settle();
    expect(dialog()).toBeNull();
    expect(sent).toHaveLength(0);

    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    expect(sent).toEqual([{ rn: "VULN-100140", body: "Thank you! **Quick question** about the bounty.", topic: "Bounty" }]);
  });

  it("a double click on Send sends one message", async () => {
    const hold = deferred<void>();
    const { api, sent } = fakeApi(() => hold.promise);
    mount(api);
    await settle();
    await type("Hello");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => {
      button(/^Send to MSRC$/)!.click();
      button(/^Send/)!.click();
    });
    await act(async () => hold.resolve());
    await settle();
    expect(sent).toHaveLength(1);
  });

  it("a send MSRC rejected says nothing was sent, once, and keeps the text", async () => {
    const { api, sent } = fakeApi(async () => {
      throw new WriteError("send message: HTTP 500", 400);
    });
    mount(api);
    await settle();
    await type("Keep me");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    expect(sent).toHaveLength(1);
    expect(dialog()!.textContent).toContain("HTTP 500");
    expect(dialog()!.textContent!.match(/Nothing was sent/g)).toHaveLength(1);
    expect(button(/^Send to MSRC$/)!.disabled).toBe(false); // safe to try again
    await act(async () => button(/^Cancel$/)!.click());
    await settle();
    expect(text().value).toBe("Keep me");
    expect(localStorage.getItem("msrc-dashboard:msg:VULN-100140")).toContain("Keep me");
  });

  it("keeps an unsent message when the case is closed and reopened", async () => {
    const { api } = fakeApi();
    mount(api);
    await settle();
    await type("Half-written");
    await pickTopic("Release");
    render(null, host);
    mount(api);
    await settle();
    expect(text().value).toBe("Half-written");
    expect((host.querySelector("#msg-topic") as HTMLSelectElement).value).toBe("Release");
  });

  it("moving to another case (same panel, j/k) never carries the text over", async () => {
    const { api, sent } = fakeApi();
    mount(api);
    await settle();
    await type("Meant for 100140");
    render(<MessageBox api={api} reportNumber="VULN-100100" caseLabel="100100" ownMessages={[]} onSent={() => {}} />, host);
    await settle();
    expect(text().value).toBe("");
    await type("Meant for 100100");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    expect(sent).toEqual([{ rn: "VULN-100100", body: "Meant for 100100", topic: null }]);
    mount(api); // back to 100140: its own draft is still there
    await settle();
    expect(text().value).toBe("Meant for 100140");
  });

  it("after sending: clears the box and the saved copy, says so, and asks for a sync", async () => {
    sentCount = 0;
    const { api } = fakeApi();
    mount(api);
    await settle();
    await type("Done");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    expect(dialog()).toBeNull();
    expect(text().value).toBe("");
    expect(localStorage.getItem("msrc-dashboard:msg:VULN-100140")).toBeNull();
    expect(host.textContent).toMatch(/Sent/);
    expect(sentCount).toBe(1);
  });
});

describe("a send that may have reached MSRC", () => {
  const maybe = () => fakeApi(async () => {
    throw new MaybeSentError("send message: HTTP 504");
  });

  it("doesn't offer a plain resend: it warns, keeps the text and asks for a sync", async () => {
    sentCount = 0;
    const { api, sent } = maybe();
    mount(api);
    await settle();
    await type("Thanks for the award");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    expect(dialog()!.textContent).toMatch(/may have received/i);
    expect(dialog()!.textContent).not.toMatch(/Nothing was sent/);
    expect(button(/^Send to MSRC$/)).toBeUndefined();
    expect(sentCount).toBe(1); // a sync, to find out
    await act(async () => button(/^Close$/)!.click());
    await settle();
    expect(text().value).toBe("Thanks for the award");
    expect(host.textContent).toMatch(/may already have reached MSRC/i);
    // Sending again is possible, but only as an explicit "anyway".
    await act(async () => button(/^Review and send/)!.click());
    expect(button(/^Send to MSRC$/)).toBeUndefined();
    expect(button(/^Send again anyway$/)).toBeDefined();
    expect(sent).toHaveLength(1);
  });

  it("the uncertainty survives closing the case", async () => {
    const { api } = maybe();
    mount(api);
    await settle();
    await type("Thanks for the award");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    render(null, host);
    mount(api);
    await settle();
    expect(host.textContent).toMatch(/may already have reached MSRC/i);
  });

  it("once the sync shows the message on the case, the box clears and says it was sent", async () => {
    const { api } = maybe();
    mount(api);
    await settle();
    await type("Thanks for the  award\n\nBest > regards");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => button(/^Send to MSRC$/)!.click());
    await settle();
    await act(async () => button(/^Close$/)!.click());
    // The sync brings the message back (MSRC escapes '>' and may touch whitespace).
    mount(api, [{ body: "Thanks for the award\n\nBest &gt; regards", createdOn: new Date().toISOString() }]);
    await settle();
    expect(text().value).toBe("");
    expect(localStorage.getItem("msrc-dashboard:msg:VULN-100140")).toBeNull();
    expect(host.textContent).toMatch(/Sent/);
    expect(host.textContent).not.toMatch(/may already have reached/i);
  });
});

describe("the preview popup itself", () => {
  it("puts focus on Cancel, so Enter never sends", async () => {
    const { api } = fakeApi();
    mount(api);
    await settle();
    await type("See [the advisory](https://example.com) for details");
    await act(async () => button(/^Review and send/)!.click());
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
  });

  it("if the browser closes the popup by itself, the box still works", async () => {
    const { api } = fakeApi();
    mount(api);
    await settle();
    await type("Hello");
    await act(async () => button(/^Review and send/)!.click());
    await act(async () => void (host.querySelector("dialog") as HTMLDialogElement).close());
    await settle();
    expect(dialog()).toBeNull();
    await act(async () => button(/^Review and send/)!.click());
    await settle();
    expect(dialog()).not.toBeNull();
  });
});

describe("two dashboard tabs on one case", () => {
  it("a message sent (or edited) in the other tab is reflected here, so it can't come back as a draft", async () => {
    const { api } = fakeApi();
    mount(api);
    await settle();
    await type("Thanks for the award");
    // The other tab sends it and clears the saved copy.
    localStorage.removeItem("msrc-dashboard:msg:VULN-100140");
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "msrc-dashboard:msg:VULN-100140", newValue: null })));
    await settle();
    expect(text().value).toBe("");
    expect(localStorage.getItem("msrc-dashboard:msg:VULN-100140")).toBeNull();
    // The other tab types: this one follows.
    const v = JSON.stringify({ text: "Edited elsewhere", topic: "Bounty", at: 1 });
    localStorage.setItem("msrc-dashboard:msg:VULN-100140", v);
    await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "msrc-dashboard:msg:VULN-100140", newValue: v })));
    await settle();
    expect(text().value).toBe("Edited elsewhere");
  });
});
