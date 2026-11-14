/*!
 * 思源壁纸引擎 · 面板 UI
 * 纯 DOM，无框架依赖。由 index.js 调用 WPUI.mount(controller)。
 */
(function (global) {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  const TYPE_ICON = { scene: "◈", video: "▶", web: "◎", image: "▣", gif: "▤", application: "⚙" };

  function switchRow(key, label, desc, checked) {
    return `
      <div class="wpgl-row">
        <div class="wpgl-row__label">${esc(label)}${desc ? `<span class="wpgl-row__desc">${esc(desc)}</span>` : ""}</div>
        <div class="wpgl-row__ctrl">
          <label class="wpgl-switch">
            <input type="checkbox" data-key="${esc(key)}" ${checked ? "checked" : ""} />
            <span class="wpgl-switch__track"></span>
          </label>
        </div>
      </div>`;
  }

  function rangeRow(key, label, desc, value, min, max, step, unit) {
    return `
      <div class="wpgl-row">
        <div class="wpgl-row__label">${esc(label)}${desc ? `<span class="wpgl-row__desc">${esc(desc)}</span>` : ""}</div>
        <div class="wpgl-row__ctrl">
          <input class="wpgl-range" type="range" data-key="${esc(key)}" data-unit="${esc(unit || "")}"
                 min="${min}" max="${max}" step="${step}" value="${value}" />
          <span class="wpgl-row__val" data-val="${esc(key)}">${value}${unit || ""}</span>
        </div>
      </div>`;
  }

  function selectRow(key, label, desc, value, options) {
    const opts = options
      .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("");
    return `
      <div class="wpgl-row">
        <div class="wpgl-row__label">${esc(label)}${desc ? `<span class="wpgl-row__desc">${esc(desc)}</span>` : ""}</div>
        <div class="wpgl-row__ctrl">
          <select class="wpgl-select" data-key="${esc(key)}">${opts}</select>
        </div>
      </div>`;
  }

  function colorToHex(v) {
    if (typeof v !== "string") return "#888888";
    const parts = v.trim().split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return "#888888";
    const to = (n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");
    return `#${to(parts[0])}${to(parts[1])}${to(parts[2])}`;
  }

  function hexToColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "1 1 1";
    const n = parseInt(m[1], 16);
    return `${((n >> 16) & 255) / 255} ${((n >> 8) & 255) / 255} ${(n & 255) / 255}`;
  }

  function gpuInfo() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return "WebGL 不可用";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return String(name || "未知");
    } catch (e) {
      return "未知";
    }
  }

  function mount(ctrl) {
    const settings = ctrl.settings;
    let activeTab = "library";
    let addRowOpen = false;
    let propsOpen = true;
    let currentProps = {};

    const root = document.createElement("div");
    root.className = "wpgl-panel wpgl-hidden";
    root.id = "wpgl-panel";
    root.innerHTML = `
      <div class="wpgl-panel__mask" data-act="close"></div>
      <div class="wpgl-panel__win" role="dialog" aria-label="壁纸引擎">
        <header class="wpgl-head">
          <div class="wpgl-logo">◈</div>
          <div class="wpgl-title">壁纸引擎</div>
          <span class="wpgl-ver">v${esc(ctrl.version || "0.1.0")}</span>
          <div class="wpgl-head__space"></div>
          <button class="wpgl-iconbtn" data-act="refresh" title="重新扫描壁纸库">⟳</button>
          <button class="wpgl-iconbtn" data-act="close" title="关闭 (Esc)">✕</button>
        </header>
        <div class="wpgl-main">
          <nav class="wpgl-nav">
            <button class="wpgl-nav__item wpgl-nav__item--active" data-tab="library"><span class="wpgl-nav__ico">◈</span>壁纸库</button>
            <button class="wpgl-nav__item" data-tab="look"><span class="wpgl-nav__ico">◐</span>外观</button>
            <button class="wpgl-nav__item" data-tab="perf"><span class="wpgl-nav__ico">⚡</span>性能</button>
            <button class="wpgl-nav__item" data-tab="about"><span class="wpgl-nav__ico">ⓘ</span>关于</button>
            <div class="wpgl-nav__foot">Wallpaper Engine 壁纸<br />实时渲染到思源背景</div>
          </nav>
          <div class="wpgl-content">
            <section class="wpgl-pane wpgl-pane--active" data-pane="library">
              <div class="wpgl-libbar">
                <input class="wpgl-search" type="search" placeholder="搜索壁纸标题…" data-role="search" />
                <button class="wpgl-btn" data-act="add-dir">＋ 目录</button>
                <span class="wpgl-count" data-role="count"></span>
              </div>
              <div class="wpgl-addrow" data-role="addrow" style="display:none;margin-bottom:14px;gap:10px;align-items:center">
                <input class="wpgl-search" type="text" placeholder="粘贴壁纸根目录，例如 D:\\Wallpapers" data-role="dir-input" style="padding-left:12px" />
                <button class="wpgl-btn wpgl-btn--primary" data-act="add-dir-confirm">添加</button>
              </div>
              <div class="wpgl-grid" data-role="grid"></div>
              <div class="wpgl-empty" data-role="empty" style="display:none"></div>
              <div data-role="props"></div>
            </section>

            <section class="wpgl-pane" data-pane="look">
              <div class="wpgl-group">
                <div class="wpgl-group__title">背景</div>
                ${rangeRow("opacity", "壁纸不透明度", "数值越小壁纸越透明，0 = 完全看不见", Math.round(settings.opacity * 100), 0, 100, 1, "%")}
                ${rangeRow("scrim", "暗角", "压暗壁纸，保证文字可读", Math.round(settings.scrim * 100), 0, 80, 1, "%")}
                ${selectRow("fit", "适配方式", "壁纸铺满窗口还是完整显示", settings.fit, [
                  { value: "cover", label: "铺满（裁切）" },
                  { value: "contain", label: "完整显示" },
                  { value: "stretch", label: "拉伸" },
                ])}
              </div>
              <div class="wpgl-group">
                <div class="wpgl-group__title">界面毛玻璃</div>
                ${switchRow("transparentUI", "透明界面", "让思源界面透出壁纸（关闭则壁纸被界面遮住）", settings.transparentUI !== false)}
                ${rangeRow("veil", "编辑区衬底", "正文下面那层薄玻璃，越浓越易读", Math.round(settings.veil * 100), 0, 80, 1, "%")}
                ${rangeRow("blur", "模糊半径", "顶栏 / 侧栏 / 菜单的毛玻璃强度", settings.blur, 0, 40, 1, "px")}
                ${rangeRow("glass", "玻璃浓度", "毛玻璃底色越浓越不透明", Math.round(settings.glass * 100), 0, 100, 1, "%")}
              </div>
              <div class="wpgl-group">
                <div class="wpgl-group__title">行为</div>
                ${switchRow("pauseOnBlur", "失焦时暂停", "切到别的窗口时停渲染，省电", settings.pauseOnBlur !== false)}
                ${switchRow("scripts", "运行壁纸脚本", "恢复 SceneScript（时钟、交互等），关闭更省性能", settings.scripts !== false)}
                ${selectRow("rotate", "自动轮播", "按间隔随机切换壁纸", settings.rotate, [
                  { value: "0", label: "关闭" },
                  { value: "5", label: "每 5 分钟" },
                  { value: "15", label: "每 15 分钟" },
                  { value: "30", label: "每 30 分钟" },
                  { value: "60", label: "每 60 分钟" },
                ])}
              </div>
            </section>

            <section class="wpgl-pane" data-pane="perf">
              <div class="wpgl-group">
                <div class="wpgl-group__title">渲染</div>
                ${selectRow("fps", "帧率上限", "越低越省电", String(settings.fps), [
                  { value: "15", label: "15 fps（最省电）" },
                  { value: "24", label: "24 fps" },
                  { value: "30", label: "30 fps（推荐）" },
                  { value: "60", label: "60 fps（最流畅）" },
                ])}
                ${selectRow("dpr", "渲染精度", "越高越清晰，也越吃显存", String(settings.dpr), [
                  { value: "1", label: "1.0×（省显存）" },
                  { value: "1.25", label: "1.25×" },
                  { value: "1.5", label: "1.5×（推荐）" },
                  { value: "2", label: "2.0×（HiDPI）" },
                ])}
              </div>
              <div class="wpgl-group">
                <div class="wpgl-group__title">状态</div>
                <div class="wpgl-row">
                  <div class="wpgl-row__label">实时帧率</div>
                  <div class="wpgl-row__ctrl"><span class="wpgl-row__val" data-role="fps">—</span></div>
                </div>
                <div class="wpgl-row">
                  <div class="wpgl-row__label">渲染引擎</div>
                  <div class="wpgl-row__ctrl" style="font-size:12px;color:#9fb0c6">WebWallGL · WebGL2</div>
                </div>
                <div class="wpgl-row">
                  <div class="wpgl-row__label">显卡</div>
                  <div class="wpgl-row__ctrl" style="font-size:12px;color:#9fb0c6;word-break:break-all" data-role="gpu"></div>
                </div>
              </div>
              <div class="wpgl-tip">场景壁纸（scene.pkg）由 WebGL2 实时渲染；4K 场景 + 60fps 会明显占用 GPU，笔记本建议 30fps + 1.5× 精度。</div>
            </section>

            <section class="wpgl-pane wpgl-about" data-pane="about">
              <h2>思源壁纸引擎</h2>
              <p>把 Wallpaper Engine 的本地壁纸变成思源笔记的实时背景：场景壁纸用 WebGL2 还原图层、粒子、效果与脚本，视频壁纸直接播放，网页壁纸用 iframe 承载。</p>
              <div class="wpgl-kv">
                <b>版本</b><span>v${esc(ctrl.version || "0.1.0")}</span>
                <b>场景渲染</b><span>WebWallGL（MIT）</span>
                <b>壁纸来源</b><span>Steam 创意工坊 431960 / 我的项目 / 自定义目录</span>
                <b>平台</b><span>思源桌面端（Windows / macOS / Linux）</span>
              </div>
              <div class="wpgl-tip">壁纸素材版权归原作者所有。创意工坊壁纸仅限本机自用，请勿二次分发或打包进公开发布物。</div>
              <p>快捷键：<code>Ctrl+Alt+W</code> 打开面板；<code>Esc</code> 关闭面板。</p>
            </section>
          </div>
        </div>
        <footer class="wpgl-foot">
          <span class="wpgl-dot wpgl-dot--idle" data-role="dot"></span>
          <span class="wpgl-now" data-role="now">未选择壁纸</span>
          <span class="wpgl-fps" data-role="fps-foot">— fps</span>
          <button class="wpgl-btn" data-act="toggle-pause">暂停</button>
          <button class="wpgl-btn" data-act="stop">关闭壁纸</button>
        </footer>
      </div>
    `;
    document.body.appendChild(root);

    const els = {
      grid: $('[data-role="grid"]', root),
      empty: $('[data-role="empty"]', root),
      count: $('[data-role="count"]', root),
      search: $('[data-role="search"]', root),
      addrow: $('[data-role="addrow"]', root),
      dirInput: $('[data-role="dir-input"]', root),
      props: $('[data-role="props"]', root),
      now: $('[data-role="now"]', root),
      dot: $('[data-role="dot"]', root),
      fpsFoot: $('[data-role="fps-foot"]', root),
      fps: $('[data-role="fps"]', root),
      gpu: $('[data-role="gpu"]', root),
      pauseBtn: $('[data-act="toggle-pause"]', root),
    };
    els.gpu.textContent = gpuInfo();

    // ---------------------------------------------------------------- 壁纸库

    function filtered() {
      const q = (els.search.value || "").trim().toLowerCase();
      if (!q) return ctrl.items;
      return ctrl.items.filter((it) => `${it.title} ${it.typeLabel} ${it.kindLabel}`.toLowerCase().includes(q));
    }

    function cardHtml(item) {
      const thumb = item.preview
        ? `<img loading="lazy" src="${esc(`${ctrl.serverUrl}/${encodeURIComponent(item.id)}/${encodeURIComponent(item.preview)}`)}" alt="" />`
        : `<div class="wpgl-thumb__ph">${TYPE_ICON[item.type] || "◈"}</div>`;
      const active = item.id === ctrl.currentId;
      return `
        <button class="wpgl-card ${active ? "wpgl-card--active" : ""} ${item.playable ? "" : "wpgl-card--disabled"}" data-id="${esc(item.id)}" title="${esc(item.title)}">
          <div class="wpgl-thumb">
            ${thumb}
            <span class="wpgl-badge ${active ? "wpgl-badge--live" : ""}">${esc(item.typeLabel)}</span>
          </div>
          <div class="wpgl-card__meta">
            <div class="wpgl-card__title">${esc(item.title)}</div>
            <div class="wpgl-card__sub">${esc(item.kindLabel)} · ${fmtSize(item.size)}</div>
          </div>
        </button>`;
    }

    function renderGrid() {
      const list = filtered();
      els.grid.innerHTML = list.map(cardHtml).join("");
      els.count.textContent = `${list.length} / ${ctrl.items.length} 张`;
      const showEmpty = list.length === 0;
      els.empty.style.display = showEmpty ? "block" : "none";
      if (showEmpty) {
        els.empty.innerHTML = ctrl.items.length
          ? "没有匹配的壁纸"
          : "还没找到壁纸。<br /><b>请确认 Wallpaper Engine 已安装并至少订阅或创建过一张壁纸</b><br />也可以点右上角「＋ 目录」添加自己的壁纸文件夹。";
      }
      renderProps();
    }

    function activeItem() {
      return ctrl.items.find((it) => it.id === ctrl.currentId) || null;
    }

    function renderProps() {
      const item = activeItem();
      const props = item && item.project && item.project.general && item.project.general.properties;
      if (!item || item.type !== "scene" || !props || typeof props !== "object") {
        els.props.innerHTML = "";
        return;
      }
      const keys = Object.keys(props).filter(
        (k) =>
          props[k] &&
          typeof props[k] === "object" &&
          k !== "schemecolor" &&
          !/^ui_browse_properties/i.test(k) &&
          props[k].type !== "group"
      );
      if (!keys.length) {
        els.props.innerHTML = "";
        return;
      }
      const rows = keys
        .filter((k) => props[k].type !== "group")
        .map((k) => {
          const p = props[k];
          const label = p.text || k;
          const val = currentProps[k] !== undefined ? currentProps[k] : p.value;
          if (p.type === "bool") {
            return `
              <div class="wpgl-row">
                <div class="wpgl-row__label">${esc(label)}</div>
                <div class="wpgl-row__ctrl">
                  <label class="wpgl-switch">
                    <input type="checkbox" data-prop="${esc(k)}" data-ptype="bool" ${val ? "checked" : ""} />
                    <span class="wpgl-switch__track"></span>
                  </label>
                </div>
              </div>`;
          }
          if (p.type === "slider") {
            const min = p.min != null ? p.min : 0;
            const max = p.max != null ? p.max : 1;
            const step = p.step != null ? p.step : 0.01;
            return `
              <div class="wpgl-row">
                <div class="wpgl-row__label">${esc(label)}</div>
                <div class="wpgl-row__ctrl">
                  <input class="wpgl-range" type="range" data-prop="${esc(k)}" data-ptype="slider"
                         min="${min}" max="${max}" step="${step}" value="${val}" />
                  <span class="wpgl-row__val">${Number(val).toFixed(2)}</span>
                </div>
              </div>`;
          }
          if (p.type === "color") {
            return `
              <div class="wpgl-row">
                <div class="wpgl-row__label">${esc(label)}</div>
                <div class="wpgl-row__ctrl">
                  <input type="color" data-prop="${esc(k)}" data-ptype="color" value="${colorToHex(val)}"
                         style="width:52px;height:30px;border:0;background:transparent;cursor:pointer" />
                </div>
              </div>`;
          }
          if (p.type === "combo") {
            const options = Array.isArray(p.options) ? p.options : [];
            const opts = options
              .map((o) => {
                const ov = typeof o === "string" ? o : o.value;
                const ol = typeof o === "string" ? o : o.label || o.value;
                return `<option value="${esc(ov)}" ${String(ov) === String(val) ? "selected" : ""}>${esc(ol)}</option>`;
              })
              .join("");
            return `
              <div class="wpgl-row">
                <div class="wpgl-row__label">${esc(label)}</div>
                <div class="wpgl-row__ctrl"><select class="wpgl-select" data-prop="${esc(k)}" data-ptype="combo">${opts}</select></div>
              </div>`;
          }
          if (p.type === "textinput") {
            return `
              <div class="wpgl-row">
                <div class="wpgl-row__label">${esc(label)}</div>
                <div class="wpgl-row__ctrl">
                  <input class="wpgl-search" style="padding-left:12px" type="text" data-prop="${esc(k)}" data-ptype="text" value="${esc(val)}" />
                </div>
              </div>`;
          }
          return "";
        })
        .join("");

      els.props.innerHTML = `
        <div class="wpgl-props ${propsOpen ? "wpgl-props--open" : ""}">
          <div class="wpgl-props__head" data-act="props-toggle">
            <b>壁纸属性</b><span>${keys.length} 项 · 实时生效</span>
          </div>
          <div class="wpgl-props__body">${rows}</div>
        </div>`;
    }

    // ---------------------------------------------------------------- 设置同步

    function syncControls() {
      const percentKeys = ["opacity", "scrim", "glass", "veil"];
      $$("[data-key]", root).forEach((el) => {
        const key = el.getAttribute("data-key");
        if (el.type === "checkbox") el.checked = !!settings[key];
        else if (el.type === "range") {
          let v = Number(settings[key]);
          if (percentKeys.includes(key)) v = Math.round(v * 100);
          el.value = String(v);
          const out = $(`[data-val="${key}"]`, root);
          if (out) out.textContent = el.value + (el.getAttribute("data-unit") || "");
        } else el.value = settings[key];
      });
    }

    function applyRootClasses() {
      document.documentElement.classList.toggle("wpgl-on", settings.transparentUI !== false);
    }

    // ---------------------------------------------------------------- 事件

    root.addEventListener("click", async (ev) => {
      const tabBtn = ev.target.closest("[data-tab]");
      if (tabBtn) {
        activeTab = tabBtn.getAttribute("data-tab");
        $$(".wpgl-nav__item", root).forEach((b) => b.classList.toggle("wpgl-nav__item--active", b === tabBtn));
        $$(".wpgl-pane", root).forEach((p) => p.classList.toggle("wpgl-pane--active", p.getAttribute("data-pane") === activeTab));
        if (activeTab === "library") renderGrid();
        return;
      }

      const act = ev.target.closest("[data-act]");
      if (act) {
        const a = act.getAttribute("data-act");
        if (a === "close") close();
        else if (a === "refresh") {
          act.style.transform = "rotate(360deg)";
          setTimeout(() => (act.style.transform = ""), 400);
          await ctrl.refresh();
          renderGrid();
        } else if (a === "add-dir") {
          addRowOpen = !addRowOpen;
          els.addrow.style.display = addRowOpen ? "flex" : "none";
          if (addRowOpen) els.dirInput.focus();
        } else if (a === "add-dir-confirm") {
          const dir = (els.dirInput.value || "").trim();
          if (!dir) return;
          els.dirInput.value = "";
          addRowOpen = false;
          els.addrow.style.display = "none";
          const ok = await ctrl.addDir(dir);
          if (!ok) {
            els.empty.style.display = "block";
            els.empty.textContent = "这个目录不可用，请换一个路径。";
          }
          renderGrid();
        } else if (a === "props-toggle") {
          propsOpen = !propsOpen;
          $(".wpgl-props", root).classList.toggle("wpgl-props--open", propsOpen);
        } else if (a === "toggle-pause") {
          ctrl.togglePause();
          syncFooter();
        } else if (a === "stop") {
          ctrl.stop();
          renderGrid();
          syncFooter();
        }
        return;
      }

      const card = ev.target.closest(".wpgl-card");
      if (card) {
        const id = card.getAttribute("data-id");
        const item = ctrl.items.find((it) => it.id === id);
        if (!item || !item.playable) return;
        $$(".wpgl-card", root).forEach((c) => c.classList.remove("wpgl-card--active"));
        card.classList.add("wpgl-card--active");
        const badge = $(".wpgl-badge", card);
        if (badge) badge.classList.add("wpgl-badge--live");
        currentProps = {};
        await ctrl.play(id);
        renderGrid();
        syncFooter();
      }
    });

    root.addEventListener("input", (ev) => {
      const el = ev.target;
      const key = el.getAttribute("data-key");
      if (key) {
        const isRange = el.type === "range";
        const isCheck = el.type === "checkbox";
        let val = isCheck ? el.checked : isRange ? Number(el.value) : el.value;
        if (isRange && (key === "opacity" || key === "scrim" || key === "glass" || key === "veil")) val = Number(el.value) / 100;
        if (key === "fps" || key === "dpr" || key === "rotate") val = Number(el.value);
        settings[key] = val;
        if (isRange) {
          const out = $(`[data-val="${key}"]`, root);
          if (out) out.textContent = el.value + (el.getAttribute("data-unit") || "");
        }
        ctrl.applySettings(key);
        return;
      }

      const prop = el.getAttribute("data-prop");
      if (prop) {
        const ptype = el.getAttribute("data-ptype");
        let val;
        if (ptype === "bool") val = el.checked;
        else if (ptype === "slider") val = Number(el.value);
        else if (ptype === "color") val = hexToColor(el.value);
        else val = el.value;
        currentProps[prop] = val;
        const out = el.parentElement && el.parentElement.querySelector(".wpgl-row__val");
        if (out && ptype === "slider") out.textContent = Number(el.value).toFixed(2);
        ctrl.setProperty(prop, val);
      }
    });

    root.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.tagName === "SELECT" && el.getAttribute("data-key")) {
        const key = el.getAttribute("data-key");
        settings[key] = key === "fps" || key === "dpr" || key === "rotate" ? Number(el.value) : el.value;
        ctrl.applySettings(key);
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !root.classList.contains("wpgl-hidden")) close();
    });

    // ---------------------------------------------------------------- 对外

    function open() {
      root.classList.remove("wpgl-hidden");
      document.body.classList.add("wpgl-panel-open");
      syncControls();
      applyRootClasses();
      renderGrid();
      syncFooter();
    }

    function close() {
      root.classList.add("wpgl-hidden");
      document.body.classList.remove("wpgl-panel-open");
    }

    function toggle() {
      if (root.classList.contains("wpgl-hidden")) open();
      else close();
    }

    function syncFooter() {
      const item = activeItem();
      if (item) {
        els.now.innerHTML = `<b>${esc(item.title)}</b> · ${esc(item.typeLabel)}${ctrl.paused ? " · 已暂停" : ""}`;
        els.dot.classList.remove("wpgl-dot--idle");
      } else {
        els.now.textContent = "未选择壁纸";
        els.dot.classList.add("wpgl-dot--idle");
      }
      els.pauseBtn.textContent = ctrl.paused ? "继续" : "暂停";
      els.pauseBtn.disabled = !item;
    }

    function updateFps(fps) {
      const t = `${Math.round(fps || 0)} fps`;
      els.fpsFoot.textContent = t;
      els.fps.textContent = String(Math.round(fps || 0));
    }

    syncFooter();
    applyRootClasses();

    return { open, close, toggle, render: renderGrid, syncFooter, updateFps, root, el: els };
  }

  global.WPUI = { mount };
})(typeof window !== "undefined" ? window : globalThis);
