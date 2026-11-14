/* 通过 CDP 打开页面、等待就绪并截图
 * 用法: node tools/shot.js <url> <out.png> [waitMs]
 */
const fs = require("fs");

const url = process.argv[2];
const out = process.argv[3];
const waitMs = parseInt(process.argv[4] || "9000", 10);

(async () => {
  const list = await (await fetch("http://127.0.0.1:" + (process.env.CDP_PORT || "9222") + "/json/list")).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  const logs = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXCEPTION " + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  const width = parseInt(process.argv[5] || "1600", 10);
  const height = parseInt(process.argv[6] || "1000", 10);
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });

  const deadline = Date.now() + waitMs;
  let ready = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await send("Runtime.evaluate", {
      expression: "JSON.stringify({ready: !!window.__ready, err: window.__err || null, log: (document.getElementById('log')||{}).textContent || ''})",
      returnByValue: true,
    });
    const v = r.result?.result?.value;
    if (v) {
      try {
        const st = JSON.parse(v);
        if (st.err) { logs.push("PAGE ERR " + st.err); break; }
        if (st.ready) { ready = true; logs.push(st.log); break; }
      } catch (e) {}
    }
  }

  if (!ready) {
    const r = await send("Runtime.evaluate", {
      expression: "JSON.stringify({err: window.__err||null, log: (document.getElementById('log')||{}).textContent||''})",
      returnByValue: true,
    });
    try { logs.push(JSON.parse(r.result.result.value).log); } catch (e) {}
  }

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("ready:", ready);
  console.log(logs.join("\n").slice(-3000));
  ws.close();
  process.exit(ready ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
