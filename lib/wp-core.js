/*!
 * 思源壁纸引擎 · 核心
 * SiYuan Wallpaper Engine - core (scan / local http / WebWallGL mount)
 *
 * MIT License
 * 场景壁纸渲染由 WebWallGL 提供（MIT，https://github.com/oneincase/webwallgl）。
 */
(function (global) {
  "use strict";

  const VERSION = "0.1.0";
  const WORKSHOP_APP_ID = "431960"; // Wallpaper Engine

  // ---------------------------------------------------------------- node 能力

  function nodeRequire(name) {
    try {
      if (typeof window !== "undefined" && typeof window.require === "function") {
        return window.require(name);
      }
      if (typeof global.require === "function") {
        return global.require(name);
      }
    } catch (e) {
      /* 浏览器环境没有 node */
    }
    return null;
  }

  const fs = nodeRequire("fs");
  const fsp = fs && fs.promises;
  const pathMod = nodeRequire("path");
  const httpMod = nodeRequire("http");
  const cp = nodeRequire("child_process");

  const isDesktop = !!(fs && fsp && pathMod);

  // ---------------------------------------------------------------- 小工具

  function stripBom(s) {
    return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  async function exists(p) {
    try {
      await fsp.access(p);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function statSafe(p) {
    try {
      return await fsp.stat(p);
    } catch (e) {
      return null;
    }
  }

  async function readJson(p) {
    try {
      return JSON.parse(stripBom(await fsp.readFile(p, "utf8")));
    } catch (e) {
      return null;
    }
  }

  function decodeText(buf) {
    // project.json 有 UTF-8 也有带 BOM 的，统一按 UTF-8 解
    return stripBom(Buffer.from(buf).toString("utf8"));
  }

  async function readProjectJson(dir) {
    const p = pathMod.join(dir, "project.json");
    try {
      const raw = await fsp.readFile(p);
      return JSON.parse(decodeText(raw));
    } catch (e) {
      return null;
    }
  }

  function fmtSize(bytes) {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }

  // ---------------------------------------------------------------- Steam 发现

  function registrySteamPath() {
    if (!cp) return null;
    const keys = [
      "HKCU\\Software\\Valve\\Steam",
      "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
    ];
    for (const key of keys) {
      try {
        const out = cp.execFileSync("reg", ["query", key, "/v", "SteamPath"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 4000,
        });
        const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
        if (m && m[1].trim()) return m[1].trim().replace(/\//g, "\\");
      } catch (e) {
        /* 没有这个键就继续 */
      }
    }
    return null;
  }

  async function steamRoots() {
    const roots = new Set();
    const fromReg = registrySteamPath();
    if (fromReg) roots.add(fromReg);

    const env = (typeof process !== "undefined" && process.env) || {};
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const candidates = [
      pathMod.join(programFilesX86, "Steam"),
      pathMod.join(programFiles, "Steam"),
      "C:\\Steam",
      "D:\\Steam",
      "E:\\Steam",
      "F:\\Steam",
    ];
    for (const drive of ["C", "D", "E", "F", "G", "H"]) {
      candidates.push(`${drive}:\\SteamLibrary`);
      candidates.push(`${drive}:\\Games\\Steam`);
      candidates.push(`${drive}:\\Program Files (x86)\\Steam`);
    }
    for (const c of candidates) {
      if (await exists(c)) roots.add(c);
    }
    return [...roots];
  }

  /** 解析 libraryfolders.vdf 里的所有库路径 */
  async function steamLibraries() {
    const libs = new Set();
    for (const root of await steamRoots()) {
      libs.add(root);
      const vdf = pathMod.join(root, "steamapps", "libraryfolders.vdf");
      try {
        const txt = await fsp.readFile(vdf, "utf8");
        const re = /"path"\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(txt))) {
          libs.add(m[1].replace(/\\\\/g, "\\"));
        }
      } catch (e) {
        /* 没有 vdf 就只算根目录 */
      }
    }
    return [...libs];
  }

  // ---------------------------------------------------------------- 扫描壁纸库

  const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);
  const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv", ".ogg"]);
  const PREVIEW_NAMES = [
    "preview.jpg",
    "preview.jpeg",
    "preview.png",
    "preview.gif",
    "preview.webp",
    "preview.bmp",
  ];

  function typeLabel(type) {
    return (
      { scene: "场景", video: "视频", web: "网页", image: "图片", gif: "动图", application: "程序" }[type] ||
      type ||
      "未知"
    );
  }

  async function pickPreview(dir, project) {
    if (project && project.preview) {
      const p = pathMod.join(dir, project.preview);
      if (await exists(p)) return project.preview;
    }
    for (const name of PREVIEW_NAMES) {
      if (await exists(pathMod.join(dir, name))) return name;
    }
    return null;
  }

  async function findPkg(dir, project) {
    if (project && typeof project.file === "string" && project.file.toLowerCase().endsWith(".pkg")) {
      if (await exists(pathMod.join(dir, project.file))) return project.file;
    }
    try {
      const files = await fsp.readdir(dir);
      const pkg = files.find((f) => f.toLowerCase().endsWith(".pkg"));
      if (pkg) return pkg;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * 扫描单个壁纸目录（目录里直接有 project.json）
   * @returns {Promise<object|null>}
   */
  async function scanDir(dir, source) {
    const project = await readProjectJson(dir);
    let type = project && project.type ? String(project.type).toLowerCase() : "";

    const files = await fsp.readdir(dir).catch(() => []);
    if (!type) {
      if (files.some((f) => f.toLowerCase().endsWith(".pkg"))) type = "scene";
      else if (files.some((f) => VIDEO_EXT.has(pathMod.extname(f).toLowerCase()))) type = "video";
      else return null;
    }
    if (type === "application") {
      // 程序壁纸是编译产物，浏览器里无法运行，仍然列出来但标记不可用
    }

    const preview = await pickPreview(dir, project || {});
    const pkgName = type === "scene" ? await findPkg(dir, project || {}) : null;
    let fileName = project && project.file ? project.file : null;
    if (!fileName && type === "scene" && pkgName) fileName = pkgName;

    // 场景既没有 pkg 也没有松散入口 → 不可用
    if (type === "scene" && !pkgName) {
      const hasLoose = fileName && fileName.toLowerCase().endsWith(".json") && (await exists(pathMod.join(dir, fileName)));
      if (!hasLoose) return null;
    }

    let filePath = null;
    if (type === "scene" && pkgName) filePath = pathMod.join(dir, pkgName);
    else if (fileName) filePath = pathMod.join(dir, fileName);

    const st = filePath ? await statSafe(filePath) : null;
    const dirStat = await statSafe(dir);

    const id = `${source.kind}-${source.index}-${pathMod.basename(dir)}`;

    return {
      id,
      dir,
      kind: source.kind,
      kindLabel: source.label,
      type,
      typeLabel: typeLabel(type),
      playable: type !== "application",
      title: (project && project.title) || pathMod.basename(dir),
      project: project || {},
      preview,
      pkgName,
      fileName,
      size: st ? st.size : 0,
      mtime: dirStat ? dirStat.mtimeMs : 0,
    };
  }

  /**
   * 扫描整库
   * @param {string[]} extraDirs 用户额外添加的壁纸根目录
   * @param {(msg:string)=>void} onProgress
   */
  async function scan(extraDirs, onProgress) {
    if (!isDesktop) throw new Error("壁纸库扫描需要思源桌面端");

    const roots = [];
    for (const lib of await steamLibraries()) {
      const workshop = pathMod.join(lib, "steamapps", "workshop", "content", WORKSHOP_APP_ID);
      if (await exists(workshop)) roots.push({ dir: workshop, kind: "workshop", label: "创意工坊" });
      const mine = pathMod.join(lib, "steamapps", "common", "wallpaper_engine", "projects", "myprojects");
      if (await exists(mine)) roots.push({ dir: mine, kind: "myprojects", label: "我的项目" });
    }
    for (const d of extraDirs || []) {
      if (!d) continue;
      if (await exists(d)) roots.push({ dir: d, kind: "custom", label: "自定义目录" });
    }

    // 去重（同一路径只扫一次）
    const seen = new Set();
    const uniq = [];
    for (const r of roots) {
      const key = pathMod.resolve(r.dir).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(r);
    }

    const items = [];
    for (let i = 0; i < uniq.length; i += 1) {
      const root = uniq[i];
      onProgress && onProgress(`扫描 ${root.label}…`);
      let children = [];
      try {
        children = await fsp.readdir(root.dir, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      let index = 0;
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const dir = pathMod.join(root.dir, child.name);
        const item = await scanDir(dir, { kind: root.kind, label: root.label, index: index++ });
        if (item) items.push(item);
      }
    }

    // 如果自定义目录本身就是单个壁纸目录（直接含 project.json）
    for (const d of extraDirs || []) {
      if (!d) continue;
      if (await exists(pathMod.join(d, "project.json"))) {
        if (!items.some((it) => pathMod.resolve(it.dir).toLowerCase() === pathMod.resolve(d).toLowerCase())) {
          const item = await scanDir(d, { kind: "custom", label: "自定义目录", index: 99 });
          if (item) items.push(item);
        }
      }
    }

    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  }

  // ---------------------------------------------------------------- 本地静态服务

  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".ogg": "audio/ogg",
    ".ogv": "video/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".pkg": "application/octet-stream",
    ".tex": "application/octet-stream",
    ".mdl": "application/octet-stream",
  };

  function mimeOf(p) {
    return MIME[pathMod.extname(p).toLowerCase()] || "application/octet-stream";
  }

  /**
   * 起一个只读本地静态服务：
   *   GET /<id>/<相对路径>   → 壁纸目录里的文件（支持 Range，视频拖动/流式播放）
   * @param {(id:string)=>object|null} lookup
   */
  function startServer(lookup) {
    return new Promise((resolve, reject) => {
      if (!httpMod) {
        reject(new Error("当前环境没有 node http 模块"));
        return;
      }
      const server = httpMod.createServer(async (req, res) => {
        const cors = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
        };
        if (req.method === "OPTIONS") {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, cors);
          res.end("method not allowed");
          return;
        }

        let pathname = "/";
        try {
          pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
        } catch (e) {
          res.writeHead(400, cors);
          res.end("bad url");
          return;
        }

        if (pathname === "/health") {
          res.writeHead(200, { ...cors, "Content-Type": "text/plain" });
          res.end("ok");
          return;
        }

        const m = pathname.match(/^\/([^/]+)\/(.*)$/);
        if (!m) {
          res.writeHead(404, cors);
          res.end("not found");
          return;
        }
        const item = lookup(m[1]);
        if (!item) {
          res.writeHead(404, cors);
          res.end("unknown wallpaper");
          return;
        }
        let rel = m[2] || "";
        try {
          rel = decodeURIComponent(rel);
        } catch (e) {
          /* 已解码过就忽略 */
        }
        const target = pathMod.resolve(item.dir, rel || ".");
        const rootDir = pathMod.resolve(item.dir);
        if (target !== rootDir && !target.startsWith(rootDir + pathMod.sep)) {
          res.writeHead(403, cors);
          res.end("forbidden");
          return;
        }

        const st = await statSafe(target);
        if (!st || !st.isFile()) {
          res.writeHead(404, { ...cors, "Content-Type": "text/plain" });
          res.end("not found");
          return;
        }

        const headers = {
          ...cors,
          "Content-Type": mimeOf(target),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
          "Last-Modified": st.mtime.toUTCString(),
        };

        const range = req.headers.range;
        if (range) {
          const rm = /bytes=(\d*)-(\d*)/.exec(range);
          if (rm) {
            let start = rm[1] === "" ? null : parseInt(rm[1], 10);
            let end = rm[2] === "" ? null : parseInt(rm[2], 10);
            if (start === null && end !== null) {
              start = Math.max(0, st.size - end);
              end = st.size - 1;
            }
            if (start !== null && end === null) end = st.size - 1;
            if (start === null) {
              res.writeHead(416, { ...cors, "Content-Range": `bytes */${st.size}` });
              res.end();
              return;
            }
            if (start > end || start >= st.size) {
              res.writeHead(416, { ...cors, "Content-Range": `bytes */${st.size}` });
              res.end();
              return;
            }
            end = Math.min(end, st.size - 1);
            res.writeHead(206, {
              ...headers,
              "Content-Range": `bytes ${start}-${end}/${st.size}`,
              "Content-Length": end - start + 1,
            });
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            const stream = fs.createReadStream(target, { start, end });
            stream.on("error", () => {
              try {
                res.destroy();
              } catch (e) {
                /* ignore */
              }
            });
            stream.pipe(res);
            return;
          }
        }

        res.writeHead(200, { ...headers, "Content-Length": st.size });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        const stream = fs.createReadStream(target);
        stream.on("error", () => {
          try {
            res.destroy();
          } catch (e) {
            /* ignore */
          }
        });
        stream.pipe(res);
      });

      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        resolve({
          server,
          port,
          url: `http://127.0.0.1:${port}`,
          close: () =>
            new Promise((done) => {
              try {
                server.close(() => done());
              } catch (e) {
                done();
              }
            }),
        });
      });
    });
  }

  // ---------------------------------------------------------------- WebWallGL

  function sceneDirSource(item) {
    // 松散工程（myprojects / 编辑器工程目录）：按相对路径读盘
    const root = item.dir;
    return {
      key: item.id,
      async scenePkg() {
        throw new Error("该壁纸是松散工程，没有 scene.pkg");
      },
      async sceneDir() {
        return {
          entry: item.fileName || "scene.json",
          async read(name) {
            const target = pathMod.resolve(root, name);
            if (target !== root && !target.startsWith(root + pathMod.sep)) return null;
            try {
              const buf = await fsp.readFile(target);
              return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            } catch (e) {
              return null;
            }
          },
        };
      },
      async project() {
        return item.project || null;
      },
    };
  }

  async function createSource(item, ctx) {
    const W = global.WebWallGL;
    if (!W) throw new Error("WebWallGL 引擎未加载");
    const base = `${ctx.serverUrl}/${encodeURIComponent(item.id)}`;

    if (item.type === "scene") {
      if (item.pkgName) {
        const p = pathMod.join(item.dir, item.pkgName);
        const buf = await fsp.readFile(p);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        return W.bytesSource(ab, item.project || null, item.id);
      }
      return sceneDirSource(item);
    }

    if (item.type === "web") {
      return W.httpSource(base);
    }

    if (item.type === "video" || item.type === "image" || item.type === "gif") {
      if (item.fileName) {
        return W.mediaSource(`${base}/${encodeURIComponent(item.fileName)}`, { type: item.type });
      }
      return W.httpSource(base);
    }

    if (item.type === "application") {
      throw new Error("程序类壁纸是编译产物，无法在思源里运行");
    }

    // 兜底：当成网页壁纸/媒体目录
    return W.httpSource(base);
  }

  const Renderer = {
    async mount(container, item, options) {
      const W = global.WebWallGL;
      if (!W) throw new Error("WebWallGL 引擎未加载，请检查插件文件是否完整");
      const opts = options || {};
      const source = await createSource(item, opts);
      return W.mount(container, {
        source,
        fit: opts.fit || "cover",
        fps: typeof opts.fps === "number" ? opts.fps : 30,
        renderDpr: typeof opts.dpr === "number" ? opts.dpr : 1.5,
        volume: 0,
        autoplay: true,
        scripts: opts.scripts !== false,
        mountTimeoutMs: opts.timeout || 150000,
        onReady: opts.onReady,
        onError: opts.onError,
        onDiagnostic: opts.onDiagnostic,
      });
    },
  };

  // ---------------------------------------------------------------- 导出

  global.WPCore = {
    VERSION,
    isDesktop,
    scan,
    startServer,
    Renderer,
    fmtSize,
    typeLabel,
    IMAGE_EXT,
    VIDEO_EXT,
    _internal: { steamLibraries, steamRoots, scanDir, readProjectJson, createSource },
  };
})(typeof window !== "undefined" ? window : globalThis);
