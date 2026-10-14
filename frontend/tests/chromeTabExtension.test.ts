import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const code = readFileSync(new URL("../../chrome-extension/background.js", import.meta.url), "utf8");
function setup() {
  let internal: Function, external: Function;
  const records: Record<string, any> = {};
  const removed: number[] = [];
  const tabs: Record<number, any> = { 7: { id: 7, url: "https://example.com/", title: "선택한 문서", active: true, windowId: 1 } };
  let demoUrl = "";
  const chrome = {
    runtime: { id: "extension-id", onMessage: { addListener: (f: Function) => { internal = f; } },
      onMessageExternal: { addListener: (f: Function) => { external = f; } } },
    storage: { session: { get: async (k: string) => ({ [k]: records[k] }),
      set: async (r: object) => Object.assign(records, r), remove: async (k: string) => { delete records[k]; } } },
    tabs: { get: async (id: number) => { if (!tabs[id]) throw new Error("missing tab"); return tabs[id]; },
      captureVisibleTab: async () => "data:image/jpeg;base64,test", create: async () => ({ id: 9 }),
      update: async (_id: number, data: { url: string }) => { demoUrl = data.url; },
      remove: async (id: number) => { removed.push(id); delete tabs[id]; }, onRemoved: { addListener: () => {} } },
  };
  runInNewContext(code, { chrome, URL, Date, crypto: { randomUUID: () => "session-secret" } });
  const send = (f: Function, message: object, sender: object): Promise<any> => new Promise(resolve => f(message, sender, resolve));
  const start = () => send(internal, { type: "START", tabId: 7, capture: true, site: "http://localhost:5173/" }, { id: "extension-id" });
  const request = (type: string, patch: object = {}, token = "session-secret") => send(external, { type, token },
    { tab: { id: 9 }, url: demoUrl, frameId: 0, ...patch });
  return { start, request, removed, tabs };
}
describe("Chrome tab bridge", () => {
  it("loads the selected screenshot and closes only the bound target once", async () => {
    const m = setup(); expect((await m.start()).ok).toBe(true);
    const loaded = await m.request("LOAD");
    expect(loaded.title).toBe("선택한 문서"); expect(loaded.screenshot).toContain("data:image/jpeg");
    expect((await m.request("CLOSE")).ok).toBe(true);
    expect(m.removed).toEqual([7]);
    expect((await m.request("CLOSE")).ok).toBe(false);
    expect(m.removed).toEqual([7]);
  });
  it("rejects a different demo tab, frame, origin, or session", async () => {
    const m = setup(); await m.start();
    expect((await m.request("CLOSE", { tab: { id: 10 } })).ok).toBe(false);
    expect((await m.request("CLOSE", { frameId: 1 })).ok).toBe(false);
    expect((await m.request("CLOSE", { url: "https://unrelated.example/" })).ok).toBe(false);
    expect((await m.request("CLOSE", {}, "wrong")).ok).toBe(false);
    expect(m.removed).toEqual([]);
  });
  it("does not close a tab which has navigated after selection", async () => {
    const m = setup(); await m.start(); m.tabs[7].url = "https://example.com/another";
    expect((await m.request("CLOSE")).ok).toBe(false);
    expect(m.removed).toEqual([]);
  });
});
