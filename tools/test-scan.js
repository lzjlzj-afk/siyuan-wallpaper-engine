global.require = require;
require(require("path").join(__dirname, "..", "lib", "wp-core.js"));
const C = globalThis.WPCore;
console.log("desktop:", C.isDesktop);
(async () => {
  const items = await C.scan([], (m) => console.log("[progress]", m));
  console.log("count:", items.length);
  for (const it of items) console.log(it.id, "|", it.type, "|", it.playable, "|", it.title, "|", C.fmtSize(it.size), "|", it.preview, "|", it.pkgName || it.fileName);
})();
