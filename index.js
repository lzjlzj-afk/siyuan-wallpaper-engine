/*!
 * 思源壁纸引擎 / SiYuan Wallpaper Engine
 * 把 Wallpaper Engine 本地壁纸（scene.pkg / 视频 / 网页）实时渲染成思源笔记背景。
 *
 * MIT License
 * 场景渲染：WebWallGL (MIT) https://github.com/oneincase/webwallgl
 */
const { Plugin, showMessage } = require("siyuan");

const DEFAULTS = {
  lastId: null,
  fit: "cover",
  fps: 30,
  dpr: 1.5,
  opacity: 0.65,
  scrim: 0.25,
  blur: 18,
  glass: 0.55,
  veil: 0.28,
  transparentUI: true,
  pauseOnBlur: true,
  scripts: true,
  rotate: 0,
  dirs: [],
  props: {},
};

class WallpaperEnginePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, (await this.loadData("settings.json")) || {});
    this.settings.dirs = Array.isArray(this.settings.dirs) ? this.settings.dirs : [];
    this.items = [];
    this.currentId = null;
    this.instance = null;
    this.paused = false;
    this._playToken = 0;
    this._rotateTimer = null;
    this._fpsTimer = null;
    this._saveTimer = null;
    this._themeObserver = null;

    try {
      await this.loadAssets();
      this.createBackground();
      this.server = await WPCore.startServer((id) => this.items.find((it) => it.id === id) || null);
      await this.refreshLibrary(true);
      this.ui = WPUI.mount(this);
      this.applyLook();
      this.bindEvents();
      this.startFpsLoop();
      this.setupRotation();

      this.addTopBar({
        icon: "iconImage",
        title: "壁纸引擎",
        position: "right",
        callback: () => this.ui.toggle(),
      });
      this.addCommand({
        command: "openWallpaperEngine",
        langKey: "openPanel",
        hotkey: "ctrl+alt+w",
        callback: () => this.ui.toggle(),
      });

      if (this.settings.lastId && this.items.some((it) => it.id === this.settings.lastId)) {
        setTimeout(() => this.play(this.settings.lastId), 600);
      }
    } catch (err) {
      console.error("[wallpaper-engine] onload failed", err);
      showMessage(`壁纸引擎加载失败：${err && err.message ? err.message : err}`, 8000, "error");
    }
  }

  get serverUrl() {
    return this.server ? this.server.url : "";
  }

  onunload() {    try {
      this.destroyInstance();
      this.server && this.server.close();
      clearInterval(this._rotateTimer);
      clearInterval(this._fpsTimer);
      clearTimeout(this._saveTimer);
      if (this._themeObserver) this._themeObserver.disconnect();
      if (this._onBlur) window.removeEventListener("blur", this._onBlur);
      if (this._onFocus) window.removeEventListener("focus", this._onFocus);
      if (this._onVisibility) document.removeEventListener("visibilitychange", this._onVisibility);
      const bg = document.getElementById("wpgl-bg");
      if (bg) bg.remove();
      if (this.ui && this.ui.root) this.ui.root.remove();
      document.documentElement.classList.remove("wpgl-on");
      document.body.classList.remove("wpgl-panel-open");
    } catch (e) {
      console.warn("[wallpaper-engine] unload error", e);
    }
  }

  // ------------------------------------------------------------ 资源加载

  async loadAssets() {
    const base = `/plugins/${this.name}`;
    const bust = `?v=${Date.now()}`;
    if (!document.getElementById("wpgl-style")) {
      const link = document.createElement("link");
      link.id = "wpgl-style";
      link.rel = "stylesheet";
      link.href = `${base}/index.css${bust}`;
      document.head.appendChild(link);
      await new Promise((resolve) => {
        link.onload = resolve;
        link.onerror = resolve;
        setTimeout(resolve, 3000);
      });
    }

    const scripts = [
      ["lib/webwallgl.global.min.js", () => !!window.WebWallGL],
      ["lib/wp-core.js", () => !!window.WPCore],
      ["lib/wp-ui.js", () => !!window.WPUI],
    ];
    for (const [rel, loaded] of scripts) {
      if (loaded()) continue;
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `${base}/${rel}${bust}`;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`无法加载 ${rel}，请确认插件文件完整`));
        document.head.appendChild(s);
      });
    }
    if (!window.WPCore || !WPCore.isDesktop) {
      throw new Error("壁纸库需要思源桌面端（需要读取本地壁纸文件）");
    }
  }

  // ------------------------------------------------------------ 背景层

  createBackground() {
    let bg = document.getElementById("wpgl-bg");
    if (!bg) {
      bg = document.createElement("div");
      bg.id = "wpgl-bg";
      bg.innerHTML = '<div id="wpgl-stage"></div><div id="wpgl-scrim"></div>';
      document.body.insertBefore(bg, document.body.firstChild);
    }
    this.bg = bg;
    this.stage = document.getElementById("wpgl-stage");
    this.scrim = document.getElementById("wpgl-scrim");
    document.documentElement.classList.toggle("wpgl-on", this.settings.transparentUI !== false);
  }

  // ------------------------------------------------------------ 壁纸库

  async refreshLibrary(silent) {
    try {
      this.items = await WPCore.scan(this.settings.dirs, (msg) => {
        if (!silent) showMessage(msg, 1200);
      });
      if (this.ui) this.ui.render();
      return this.items;
    } catch (e) {
      console.error("[wallpaper-engine] scan failed", e);
      if (!silent) showMessage(`扫描壁纸库失败：${e.message}`, 5000, "error");
      this.items = this.items || [];
      return this.items;
    }
  }

  async addDir(dir) {
    try {
      const fs = window.require("fs");
      const st = await fs.promises.stat(dir);
      if (!st.isDirectory()) throw new Error("不是目录");
    } catch (e) {
      showMessage("目录不存在或不可读", 3000, "error");
      return false;
    }
    if (!this.settings.dirs.includes(dir)) {
      this.settings.dirs.push(dir);
      this.saveSettings();
    }
    await this.refreshLibrary(true);
    showMessage(`已添加目录：${dir}`, 3000);
    return true;
  }

  // ------------------------------------------------------------ 播放

  async play(id) {
    const item = this.items.find((it) => it.id === id);
    if (!item) return;
    if (item.id === this.currentId && this.instance && !this.instance.__dead) {
      if (this.ui) this.ui.syncFooter();
      return;
    }

    const token = ++this._playToken;
    this.currentId = id;
    this.settings.lastId = id;
    this.paused = false;
    this.saveSettings();
    this.bg.classList.add("wpgl-loading");

    this.destroyInstance();

    try {
      const inst = await WPCore.Renderer.mount(this.stage, item, {
        serverUrl: this.server.url,
        fit: this.settings.fit,
        fps: Number(this.settings.fps),
        dpr: Number(this.settings.dpr),
        scripts: this.settings.scripts !== false,
        onError: (err) => {
          console.warn("[wallpaper-engine] renderer error", err);
          if (token === this._playToken) {
            this.bg.classList.remove("wpgl-loading");
            showMessage(`壁纸渲染出错：${err && err.message ? err.message : err}`, 6000, "error");
          }
        },
      });
      if (token !== this._playToken) {
        try {
          inst.destroy({ releasePkgCache: true });
        } catch (e) {
          /* ignore */
        }
        return;
      }
      this.instance = inst;
      // 恢复这张壁纸上次调好的属性
      const savedProps = (this.settings.props && this.settings.props[id]) || null;
      if (savedProps && Object.keys(savedProps).length) {
        try {
          inst.setProperties(savedProps);
        } catch (e) {
          /* ignore */
        }
      }
      this.bg.classList.remove("wpgl-loading");
      if (this.ui) {
        this.ui.syncFooter();
        this.ui.render();
      }
    } catch (err) {
      console.error("[wallpaper-engine] play failed", err);
      this.bg.classList.remove("wpgl-loading");
      this.instance = null;
      showMessage(`壁纸加载失败：${err && err.message ? err.message : err}`, 7000, "error");
      if (this.ui) this.ui.syncFooter();
    }
  }

  destroyInstance() {
    if (this.instance) {
      try {
        this.instance.destroy({ releasePkgCache: true });
      } catch (e) {
        /* ignore */
      }
      this.instance = null;
    }
    if (this.stage) this.stage.innerHTML = "";
  }

  stop() {
    this._playToken += 1;
    this.destroyInstance();
    this.currentId = null;
    this.settings.lastId = null;
    this.paused = false;
    this.saveSettings();
    if (this.ui) {
      this.ui.render();
      this.ui.syncFooter();
    }
  }

  togglePause() {
    if (!this.instance) return;
    if (this.paused) {
      this.instance.resume();
      this.paused = false;
    } else {
      this.instance.pause();
      this.paused = true;
    }
    if (this.ui) this.ui.syncFooter();
  }

  setProperty(name, value) {
    if (!this.instance) return;
    const id = this.currentId;
    this.settings.props = this.settings.props || {};
    this.settings.props[id] = this.settings.props[id] || {};
    this.settings.props[id][name] = value;
    this.saveSettings();
    try {
      this.instance.setProperties({ [name]: value });
    } catch (e) {
      console.warn("[wallpaper-engine] setProperties failed", e);
    }
  }

  // ------------------------------------------------------------ 外观

  applyLook() {
    const s = this.settings;
    const rootStyle = document.documentElement.style;
    const dark = document.documentElement.getAttribute("data-theme-mode") !== "light";
    rootStyle.setProperty("--wpgl-scrim", String(s.scrim));
    rootStyle.setProperty("--wpgl-blur", `${s.blur}px`);
    rootStyle.setProperty("--wpgl-glass", String(s.glass));
    rootStyle.setProperty("--wpgl-veil", String(s.veil));
    rootStyle.setProperty("--wpgl-glass-rgb", dark ? "22, 25, 32" : "255, 255, 255");
    document.documentElement.classList.toggle("wpgl-on", s.transparentUI !== false);
    if (this.bg) this.bg.style.opacity = String(s.opacity);
  }

  applySettings(key) {
    const s = this.settings;
    if (["opacity", "scrim", "blur", "glass", "veil", "transparentUI"].includes(key)) {
      this.applyLook();
    }
    if (key === "fit" && this.instance) this.instance.setFit(s.fit);
    if (key === "fps" && this.instance) this.instance.setFps(Number(s.fps));
    if (key === "dpr" && this.instance) this.instance.setRenderDpr(Number(s.dpr));
    if (key === "scripts") {
      const id = this.currentId;
      this.currentId = null;
      this.destroyInstance();
      if (id) this.play(id);
    }
    if (key === "rotate") this.setupRotation();
    if (key === "pauseOnBlur" && !s.pauseOnBlur && this.paused === false) {
      /* 无需处理 */
    }
    this.saveSettings();
  }

  saveSettings() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveData("settings.json", this.settings).catch((e) => console.warn("[wallpaper-engine] save failed", e));
    }, 350);
  }

  // ------------------------------------------------------------ 行为

  bindEvents() {
    this._onBlur = () => {
      if (this.settings.pauseOnBlur !== false && this.instance && !this.paused) {
        this.instance.pause();
        this._autoPaused = true;
      }
    };
    this._onFocus = () => {
      if (this._autoPaused && this.instance && !this.paused) {
        this.instance.resume();
        this._autoPaused = false;
      }
    };
    this._onVisibility = () => {
      if (document.hidden) this._onBlur();
      else this._onFocus();
    };
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("focus", this._onFocus);
    document.addEventListener("visibilitychange", this._onVisibility);

    this._themeObserver = new MutationObserver(() => this.applyLook());
    this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-mode"] });
  }

  startFpsLoop() {
    clearInterval(this._fpsTimer);
    this._fpsTimer = setInterval(() => {
      if (this.ui) this.ui.updateFps(this.instance && this.instance.stats ? this.instance.stats.fps : 0);
    }, 1000);
  }

  setupRotation() {
    clearInterval(this._rotateTimer);
    const minutes = Number(this.settings.rotate) || 0;
    if (!minutes) return;
    this._rotateTimer = setInterval(() => {
      const pool = this.items.filter((it) => it.playable && it.id !== this.currentId);
      if (!pool.length) return;
      const next = pool[Math.floor(Math.random() * pool.length)];
      this.play(next.id);
    }, minutes * 60 * 1000);
  }
}

module.exports = WallpaperEnginePlugin;
