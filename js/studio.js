/*
 * Particle Studio — editor
 * Потребитель ParticleStudio API (dogfooding).
 * v2.4.0: режим «Текст» (текст → частицы), экспорт text/textColor.
 */
(() => {
  "use strict";

  const VERSION = "2.4.0";

  const $ = id => document.getElementById(id);

  const hint = $("hint");
  const picker = $("picker");
  const bar = $("bar");
  const adv = $("adv");

  if (!window.ParticleStudio) {
    if (hint) {
      hint.innerHTML = "Не загружен particle.js";
      hint.classList.add("show");
    }
    return;
  }

  const els = {
    phys: $("phys"),
    rub: $("rub"),
    cha: $("cha"),
    rad: $("rad"),
    spd: $("spd"),
    den: $("den"),
    grn: $("grn"),

    asmSeg: $("assembleSeg"),
    sizeSeg: $("sizeSeg"),
    trn: $("transp"),

    usageSeg: $("usageSeg"),
    expSeg: $("exportSeg"),
    srcPath: $("srcPath"),
    exportWarning: $("exportWarning"),

    modeSeg: $("modeSeg"),
    textInput: $("textInput"),
    textColor: $("textColor"),

    save: $("save"),
    copy: $("copy"),
    advT: $("advToggle")
  };

  /* ========================= STATE ========================= */

  let phys = 0.5;
  let rubber = 0.35;
  let chaos = 0.25;
  let radiusCss = 50;
  let speed = 1;
  let density = 0.7;
  let grain = 1;
  let assemble = "random";
  let transp = false;
  let sizeCss = 512;

  let advOpen = false;
  let exportFormat = "html";
  let usageMode = "block";
  let srcPath = "particle.js";

  let mode = "image";
  let text = "404";
  let textColor = "#111111";

  try {
    const s = JSON.parse(localStorage.getItem("pls") || "null");

    if (s) {
      phys = s.phys ?? phys;
      rubber = s.rubber ?? rubber;
      chaos = s.chaos ?? chaos;
      radiusCss = s.radiusCss ?? radiusCss;
      speed = s.speed ?? speed;
      density = s.density ?? density;
      grain = s.grain ?? grain;
      assemble = s.assemble ?? assemble;
      transp = !!s.transp;
      sizeCss = s.sizeCss ?? sizeCss;
      advOpen = !!s.advOpen;
      exportFormat = s.exportFormat ?? "html";
      usageMode = s.usageMode === "preloader" ? "preloader" : "block";
      srcPath = typeof s.srcPath === "string" ? s.srcPath : "particle.js";
      mode = s.mode === "text" ? "text" : "image";
      text = typeof s.text === "string" ? s.text : "404";
      textColor = typeof s.textColor === "string" ? s.textColor : "#111111";
    }
  } catch (e) {}

  const blockId = "particle-studio-" + Math.random().toString(36).slice(2, 8);

  let runtimeSrcCache = null;
  let runtimePromise = null;
  let exportPreviewTimer = 0;

  /* ========================= UI HELPERS ========================= */

  function segSet(seg, val) {
    if (!seg) return;

    seg.querySelectorAll("button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === String(val));
    });
  }

  function reflectUI() {
    els.phys.value = phys * 100;
    els.rub.value = rubber * 100;
    els.cha.value = chaos * 100;
    els.rad.value = radiusCss;
    els.spd.value = ((speed - 0.3) / 2.2) * 100;
    els.den.value = density * 100;
    els.grn.value = grain * 100;

    segSet(els.asmSeg, assemble);
    segSet(els.sizeSeg, sizeCss);
    segSet(els.expSeg, exportFormat);
    segSet(els.usageSeg, usageMode);
    segSet(els.modeSeg, mode);

    els.trn.checked = transp;

    if (els.srcPath) {
      els.srcPath.value = srcPath;
    }
    if (els.textInput) {
      els.textInput.value = text;
    }
    if (els.textColor) {
      els.textColor.value = textColor;
    }

    if (advOpen) {
      adv.classList.add("open");
      els.advT.classList.add("on");
    } else {
      adv.classList.remove("open");
      els.advT.classList.remove("on");
    }
  }

  function persist() {
    try {
      localStorage.setItem("pls", JSON.stringify({
        phys,
        rubber,
        chaos,
        radiusCss,
        speed,
        density,
        grain,
        assemble,
        transp,
        sizeCss,
        advOpen,
        exportFormat,
        usageMode,
        srcPath,
        mode,
        text,
        textColor
      }));
    } catch (e) {}
  }

  /* ========================= PREVIEW ========================= */

  const fx = ParticleStudio.mount("#stage", {
    physics: phys,
    rubber: rubber,
    chaos: chaos,
    radius: radiusCss,
    speed: speed,
    density: density,
    grain: grain,
    entry: assemble,
    logoSize: sizeCss,
    background: transp ? "transparent" : "auto",
    quality: "high",
    motion: "auto",

    onTheme: t => {
      document.body.dataset.theme = t;
    },

    onBackground: b => {
      document.body.style.background = b;
    },

    onReady: () => {
      hint.classList.remove("show");
      bar.classList.add("show");
      scheduleExportPreview();
    },

    onError: err => {
      if (
        err.code === "load" ||
        err.code === "svg-size" ||
        err.code === "empty" ||
        err.code === "cors"
      ) {
        hint.classList.add("show");
      }
    }
  });

  if (!fx) return;

  hint.classList.add("show");
  reflectUI();

  let lastImage = null;

  if (mode === "text") {
    fx.setText(text, textColor);
  }

  function currentConfig() {
    return fx.config;
  }

  /* ========================= IMAGE INPUT ========================= */

  function readFile(f) {
    if (!f || !f.type.startsWith("image/")) return;

    const r = new FileReader();

    r.onload = () => {
      lastImage = r.result;
      mode = "image";
      segSet(els.modeSeg, mode);
      fx.update({ text: "" });
      fx.setImage(r.result);
      persist();
    };

    r.readAsDataURL(f);
  }

  hint.addEventListener("pointerdown", e => e.stopPropagation());

  hint.addEventListener("click", e => {
    e.stopPropagation();
    picker.click();
  });

  picker.addEventListener("change", () => {
    if (picker.files[0]) readFile(picker.files[0]);
  });

  window.addEventListener("dragover", e => e.preventDefault());

  window.addEventListener("drop", e => {
    e.preventDefault();

    if (e.dataTransfer.files[0]) {
      readFile(e.dataTransfer.files[0]);
    }
  });

  /* ========================= RUNTIME SOURCE ========================= */

  async function fetchRuntimeSrc() {
    const scriptEl = Array.from(document.scripts).find(s => {
      return s.src && /particle(\.min)?\.js/.test(s.src);
    });

    if (!scriptEl) return null;

    try {
      const resp = await fetch(scriptEl.src);

      if (!resp.ok) return null;

      return await resp.text();
    } catch (e) {
      return null;
    }
  }

  function ensureRuntimeSrc() {
    if (runtimeSrcCache !== null) {
      return Promise.resolve(runtimeSrcCache);
    }

    if (!runtimePromise) {
      runtimePromise = fetchRuntimeSrc().then(src => {
        runtimeSrcCache = src;
        return src;
      });
    }

    return runtimePromise;
  }

  /* ========================= EXPORT HELPERS ========================= */

  function safeJson(obj) {
    return JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /*
   * forStandalone = true  → демо-страница (прелоадер живёт ~4 c);
   * forStandalone = false → сниппет для реального сайта (hideOnLoad).
   */
  function exportConfig(forStandalone) {
    const c = currentConfig();

    const cfg = {
      image: c.image,
      physics: +c.physics.toFixed(2),
      rubber: +c.rubber.toFixed(2),
      chaos: +c.chaos.toFixed(2),
      radius: Math.round(c.radius),
      speed: +c.speed.toFixed(2),
      density: +c.density.toFixed(2),
      grain: +c.grain.toFixed(2),
      entry: c.entry,
      logoSize: Math.round(c.logoSize),
      background: c.background,
      motion: "auto",
      text: c.text || "",
      textColor: c.textColor || "#111111"
    };

    if (usageMode === "preloader") {
      if (forStandalone) {
        cfg.hideOnLoad = false;
        cfg.fallbackHideTimeout = 4000;
      } else {
        cfg.hideOnLoad = true;
        cfg.hideDelay = 400;
        cfg.fallbackHideTimeout = 7000;
      }

      cfg.applyPageTheme = true;
      cfg.applyPageBackground = true;
      cfg.zIndex = 2147483000;
    }

    return cfg;
  }

  function commentHeader() {
    return "<!-- Particle Studio studio v" + VERSION +
      " | engine v" + (window.ParticleStudio && ParticleStudio.version) +
      " | mode: " + usageMode +
      " | format: " + exportFormat + " -->";
  }

  function blockMarkup(id) {
    return '<div id="' + id + '" style="width:100%;height:400px;" aria-hidden="true"></div>';
  }

  function blockInitScript(id, cfgJson, target) {
    const getEl = target === "body"
      ? ""
      : 'var el = document.getElementById("' + id + '");\n    if (!el) return;\n    ';

    const bgHook = target === "body"
      ? "cfg.onBackground = function (b) { document.body.style.background = b; };\n    cfg.onTheme = function (t) { document.body.dataset.theme = t; };"
      : "cfg.onBackground = function (b) { el.style.background = b; };\n    cfg.onTheme = function (t) { el.dataset.theme = t; };";

    const mountCall = target === "body"
      ? 'ParticleStudio.mount("#' + id + '", cfg);'
      : "ParticleStudio.mount(el, cfg);";

    return `(function () {
  function init() {
    if (!window.ParticleStudio) return;
    ${getEl}var cfg = ${cfgJson};
    ${bgHook}
    ${mountCall}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();`;
  }

  function preloaderInitScript(cfgJson) {
    return `(function () {
  function init() {
    if (!window.ParticleStudio) return;
    ParticleStudio.fullscreen(${cfgJson});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();`;
  }

  function buildEmbed() {
    const cfgJson = safeJson(exportConfig(false));
    const src = escapeAttr(srcPath.trim() || "particle.js");

    if (usageMode === "preloader") {
      return [
        commentHeader(),
        '<script src="' + src + '"></script>',
        "<script>",
        preloaderInitScript(cfgJson),
        "</script>"
      ].join("\n");
    }

    return [
      commentHeader(),
      blockMarkup(blockId),
      '<script src="' + src + '"></script>',
      "<script>",
      blockInitScript(blockId, cfgJson, "el"),
      "</script>"
    ].join("\n");
  }

  function buildInline(runtimeSrc) {
    if (!runtimeSrc) {
      return "<!-- Particle Studio: не удалось прочитать particle.js. Запустите конструктор через локальный сервер. -->";
    }

    const cfgJson = safeJson(exportConfig(false));

    if (usageMode === "preloader") {
      return [
        commentHeader(),
        "<script>",
        runtimeSrc,
        "",
        preloaderInitScript(cfgJson),
        "</script>"
      ].join("\n");
    }

    return [
      commentHeader(),
      blockMarkup(blockId),
      "<script>",
      runtimeSrc,
      "",
      blockInitScript(blockId, cfgJson, "el"),
      "</script>"
    ].join("\n");
  }

  /* Самодостаточная демо-страница (кнопка «Сохранить» и формат HTML) */
  function buildStandalone(runtimeSrc) {
    if (!runtimeSrc) {
      return [
        "<!doctype html>",
        '<html lang="ru">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Particle Studio</title>",
        "</head>",
        "<body>",
        "<!-- Particle Studio: не удалось прочитать particle.js. Запустите конструктор через локальный сервер. -->",
        "</body>",
        "</html>"
      ].join("\n");
    }

    const isPre = usageMode === "preloader";

    const cfgJson = safeJson(exportConfig(true));

    const body = isPre ? "" : blockMarkup(blockId) + "\n";

    const demoNote = isPre
      ? "<!-- демо: прелоадер скроется примерно через 4 секунды -->\n"
      : "";

    const init = isPre
      ? preloaderInitScript(cfgJson)
      : blockInitScript(blockId, cfgJson, "body");

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Particle Studio</title>
  <style>
    html, body {
      margin: 0;
      height: 100%;
    }

    body {
      background: #ffffff;
    }
  </style>
</head>
<body>
${demoNote}${body}<script>
${runtimeSrc}
</script>
<script>
${init}
</script>
</body>
</html>`;
  }

  async function generateCode() {
    const runtimeSrc = await ensureRuntimeSrc();

    if (exportFormat === "embed") {
      return buildEmbed();
    }

    if (exportFormat === "inline") {
      return buildInline(runtimeSrc);
    }

    return buildStandalone(runtimeSrc);
  }

  /* ========================= EXPORT WARNING ========================= */

  function setWarning(text, isError) {
    if (!els.exportWarning) return;

    els.exportWarning.textContent = text || "";
    els.exportWarning.classList.toggle("error", !!isError);
  }

  async function updateExportPreview() {
    if (!els.exportWarning) return;

    try {
      const cfg = exportConfig(false);

      if (!cfg.image && !cfg.text) {
        setWarning("Загрузите изображение или введите текст.", true);
        return;
      }

      const runtimeSrc = await ensureRuntimeSrc();

      if (exportFormat !== "embed" && !runtimeSrc) {
        setWarning("Не удалось прочитать particle.js. Экспорт может быть неполным.", true);
        return;
      }

      const code = await generateCode();

      if (!code) {
        setWarning("Не удалось подготовить экспорт.", true);
        return;
      }

      const kb = Math.round(code.length / 1024);

      let msg = kb > 800
        ? "Размер экспорта: " + kb + " КБ. Рекомендуется уменьшить изображение."
        : "Размер экспорта: " + kb + " КБ.";

      if (exportFormat === "embed") {
        msg += " Embed: particle.js должен лежать по пути «" + (srcPath.trim() || "particle.js") + "».";
      }

      setWarning(msg, kb > 800);
    } catch (e) {
      setWarning("Ошибка экспорта: " + e.message, true);
    }
  }

  function scheduleExportPreview() {
    clearTimeout(exportPreviewTimer);

    exportPreviewTimer = setTimeout(() => {
      updateExportPreview();
    }, 250);
  }

  ensureRuntimeSrc().then(() => {
    scheduleExportPreview();
  });

  /* ========================= COPY / SAVE ========================= */

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}

    try {
      const ta = document.createElement("textarea");

      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";

      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand("copy");

      ta.remove();

      return ok;
    } catch (e) {
      return false;
    }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function prepareCopy() {
    const cfg = exportConfig(false);

    if (!cfg.image && !cfg.text) {
      setWarning("Сначала загрузите изображение или введите текст.", true);
      return null;
    }

    const runtimeSrc = await ensureRuntimeSrc();

    if (exportFormat !== "embed" && !runtimeSrc) {
      setWarning("Не удалось прочитать particle.js. Запустите конструктор через локальный сервер.", true);
      return null;
    }

    const code = await generateCode();

    updateExportPreview();

    return code;
  }

  /* «Копировать» — сниппет выбранного формата для вставки на сайт */
  els.copy.addEventListener("click", async () => {
    const code = await prepareCopy();

    if (code == null) return;

    const ok = await copyText(code);
    const old = els.copy.textContent;

    els.copy.textContent = ok ? "Скопировано" : "Ошибка";

    setTimeout(() => {
      els.copy.textContent = old;
    }, 1400);
  });

  /* «Сохранить» — всегда самодостаточная демо-страница */
  els.save.addEventListener("click", async () => {
    const cfg = exportConfig(true);

    if (!cfg.image && !cfg.text) {
      setWarning("Сначала загрузите изображение или введите текст.", true);
      return;
    }

    const runtimeSrc = await ensureRuntimeSrc();

    if (!runtimeSrc) {
      setWarning("Не удалось прочитать particle.js. Запустите конструктор через локальный сервер.", true);
      return;
    }

    const code = buildStandalone(runtimeSrc);

    download("particle-studio-" + usageMode + ".html", code);
  });

  /* ========================= PANEL EVENTS ========================= */

  bar.addEventListener("pointerdown", e => e.stopPropagation());

  els.advT.addEventListener("click", () => {
    advOpen = !advOpen;

    adv.classList.toggle("open", advOpen);
    els.advT.classList.toggle("on", advOpen);

    persist();
  });

  /* Sliders */

  els.phys.addEventListener("input", () => {
    phys = els.phys.value / 100;
    fx.update({ physics: phys });
    persist();
  });

  els.rub.addEventListener("input", () => {
    rubber = els.rub.value / 100;
    fx.update({ rubber: rubber });
    persist();
  });

  els.cha.addEventListener("input", () => {
    chaos = els.cha.value / 100;
    fx.update({ chaos: chaos });
    persist();
  });

  els.rad.addEventListener("input", () => {
    radiusCss = +els.rad.value;
    fx.update({ radius: radiusCss });
    persist();
  });

  els.spd.addEventListener("input", () => {
    speed = 0.3 + 2.2 * (els.spd.value / 100);
    fx.update({ speed: speed });
    persist();
  });

  els.den.addEventListener("input", () => {
    density = els.den.value / 100;
    fx.update({ density: density });
    persist();
    scheduleExportPreview();
  });

  els.grn.addEventListener("input", () => {
    grain = els.grn.value / 100;
    fx.update({ grain: grain });
    persist();
    scheduleExportPreview();
  });

  /* Segment controls */

  els.asmSeg.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;

    assemble = b.dataset.v;

    segSet(els.asmSeg, assemble);
    fx.update({ entry: assemble });

    persist();
    scheduleExportPreview();
  });

  els.sizeSeg.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;

    sizeCss = +b.dataset.v;

    segSet(els.sizeSeg, sizeCss);
    fx.update({ logoSize: sizeCss });

    persist();
    scheduleExportPreview();
  });

  els.usageSeg.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;

    usageMode = b.dataset.v === "preloader" ? "preloader" : "block";

    segSet(els.usageSeg, usageMode);

    persist();
    scheduleExportPreview();
  });

  els.expSeg.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;

    exportFormat = b.dataset.v;

    segSet(els.expSeg, exportFormat);

    persist();
    scheduleExportPreview();
  });

  if (els.srcPath) {
    els.srcPath.addEventListener("input", () => {
      srcPath = els.srcPath.value.trim();

      persist();
      scheduleExportPreview();
    });
  }

  els.trn.addEventListener("change", () => {
    transp = els.trn.checked;

    fx.update({ background: transp ? "transparent" : "auto" });

    persist();
    scheduleExportPreview();
  });

  /* ========================= IMAGE / TEXT MODE ========================= */

  function applySource() {
    if (mode === "text") {
      fx.update({ text: text, textColor: textColor });
    } else {
      fx.update({ text: "" });
      if (lastImage) fx.setImage(lastImage);
    }
  }

  if (els.modeSeg) {
    els.modeSeg.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;

      mode = b.dataset.v === "text" ? "text" : "image";

      segSet(els.modeSeg, mode);
      applySource();

      persist();
      scheduleExportPreview();
    });
  }

  if (els.textInput) {
    els.textInput.addEventListener("input", () => {
      text = els.textInput.value;

      if (mode === "text" && text) applySource();

      persist();
      scheduleExportPreview();
    });
  }

  if (els.textColor) {
    els.textColor.addEventListener("input", () => {
      textColor = els.textColor.value;

      if (mode === "text" && text) applySource();

      persist();
      scheduleExportPreview();
    });
  }

  /* Presets */

  document.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      const p = ParticleStudio.presets[ch.dataset.p];
      if (!p) return;

      phys = p.physics;
      rubber = p.rubber;
      chaos = p.chaos;
      speed = p.speed;

      fx.update({
        physics: phys,
        rubber: rubber,
        chaos: chaos,
        speed: speed
      });

      reflectUI();
      persist();
      scheduleExportPreview();

      document.querySelectorAll(".chip").forEach(c => {
        c.classList.toggle("on", c === ch);
      });
    });
  });
})();
