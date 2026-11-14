/* 对当前页面截图（不导航）
 * 用法: node tools/shot-current.js <out.png> [waitMs] [width] [height]
 */
const fs = require("fs");
const out = process.argv[2];
const waitMs = parseInt(process.argv[3] || "1500", 10);
const width = parseInt(process.argv[4] || "1600", 10);
const height = parseInt(process.argv[5] || "1000", 10);

(async () => {
  const port = process.env.CDP_PORT || "9222";
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXCEPTION " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, waitMs));
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(logs.slice(-20).join("\n"));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
