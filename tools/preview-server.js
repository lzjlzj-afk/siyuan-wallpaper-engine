/* 本地预览服务：静态托管插件目录 + 壁纸库（供无头浏览器实测渲染） */
global.require = require;
require("../lib/wp-core.js");
const http = require("http");
const fs = require("fs");
const path = require("path");

const C = globalThis.WPCore;
const ROOT = path.resolve(__dirname, "..");

(async () => {
  const items = await C.scan([], () => {});
  const map = new Map(items.map((it) => [it.id, it]));
  const port = 7801;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    let p = decodeURIComponent(u.pathname);
    if (p === "/") p = "/tools/harness.html";

    if (p === "/api/items") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(
        JSON.stringify(
          items.map((it) => ({
            id: it.id,
            type: it.type,
            typeLabel: it.typeLabel,
            title: it.title,
            kindLabel: it.kindLabel,
            preview: it.preview,
            pkgName: it.pkgName,
            fileName: it.fileName,
            size: it.size,
            playable: it.playable,
            project: it.project,
          }))
        )
      );
      return;
    }

    if (p.startsWith("/wp/")) {
      const rest = p.slice(4);
      const [id, ...tail] = rest.split("/");
      const item = map.get(id);
      if (!item) {
        res.writeHead(404);
        res.end("no item");
        return;
      }
      const target = path.resolve(item.dir, tail.join("/") || ".");
      const rootDir = path.resolve(item.dir);
      if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        res.writeHead(404);
        res.end("no file");
        return;
      }
      const stat = fs.statSync(target);
      const ext = path.extname(target).toLowerCase();
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".js": "text/javascript",
          ".pkg": "application/octet-stream",
          ".mp4": "video/mp4",
          ".webm": "video/webm",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".tex": "application/octet-stream",
        }[ext] || "application/octet-stream";
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m[1] === "" ? 0 : parseInt(m[1], 10);
        let end = m[2] === "" ? stat.size - 1 : parseInt(m[2], 10);
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": end - start + 1,
          "Access-Control-Allow-Origin": "*",
        });
        fs.createReadStream(target, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size, "Access-Control-Allow-Origin": "*" });
      fs.createReadStream(target).pipe(res);
      return;
    }

    const target = path.resolve(ROOT, "." + p);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const mime =
      { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json" }[ext] ||
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(target).pipe(res);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`preview: http://127.0.0.1:${port}/`);
    for (const it of items) console.log(`  ${it.id}\t${it.type}\t${it.title}`);
  });
})();
