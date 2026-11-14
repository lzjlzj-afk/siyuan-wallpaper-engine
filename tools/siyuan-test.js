/* 在真实思源页面上注入背景层 + 样式，验证 CSS 与渲染效果 */
const fs = require("fs");

const out = process.argv[2] || require("path").join(__dirname, "..", "dist", "shot-siyuan.png");
const theme = process.argv[3] || "auto";

const inject = String.raw`
(async () => {
  const ASSET = "http://127.0.0.1:7801";
  const addCss = (href) => new Promise((r) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; l.onload = r; l.onerror = r; document.head.appendChild(l); });
  await addCss(ASSET + "/index.css");
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = ASSET + "/lib/webwallgl.global.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  document.getElementById("wpgl-bg")?.remove();
  const bg = document.createElement("div");
  bg.id = "wpgl-bg";
  bg.innerHTML = '<div id="wpgl-stage"></div><div id="wpgl-scrim"></div>';
  document.body.insertBefore(bg, document.body.firstChild);

  const dark = document.documentElement.getAttribute("data-theme-mode") !== "light";
  const st = document.documentElement.style;
  st.setProperty("--wpgl-scrim", "0.22");
  st.setProperty("--wpgl-blur", "18px");
  st.setProperty("--wpgl-glass", "0.55");
  st.setProperty("--wpgl-glass-rgb", dark ? "22, 25, 32" : "255, 255, 255");
  st.setProperty("--wpgl-veil", "0.28");
  document.documentElement.classList.add("wpgl-on");

  const base = ASSET + "/wp/workshop-0-1195626192";
  const project = await (await fetch(base + "/project.json")).json();
  const ab = await (await fetch(base + "/scene.pkg")).arrayBuffer();
  window.__inst = await WebWallGL.mount(document.getElementById("wpgl-stage"), {
    source: WebWallGL.bytesSource(ab, project, "test"),
    fit: "cover", fps: 30, renderDpr: 1.5, autoplay: true, volume: 0, mountTimeoutMs: 150000,
  });
  await new Promise((r) => setTimeout(r, 1800));
  return "ok";
})()
`;

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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:6806/" });
  await new Promise((r) => setTimeout(r, 7000));
  if (theme === "light" || theme === "dark") {
    await send("Runtime.evaluate", { expression: `document.documentElement.setAttribute('data-theme-mode','${theme}')` });
  }
  const res = await send("Runtime.evaluate", { expression: inject, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(res.result && res.result.result));
  await new Promise((r) => setTimeout(r, 2500));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
