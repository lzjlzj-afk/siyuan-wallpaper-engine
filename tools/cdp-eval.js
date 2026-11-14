/* 在已连接的 Edge 页面里执行表达式并打印结果
 * 用法: node tools/cdp-eval.js "<expression>" [--json]
 */
const expr = process.argv[2];

(async () => {
  const list = await (await fetch("http://127.0.0.1:" + (process.env.CDP_PORT || "9222") + "/json/list")).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(res.result, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
