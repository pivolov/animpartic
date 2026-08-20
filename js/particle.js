/*!
 * Particle Studio v2.4.0
 * Embeddable interactive particle runtime.
 * MIT License
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const VERSION = "2.4.0";

  const PHYS_DEFAULT = 0.5, RUBBER_DEFAULT = 0.35, CHAOS_DEFAULT = 0.25;
  const RADIUS_DEFAULT = 50, SPEED_DEFAULT = 1, DENSITY_DEFAULT = 0.7;
  const GRAIN_DEFAULT = 1, ASSEMBLE_DEFAULT = "random", LOGO_SIZE_DEFAULT = 512;
  const SPRING = 0.03, FRICTION = 0.82, ASSEMBLE_EASE = 1400, SIDES_STAGGER = 1500;
  const CURSOR_SMOOTH = 0.18, CURSOR_VMAX = 55, SHOCK_RADIUS = 240, SHOCK_FORCE = 16;
  const BREATH_MIN = 0.4, BREATH_MAX = 1.2, FLOW_AMP = 0.8;
  const FREQS = [0.6, 0.9, 1.2, 1.5];
  const DPR_CAP = 1.75, ADAPT_WINDOW = 3000, ADAPT_LO = 13, EMERG_MS = 34;
  const ACTIVE_FLOOR = 30000, MAX_BUCKETS = 24, DEFAULT_LIGHT_BG = "#ffffff";
  const HN = 5;
  const WK = [1, 0.55, 0.32, 0.18, 0.10];
  const RK = [1, 0.94, 0.86, 0.78, 0.70];
  const TIERS = {
    high: { maxLive: 150000, staticMax: 1500000, pureMax: 300000 },
    balanced: { maxLive: 60000, staticMax: 400000, pureMax: 150000 },
    lite: { maxLive: 24000, staticMax: 150000, pureMax: 60000 }
  };
  const PRESETS = {
    sand: { physics: 1, rubber: 0.15, chaos: 0, speed: 1 },
    rubber: { physics: 0.25, rubber: 0.85, chaos: 0, speed: 1 },
    haze: { physics: 0.18, rubber: 0.4, chaos: 0, speed: 0.55 }
  };
  const ENTRIES = ["random", "sides", "center", "ring", "rain"];
  const HOOK_NAMES = ["onTheme", "onBackground", "onReady", "onError"];
  const registry = new Set();

  function deviceTier() {
    const nav = window.navigator || {};
    const memory = nav.deviceMemory || 4;
    const cores = nav.hardwareConcurrency || 4;
    if (memory <= 2 || cores <= 3) return "lite";
    if (memory <= 4 || cores <= 4) return "balanced";
    return "high";
  }
  function autoTier() {
    const base = deviceTier();
    if (registry.size <= 1) return base;
    if (registry.size <= 3) return base === "high" ? "balanced" : "lite";
    return "lite";
  }
  function clamp01(v) { return Math.min(1, Math.max(0, +v || 0)); }
  function reportError(options, err) {
    if (options && typeof options.onError === "function") options.onError(err);
    if (!(options && options.silent) && typeof console !== "undefined") {
      console.warn("[ParticleStudio]", err.code + ":", err.message);
    }
  }
  /* v2.4.0: текст → canvas, который движок сэmplит как картинку */
  function makeTextCanvas(text, color) {
    const fs = 220, pad = 30;
    const font = "800 " + fs + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const w = Math.max(2, Math.ceil(probe.measureText(text).width));
    const c = document.createElement("canvas");
    c.width = w + pad * 2;
    c.height = fs + pad * 2;
    const ctx = c.getContext("2d");
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color || "#111111";
    ctx.fillText(text, c.width / 2, c.height / 2);
    return c;
  }

  function normalizeOptions(opts) {
    opts = opts || {};
    const cfg = {
      image: "", effect: null,
      physics: PHYS_DEFAULT, rubber: RUBBER_DEFAULT, chaos: CHAOS_DEFAULT,
      radius: RADIUS_DEFAULT, speed: SPEED_DEFAULT,
      density: DENSITY_DEFAULT, grain: GRAIN_DEFAULT,
      entry: ASSEMBLE_DEFAULT, logoSize: LOGO_SIZE_DEFAULT,
      background: "auto", pointerEvents: true, interaction: "cursor",
      motion: "auto", quality: "auto", silent: false,
      text: "", textColor: "#111111"
    };
    const preset = opts.effect && PRESETS[opts.effect];
    if (preset) Object.assign(cfg, preset);
    for (const k in cfg) {
      if (opts[k] !== undefined && opts[k] !== null) cfg[k] = opts[k];
    }
    cfg.physics = clamp01(cfg.physics); cfg.rubber = clamp01(cfg.rubber);
    cfg.chaos = clamp01(cfg.chaos); cfg.density = clamp01(cfg.density);
    cfg.grain = clamp01(cfg.grain);
    cfg.speed = Math.min(2.5, Math.max(0.3, +cfg.speed || 1));
    cfg.radius = Math.max(1, +cfg.radius || RADIUS_DEFAULT);
    cfg.logoSize = Math.max(16, +cfg.logoSize || LOGO_SIZE_DEFAULT);
    if (ENTRIES.indexOf(cfg.entry) === -1) cfg.entry = ASSEMBLE_DEFAULT;
    if (["auto", "full", "reduced"].indexOf(cfg.motion) === -1) cfg.motion = "auto";
    if (!TIERS[cfg.quality]) cfg.quality = "auto";
    cfg.pointerEvents = opts.pointerEvents !== false;
    cfg.interaction = opts.interaction === "none" ? "none" : "cursor";
    cfg.image = opts.image || "";
    cfg.silent = !!opts.silent;
    return cfg;
  }

  const COMPONENT_CSS =
    ":host{display:block;position:relative;width:100%;height:100%;overflow:hidden;contain:layout paint;}" +
    "canvas{display:block;width:100%;height:100%;opacity:1;transition:opacity .7s ease;}";
  const CURSOR_LIGHT =
    "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='22'%20height='22'%3E%3Ccircle%20cx='11'%20cy='11'%20r='4.5'%20fill='%23111111'/%3E%3C/svg%3E\") 11 11, auto";
  const CURSOR_DARK =
    "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='22'%20height='22'%3E%3Ccircle%20cx='11'%20cy='11'%20r='4.5'%20fill='%23ffffff'%20fill-opacity='0.9'/%3E%3C/svg%3E\") 11 11, auto";

  function createEngine(hostEl, canvas, cfg, hooks) {
    hooks = hooks || {};
    const tierName = cfg.quality === "auto" ? autoTier() : cfg.quality;
    const TIER = TIERS[tierName] || TIERS.high;
    const MAX_LIVE = TIER.maxLive;
    const STATIC_MAX_T = TIER.staticMax;
    const ALLOC = TIER.pureMax || TIER.maxLive;

    let phys = cfg.physics, rubber = cfg.rubber, chaos = cfg.chaos;
    let radiusCss = cfg.radius, speed = cfg.speed, density = cfg.density;
    let grain = cfg.grain, assemble = cfg.entry;
    let transp = cfg.background === "transparent";
    let customBg = cfg.background !== "auto" && cfg.background !== "transparent" ? cfg.background : null;
    let sizeCss = cfg.logoSize;

    const X = new Float32Array(ALLOC), Y = new Float32Array(ALLOC);
    const VX = new Float32Array(ALLOC), VY = new Float32Array(ALLOC);
    const TX = new Float32Array(ALLOC), TY = new Float32Array(ALLOC);
    const SZ = new Float32Array(ALLOC), AMP = new Float32Array(ALLOC);
    const RIM = new Float32Array(ALLOC), CHA = new Float32Array(ALLOC);
    const DEL = new Float32Array(ALLOC), SMUL = new Float32Array(ALLOC);
    const OSC = new Uint8Array(ALLOC), BKT = new Uint8Array(ALLOC);
    const COL = new Float32Array(ALLOC * 4);
    const POS = new Float32Array(ALLOC * 2);
    const HX = new Float32Array(HN), HY = new Float32Array(HN);
    const oscTable = new Float32Array(32);
    let bucketLists = [], bucketColors = [], bucketNum = 0;
    let count = 0, active = 0;
    let DPR = 1, W = 0, H = 0, cssW = 0, cssH = 0;
    let mouseX = -1e4, mouseY = -1e4, mouseIn = false, mouseJustIn = false;
    let lmX = 0, lmY = 0, smvX = 0, smvY = 0;
    let lastT = 0, tSim = 0, buildAt = 0, adaptAcc = 0, adaptN = 0, adaptUntil = 0;
    let running = false, loopScheduled = false, autoPaused = false, destroyed = false;
    let fadeOnBuild = true;
    let logoImg = null, currentURL = "", currentText = "";
    let rebuildT = 0, resizeQueued = false, cachedRect = null;

    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    function reducedNow() {
      return cfg.motion === "reduced" || (cfg.motion === "auto" && !!(mq && mq.matches));
    }
    function onMotionPrefChange() {
      if (destroyed) return;
      if (reducedNow()) { if (logoImg) staticRender(); }
      else if (running) start();
    }
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", onMotionPrefChange);
      else if (mq.addListener) mq.addListener(onMotionPrefChange);
    }

    let gl = null, ctx2d = null;
    let prog, aPos, aCol, aSize, uRes, uMul, posBuf, colBuf, sizeBuf;
    let qProg, qBuf, fbo, fboTex, uTex, uResQ, uFade, uHole, uHr, hasStatic = false;

    function initGL() {
      gl = canvas.getContext("webgl", {
        alpha: true, premultipliedAlpha: true,
        antialias: false, depth: false, stencil: false
      });
      if (!gl) return false;
      const VS =
        "attribute vec2 a_pos;attribute vec4 a_col;attribute float a_size;" +
        "uniform vec2 u_res;uniform float u_mul;varying vec4 v_col;" +
        "void main(){" +
        "vec2 c=vec2(a_pos.x/u_res.x*2.0-1.0,1.0-a_pos.y/u_res.y*2.0);" +
        "gl_Position=vec4(c,0.0,1.0);gl_PointSize=a_size*u_mul;v_col=a_col;}";
      const FS =
        "precision mediump float;varying vec4 v_col;" +
        "void main(){float d=length(gl_PointCoord-vec2(0.5));" +
        "float a=smoothstep(0.5,0.32,d)*v_col.a;" +
        "if(a<0.02)discard;gl_FragColor=vec4(v_col.rgb*a,a);}";
      const QVS =
        "attribute vec2 a_q;varying vec2 v_uv;" +
        "void main(){v_uv=a_q*0.5+0.5;gl_Position=vec4(a_q,0.0,1.0);}";
      const QFS =
        "precision mediump float;varying vec2 v_uv;" +
        "uniform sampler2D u_tex;uniform vec2 u_res;uniform float u_fade;" +
        "uniform vec2 u_hole[5];uniform float u_hr[5];" +
        "void main(){" +
        "vec4 c=texture2D(u_tex,v_uv);" +
        "vec2 px=vec2(v_uv.x*u_res.x,(1.0-v_uv.y)*u_res.y);" +
        "float ha=0.0;" +
        "for(int i=0;i<5;i++){" +
        "float d=distance(px,u_hole[i]);" +
        "ha=max(ha,step(1.0,u_hr[i])*(1.0-smoothstep(max(u_hr[i],0.001)*0.55,max(u_hr[i],0.001),d)));" +
        "}" +
        "float a=c.a*u_fade*(1.0-ha);" +
        "if(a<0.01)discard;gl_FragColor=vec4(c.rgb*a,a);}";
      function sh(t, s) {
        const o = gl.createShader(t);
        gl.shaderSource(o, s);
        gl.compileShader(o);
        return o;
      }
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
      gl.useProgram(prog);
      aPos = gl.getAttribLocation(prog, "a_pos");
      aCol = gl.getAttribLocation(prog, "a_col");
      aSize = gl.getAttribLocation(prog, "a_size");
      uRes = gl.getUniformLocation(prog, "u_res");
      uMul = gl.getUniformLocation(prog, "u_mul");
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, POS.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      colBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, COL.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);
      sizeBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, SZ.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aSize);
      gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
      qProg = gl.createProgram();
      gl.attachShader(qProg, sh(gl.VERTEX_SHADER, QVS));
      gl.attachShader(qProg, sh(gl.FRAGMENT_SHADER, QFS));
      gl.linkProgram(qProg);
      if (!gl.getProgramParameter(qProg, gl.LINK_STATUS)) { gl = null; return false; }
      qBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      uTex = gl.getUniformLocation(qProg, "u_tex");
      uResQ = gl.getUniformLocation(qProg, "u_res");
      uFade = gl.getUniformLocation(qProg, "u_fade");
      uHole = gl.getUniformLocation(qProg, "u_hole[0]");
      uHr = gl.getUniformLocation(qProg, "u_hr[0]");
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      return true;
    }

    const USE_GL = initGL();
    if (!USE_GL) ctx2d = canvas.getContext("2d", { desynchronized: true });

    function allocStaticTarget() {
      if (!USE_GL) return;
      if (fboTex) gl.deleteTexture(fboTex);
      if (fbo) gl.deleteFramebuffer(fbo);
      fboTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      hasStatic = false;
    }

    let offStat = null;

    function fail(err) {
      if (hooks.onError) hooks.onError(err);
      if (!cfg.silent && typeof console !== "undefined") {
        console.warn("[ParticleStudio]", err.code + ":", err.message);
      }
    }

    function setTheme(theme) {
      canvas.style.cursor =
        cfg.pointerEvents && cfg.interaction !== "none"
          ? (theme === "dark" ? CURSOR_DARK : CURSOR_LIGHT)
          : "";
      if (hooks.onTheme) hooks.onTheme(theme);
    }

    function setImage(src) {
      if (destroyed) return;
      currentURL = src;
      currentText = "";
      const img = new Image();
      img.onload = () => {
        if (destroyed || currentURL !== src) return;
        logoImg = img;
        fadeOnBuild = true;
        if (!resize()) {
          fail({ code: "empty", message: "Контейнер имеет нулевой размер" });
          return;
        }
        build(img, false);
        if (hooks.onReady) hooks.onReady(api);
        if (reducedNow()) staticRender();
        else start();
      };
      img.onerror = () => {
        logoImg = null;
        fail({ code: "load", message: "Не удалось загрузить изображение: " + src });
      };
      img.src = src;
    }

    /* v2.4.0 */
    function setText(text, color) {
      if (destroyed || !text) return;
      currentText = String(text);
      currentURL = "";
      logoImg = makeTextCanvas(currentText, color || cfg.textColor);
      fadeOnBuild = true;
      if (!resize()) {
        fail({ code: "empty", message: "Контейнер имеет нулевой размер" });
        return;
      }
      build(logoImg, false);
      if (hooks.onReady) hooks.onReady(api);
      if (reducedNow()) staticRender();
      else start();
    }

    function resize() {
      const cw = hostEl.clientWidth, ch = hostEl.clientHeight;
      if (!cw || !ch) return false;
      cssW = cw; cssH = ch;
      DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      W = canvas.width = Math.round(cw * DPR);
      H = canvas.height = Math.round(ch * DPR);
      cachedRect = null;
      if (USE_GL && logoImg) allocStaticTarget();
      if (logoImg) { fadeOnBuild = false; build(logoImg, true); }
      if (reducedNow()) staticRender();
      return true;
    }

    const ro = "ResizeObserver" in window
      ? new ResizeObserver(() => {
          if (resizeQueued || destroyed) return;
          resizeQueued = true;
          requestAnimationFrame(() => {
            resizeQueued = false;
            if (!destroyed) resize();
          });
        })
      : null;
    if (ro) ro.observe(hostEl);
    else window.addEventListener("resize", () => { if (!destroyed) resize(); });

    const io = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          const visible = entries[entries.length - 1].isIntersecting;
          if (!visible) autoPaused = true;
          else if (autoPaused) {
            autoPaused = false;
            if (running && !loopScheduled) start();
          }
        })
      : null;
    if (io) io.observe(hostEl);

    function onVisibility() { lastT = performance.now(); }
    document.addEventListener("visibilitychange", onVisibility);

    function rect() {
      if (!cachedRect) cachedRect = canvas.getBoundingClientRect();
      return cachedRect;
    }
    function onScrollInvalidate() { cachedRect = null; }
    function onPointerMove(e) {
      const r = rect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (!mouseIn) { mouseIn = true; mouseJustIn = true; lmX = x; lmY = y; }
      mouseX = x; mouseY = y;
    }
    function onPointerLeave() { mouseIn = false; mouseX = -1e4; mouseY = -1e4; }
    function onPointerDown(e) {
      if (reducedNow()) return;
      const r = rect();
      shock(e.clientX - r.left, e.clientY - r.top);
    }
    function applyPointerMode() {
      canvas.style.pointerEvents = cfg.pointerEvents ? "" : "none";
      canvas.style.touchAction = cfg.pointerEvents && cfg.interaction !== "none" ? "none" : "";
      if (cfg.pointerEvents && cfg.interaction !== "none") {
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerleave", onPointerLeave);
        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("scroll", onScrollInvalidate, true);
      } else {
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("scroll", onScrollInvalidate, true);
        mouseIn = false; mouseX = -1e4; mouseY = -1e4;
      }
    }

    function build(img, keepPositions) {
      const oldCount = count;
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) {
        fail({
          code: "svg-size",
          message: "У изображения нет intrinsic-размеров (например, SVG без width/height). Задайте logoSize или добавьте размеры в SVG."
        });
        return;
      }
      const baseCss = Math.min(cssW || 1, cssH || 1);
      const sideCss = Math.min(sizeCss, baseCss * 0.92);
      const side = sideCss * DPR;
      const sc = side / Math.max(nw, nh);
      const dw = Math.max(2, Math.round(nw * sc));
      const dh = Math.max(2, Math.round(nh * sc));
      const ox = Math.round((W - dw) / 2);
      const oy = Math.round((H - dh) / 2);
      const off = document.createElement("canvas");
      off.width = dw; off.height = dh;
      const octx = off.getContext("2d", { willReadFrequently: true });
      octx.drawImage(img, 0, 0, dw, dh);
      let data;
      try {
        data = octx.getImageData(0, 0, dw, dh).data;
      } catch (e) {
        fail({
          code: "cors",
          message: "getImageData заблокирован (CORS). Используйте same-origin изображение, dataURL или сервер с CORS-заголовками."
        });
        return;
      }
      let hasAlpha = false;
      for (let i = 3; i < data.length; i += 4 * 97) {
        if (data[i] < 250) { hasAlpha = true; break; }
      }
      function px(cx, cy) {
        const i = (cy * dw + cx) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      }
      const tl = px(0, 0), tr = px(dw - 1, 0), bl = px(0, dh - 1), br = px(dw - 1, dh - 1);
      const bg = [
        (tl[0] + tr[0] + bl[0] + br[0]) >> 2,
        (tl[1] + tr[1] + bl[1] + br[1]) >> 2,
        (tl[2] + tr[2] + bl[2] + br[2]) >> 2
      ];
      const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
      setTheme(hasAlpha || transp ? "light" : lum < 0.5 ? "dark" : "light");
      const bgCss = transp
        ? ""
        : customBg
          ? customBg
          : hasAlpha
            ? DEFAULT_LIGHT_BG
            : "linear-gradient(135deg, rgb(" + tl.join(",") + "), rgb(" + br.join(",") + "))";
      if (hooks.onBackground) hooks.onBackground(bgCss);
      function inMask(i) {
        const a = data[i + 3];
        if (hasAlpha) return a > 128;
        if (a < 128) return false;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        return dr * dr + dg * dg + db * db > 40 * 40;
      }
      const gapCss = 1.2 - 0.85 * density;
      let gapDev = Math.max(1, Math.round(gapCss * DPR));
      let est = (dw / gapDev) * (dh / gapDev);
      if (est > STATIC_MAX_T) {
        gapDev = Math.max(1, Math.round(gapDev * Math.sqrt(est / STATIC_MAX_T)));
      }
      const maskW = Math.ceil(dw / gapDev);
      const maskH = Math.ceil(dh / gapDev);
      const maskIdx = new Uint32Array(maskW * maskH);
      let total = 0;
      for (let py = 0; py < dh; py += gapDev) {
        for (let pxx = 0; pxx < dw; pxx += gapDev) {
          if (inMask((py * dw + pxx) * 4)) maskIdx[total++] = py * dw + pxx;
        }
      }
      if (!total) {
        count = 0; active = 0; hasStatic = false; offStat = null;
        fail({ code: "empty", message: "Маска изображения пуста (прозрачность/фон не содержат видимых пикселей)" });
        return;
      }
      const pureParticles = total > MAX_LIVE;
      const n = pureParticles ? Math.min(total, ALLOC) : total;
      const sizeScale = pureParticles ? Math.sqrt(total / n) : 1;
      const sAvg = [], sN = [];
      let sNum = 0;
      const sBkt = new Uint8Array(total);
      for (let s = 0; s < total; s++) {
        const li = maskIdx[s] * 4;
        const r = data[li], g = data[li + 1], b = data[li + 2], al = data[li + 3];
        let bi = -1, best = 1e9;
        for (let k = 0; k < sNum; k++) {
          const e = sAvg[k];
          const dr = r - e[0], dg = g - e[1], db = b - e[2], da = al - e[3];
          const d = dr * dr + dg * dg + db * db + da * da;
          if (d < best) { best = d; bi = k; }
        }
        if (bi === -1 || (best > 900 && sNum < MAX_BUCKETS)) {
          bi = sNum++; sAvg[bi] = [r, g, b, al]; sN[bi] = 1;
        } else {
          const nn = ++sN[bi], e = sAvg[bi];
          e[0] += (r - e[0]) / nn; e[1] += (g - e[1]) / nn;
          e[2] += (b - e[2]) / nn; e[3] += (al - e[3]) / nn;
        }
        sBkt[s] = bi;
      }
      const sSize = Math.max(1.1, gapDev) * 1.05;
      if (USE_GL) {
        allocStaticTarget();
        const sp = new Float32Array(total * 2);
        const sc4 = new Float32Array(total * 4);
        const ss = new Float32Array(total);
        for (let s = 0; s < total; s++) {
          const li = maskIdx[s];
          sp[s * 2] = ox + (li % dw);
          sp[s * 2 + 1] = oy + ((li / dw) | 0);
          const e = sAvg[sBkt[s]];
          sc4[s * 4] = e[0] / 255; sc4[s * 4 + 1] = e[1] / 255;
          sc4[s * 4 + 2] = e[2] / 255; sc4[s * 4 + 3] = e[3] / 255;
          ss[s] = sSize;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, W, H);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.uniform2f(uRes, W, H);
        gl.uniform1f(uMul, 1);
        const tb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tb);
        gl.bufferData(gl.ARRAY_BUFFER, sp, gl.STATIC_DRAW);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        const cb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cb);
        gl.bufferData(gl.ARRAY_BUFFER, sc4, gl.STATIC_DRAW);
        gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);
        const sb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, sb);
        gl.bufferData(gl.ARRAY_BUFFER, ss, gl.STATIC_DRAW);
        gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, total);
        gl.deleteBuffer(tb); gl.deleteBuffer(cb); gl.deleteBuffer(sb);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
        gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
        hasStatic = true;
      } else {
        offStat = document.createElement("canvas");
        offStat.width = W; offStat.height = H;
        const sctx = offStat.getContext("2d");
        const lists = Array.from({ length: sNum }, () => []);
        for (let s = 0; s < total; s++) lists[sBkt[s]].push(maskIdx[s]);
        for (let k = 0; k < sNum; k++) {
          const e = sAvg[k];
          sctx.fillStyle = "rgba(" + (e[0] | 0) + "," + (e[1] | 0) + "," + (e[2] | 0) + "," + (e[3] / 255).toFixed(3) + ")";
          sctx.beginPath();
          for (let j = 0; j < lists[k].length; j++) {
            const li = lists[k][j];
            const x = ox + (li % dw), y = oy + ((li / dw) | 0);
            sctx.rect(x - sSize * 0.5, y - sSize * 0.5, sSize, sSize);
          }
          sctx.fill();
        }
        hasStatic = true;
      }
      const step = total / n;
      const off0 = Math.random() * step;
      const bucketAvg = [], bucketN = [];
      bucketNum = 0; count = 0;
      const cx0 = ox + dw / 2, cy0 = oy + dh / 2;
      const ringR = Math.max(dw, dh) * 0.75;
      for (let s = 0; s < n; s++) {
        const sourceIndex = maskIdx[Math.min(total - 1, (off0 + s * step) | 0)];
        const li = sourceIndex * 4;
        const id = count++;
        TX[id] = ox + (sourceIndex % dw);
        TY[id] = oy + ((sourceIndex / dw) | 0);
        const r = data[li], g = data[li + 1], b = data[li + 2], al = data[li + 3];
        let bi = -1, best = 1e9;
        for (let k = 0; k < bucketNum; k++) {
          const e = bucketAvg[k];
          const dr = r - e[0], dg = g - e[1], db = b - e[2], da = al - e[3];
          const d = dr * dr + dg * dg + db * db + da * da;
          if (d < best) { best = d; bi = k; }
        }
        if (bi === -1 || (best > 900 && bucketNum < MAX_BUCKETS)) {
          bi = bucketNum++; bucketAvg[bi] = [r, g, b, al]; bucketN[bi] = 1;
        } else {
          const nn = ++bucketN[bi], e = bucketAvg[bi];
          e[0] += (r - e[0]) / nn; e[1] += (g - e[1]) / nn;
          e[2] += (b - e[2]) / nn; e[3] += (al - e[3]) / nn;
        }
        BKT[id] = bi;
        if (!(keepPositions && id < oldCount)) {
          if (assemble === "center") {
            X[id] = cx0 + (Math.random() - 0.5) * 50 * DPR;
            Y[id] = cy0 + (Math.random() - 0.5) * 50 * DPR;
            DEL[id] = Math.random() * 400; SMUL[id] = 0.6 + Math.random() * 0.8;
          } else if (assemble === "ring") {
            const an = Math.random() * Math.PI * 2;
            const rr = ringR * (0.9 + Math.random() * 0.3);
            X[id] = cx0 + Math.cos(an) * rr; Y[id] = cy0 + Math.sin(an) * rr;
            DEL[id] = Math.random() * 600; SMUL[id] = 0.6 + Math.random() * 0.8;
          } else if (assemble === "rain") {
            X[id] = TX[id] + (Math.random() - 0.5) * 30 * DPR;
            Y[id] = -Math.random() * H * 0.3;
            DEL[id] = Math.random() * 900; SMUL[id] = 0.6 + Math.random() * 0.8;
          } else if (assemble === "sides") {
            const an = Math.random() * Math.PI * 2;
            const rr = Math.max(W, H) * (0.6 + Math.random() * 0.55);
            X[id] = W * 0.5 + Math.cos(an) * rr;
            Y[id] = H * 0.5 + Math.sin(an) * rr;
            DEL[id] = Math.random() * SIDES_STAGGER;
            SMUL[id] = 0.45 + Math.random() * 1.1;
          } else {
            X[id] = Math.random() * W; Y[id] = Math.random() * H;
            DEL[id] = 0; SMUL[id] = 1;
          }
          VX[id] = 0; VY[id] = 0;
        } else {
          DEL[id] = 0; SMUL[id] = 1;
        }
        SZ[id] = Math.max(1, (Math.random() < 0.1 ? 1.75 : 1.0) * DPR * sizeScale);
        AMP[id] = (BREATH_MIN + Math.random() * (BREATH_MAX - BREATH_MIN)) * DPR;
        RIM[id] = 0.75 + Math.random() * 0.7;
        CHA[id] = Math.random();
        OSC[id] = (Math.random() * 32) | 0;
      }
      for (let i = count - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        if (j === i) continue;
        let t;
        t = X[i]; X[i] = X[j]; X[j] = t;
        t = Y[i]; Y[i] = Y[j]; Y[j] = t;
        t = VX[i]; VX[i] = VX[j]; VX[j] = t;
        t = VY[i]; VY[i] = VY[j]; VY[j] = t;
        t = TX[i]; TX[i] = TX[j]; TX[j] = t;
        t = TY[i]; TY[i] = TY[j]; TY[j] = t;
        t = SZ[i]; SZ[i] = SZ[j]; SZ[j] = t;
        t = AMP[i]; AMP[i] = AMP[j]; AMP[j] = t;
        t = RIM[i]; RIM[i] = RIM[j]; RIM[j] = t;
        t = CHA[i]; CHA[i] = CHA[j]; CHA[j] = t;
        t = DEL[i]; DEL[i] = DEL[j]; DEL[j] = t;
        t = SMUL[i]; SMUL[i] = SMUL[j]; SMUL[j] = t;
        let u = OSC[i]; OSC[i] = OSC[j]; OSC[j] = u;
        u = BKT[i]; BKT[i] = BKT[j]; BKT[j] = u;
      }
      for (let i = 0; i < count; i++) {
        const e = bucketAvg[BKT[i]];
        COL[i * 4] = e[0] / 255; COL[i * 4 + 1] = e[1] / 255;
        COL[i * 4 + 2] = e[2] / 255; COL[i * 4 + 3] = e[3] / 255;
      }
      if (USE_GL) {
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, COL.subarray(0, count * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, SZ.subarray(0, count));
      } else {
        const cnts = new Uint32Array(bucketNum), heads = new Uint32Array(bucketNum);
        for (let i = 0; i < count; i++) cnts[BKT[i]]++;
        bucketLists = new Array(bucketNum);
        for (let k = 0; k < bucketNum; k++) bucketLists[k] = new Uint32Array(cnts[k]);
        for (let i = 0; i < count; i++) bucketLists[BKT[i]][heads[BKT[i]]++] = i;
        bucketColors = bucketAvg.map(
          e => "rgba(" + (e[0] | 0) + "," + (e[1] | 0) + "," + (e[2] | 0) + "," + (e[3] / 255).toFixed(3) + ")"
        );
      }
      if (pureParticles) { hasStatic = false; offStat = null; }
      active = count;
      buildAt = performance.now();
      adaptAcc = 0; adaptN = 0;
      adaptUntil = buildAt + ADAPT_WINDOW;
    }

    const holePos = new Float32Array(HN * 2);
    const holeR = new Float32Array(HN);

    function currentFade(now) {
      if (!fadeOnBuild) return 1;
      const f = Math.min(1, Math.max(0, (now - buildAt - 300) / 900));
      return f * f * (3 - 2 * f);
    }

    function renderGL(now) {
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (hasStatic) {
        const fade = reducedNow() ? 1 : currentFade(now);
        if (fade > 0) {
          gl.useProgram(qProg);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fboTex);
          gl.uniform1i(uTex, 0);
          gl.uniform2f(uResQ, W, H);
          gl.uniform1f(uFade, fade);
          const rb = radiusCss * DPR;
          for (let i = 0; i < HN; i++) {
            holePos[i * 2] = mouseIn ? HX[i] : -1e4;
            holePos[i * 2 + 1] = mouseIn ? HY[i] : -1e4;
            holeR[i] = mouseIn ? rb * RK[i] : 0;
          }
          gl.uniform2fv(uHole, holePos);
          gl.uniform1fv(uHr, holeR);
          gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
          const aq = gl.getAttribLocation(qProg, "a_q");
          gl.enableVertexAttribArray(aq);
          gl.vertexAttribPointer(aq, 2, gl.FLOAT, false, 0, 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
      gl.useProgram(prog);
      gl.uniform2f(uRes, W, H);
      gl.uniform1f(uMul, grain);
      for (let i = 0; i < active; i++) {
        POS[i * 2] = X[i]; POS[i * 2 + 1] = Y[i];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, POS.subarray(0, active * 2));
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, active);
    }

    function render2D(now) {
      ctx2d.clearRect(0, 0, W, H);
      if (hasStatic && offStat) {
        const fade = reducedNow() ? 1 : currentFade(now);
        if (fade > 0) {
          ctx2d.globalAlpha = fade;
          ctx2d.drawImage(offStat, 0, 0);
          ctx2d.globalAlpha = 1;
          if (mouseIn) {
            ctx2d.globalCompositeOperation = "destination-out";
            const rb = radiusCss * DPR;
            for (let i = 0; i < HN; i++) {
              const rr = rb * RK[i];
              if (rr <= 0) continue;
              const g = ctx2d.createRadialGradient(HX[i], HY[i], rr * 0.55, HX[i], HY[i], rr);
              g.addColorStop(0, "rgba(0,0,0," + (fade * WK[i]).toFixed(3) + ")");
              g.addColorStop(1, "rgba(0,0,0,0)");
              ctx2d.fillStyle = g;
              ctx2d.beginPath();
              ctx2d.arc(HX[i], HY[i], rr, 0, Math.PI * 2);
              ctx2d.fill();
            }
            ctx2d.globalCompositeOperation = "source-over";
          }
        }
      }
      for (let k = 0; k < bucketNum; k++) {
        const list = bucketLists[k];
        if (!list || !list.length) continue;
        ctx2d.fillStyle = bucketColors[k];
        ctx2d.beginPath();
        for (let j = 0; j < list.length; j++) {
          const id = list[j];
          if (id >= active) break;
          const s = SZ[id] * grain;
          ctx2d.rect(X[id] - s * 0.5, Y[id] - s * 0.5, s, s);
        }
        ctx2d.fill();
      }
    }

    function staticRender() {
      for (let i = 0; i < count; i++) {
        X[i] = TX[i]; Y[i] = TY[i]; VX[i] = 0; VY[i] = 0;
      }
      if (USE_GL) renderGL(performance.now());
      else render2D(performance.now());
    }

    function frame(now) {
      if (!running || destroyed || autoPaused || reducedNow()) {
        loopScheduled = false;
        return;
      }
      requestAnimationFrame(frame);
      let dtms = now - lastT;
      lastT = now;
      if (dtms < 0 || dtms > 200) dtms = 16.7;
      adaptAcc += dtms; adaptN++;
      if (adaptN >= 60) {
        const avg = adaptAcc / adaptN;
        adaptAcc = 0; adaptN = 0;
        const inWindow = now < adaptUntil;
        if (avg > EMERG_MS && active > ACTIVE_FLOOR) {
          active = Math.max(ACTIVE_FLOOR, (active * 0.85) | 0);
        } else if (inWindow && avg < ADAPT_LO && active < count) {
          active = Math.min(count, (active * 1.25) | 0);
        }
      }
      const dt = Math.min(dtms / 16.666, 2);
      tSim += (dtms / 1000) * speed;
      let k = 0;
      for (let f = 0; f < 4; f++) {
        for (let p = 0; p < 8; p++) {
          oscTable[k++] = Math.sin(tSim * FREQS[f] + p * (Math.PI / 4));
        }
      }
      if (mouseIn) {
        const rvx = mouseX - lmX, rvy = mouseY - lmY;
        lmX = mouseX; lmY = mouseY;
        smvX += (rvx - smvX) * CURSOR_SMOOTH;
        smvY += (rvy - smvY) * CURSOR_SMOOTH;
      } else {
        smvX = 0.9; smvY = 0.9;
      }
      let cvx = smvX, cvy = smvY;
      const c2 = cvx * cvx + cvy * cvy;
      if (c2 > CURSOR_VMAX * CURSOR_VMAX) {
        const s = CURSOR_VMAX / Math.sqrt(c2);
        cvx *= s; cvy *= s;
      }
      cvx *= DPR; cvy *= DPR;
      const mx = mouseX * DPR, my = mouseY * DPR;
      if (mouseIn) {
        if (mouseJustIn) { HX.fill(mx); HY.fill(my); mouseJustIn = false; }
        for (let hh = HN - 1; hh > 0; hh--) { HX[hh] = HX[hh - 1]; HY[hh] = HY[hh - 1]; }
        HX[0] = mx; HY[0] = my;
      }
      const dtp = dt * speed;
      const sinceBuild = now - buildAt;
      const ease = Math.min(1, sinceBuild / ASSEMBLE_EASE);
      const sidesOn = assemble === "sides";
      const radBase = radiusCss * DPR;
      const P = phys;
      const pushK = (0.15 + 1.1 * P) * DPR * dtp;
      const swirlK = (0.05 + 0.30 * P) * DPR * dtp;
      const dragK = rubber * 0.30 * dtp;
      const fr = Math.pow(FRICTION, dtp);
      const spBase = SPRING * dtp * (0.35 + 0.65 * ease);
      const flowA = FLOW_AMP * DPR;
      const chaosA = chaos * DPR;
      for (let i = 0; i < active; i++) {
        if (sidesOn && sinceBuild < DEL[i]) { VX[i] = 0; VY[i] = 0; continue; }
        const o = OSC[i], chI = CHA[i];
        const wander = AMP[i] + chaosA * (2 + 14 * chI * chI);
        const fi = ((((TX[i] * 0.016) | 0) + ((TY[i] * 0.016) | 0)) & 31);
        const gx = TX[i] + wander * oscTable[o] + flowA * oscTable[fi];
        const gy = TY[i] + wander * oscTable[(o + 11) & 31] + flowA * oscTable[(fi + 13) & 31];
        const sp = spBase * SMUL[i];
        let vX = VX[i] + (gx - X[i]) * sp;
        let vY = VY[i] + (gy - Y[i]) * sp;
        if (mouseIn) {
          const Rb = radBase * RIM[i];
          for (let hh = 0; hh < HN; hh++) {
            const ddx = X[i] - HX[hh], ddy = Y[i] - HY[hh];
            const Rk = Rb * RK[hh], R2k = Rk * Rk;
            const dd2 = ddx * ddx + ddy * ddy;
            if (dd2 < R2k) {
              let d = Math.sqrt(dd2), nxv, nyv;
              if (d < 0.001) {
                nxv = oscTable[o]; nyv = oscTable[(o + 7) & 31];
                const l = Math.sqrt(nxv * nxv + nyv * nyv) || 1;
                nxv /= l; nyv /= l; d = 0.001;
              } else {
                nxv = ddx / d; nyv = ddy / d;
              }
              const q = 1 - d / Rk;
              const push = pushK * q * q * WK[hh];
              vX += nxv * push; vY += nyv * push;
              if (hh === 0) {
                const sw = swirlK * q * q;
                vX += -nyv * sw; vY += nxv * sw;
                vX += cvx * dragK * q;
                vY += cvy * dragK * q;
              }
              break;
            }
          }
        }
        vX *= fr; vY *= fr;
        VX[i] = vX; VY[i] = vY;
        X[i] += vX * dtp; Y[i] += vY * dtp;
      }
      if (USE_GL) renderGL(now);
      else render2D(now);
    }

    function start() {
      if (destroyed || reducedNow()) return;
      running = true;
      if (!loopScheduled) {
        loopScheduled = true;
        lastT = performance.now();
        requestAnimationFrame(frame);
      }
    }

    function shock(cx, cy) {
      const mx = cx * DPR, my = cy * DPR;
      const R = SHOCK_RADIUS * DPR, R2 = R * R;
      for (let i = 0; i < count; i++) {
        const dx = X[i] - mx, dy = Y[i] - my, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          const f = SHOCK_FORCE * (1 - d / R);
          VX[i] += (dx / d) * f; VY[i] += (dy / d) * f;
        }
      }
    }

    function scheduleRebuild() {
      clearTimeout(rebuildT);
      rebuildT = setTimeout(() => {
        if (logoImg && !destroyed) {
          fadeOnBuild = false;
          build(logoImg, true);
          if (reducedNow()) staticRender();
        }
      }, 150);
    }

    function rebuildNow(keepPositions, fade) {
      if (!logoImg || destroyed) return;
      fadeOnBuild = fade;
      build(logoImg, keepPositions);
      if (reducedNow()) staticRender();
    }

    const api = {
      play() {
        if (destroyed) return;
        if (logoImg) { if (reducedNow()) staticRender(); else start(); }
      },
      pause() { if (destroyed) return; running = false; },
      show() {
        if (destroyed) return;
        canvas.style.opacity = "1";
        if (logoImg) {
          running = false; loopScheduled = false;
          rebuildNow(false, true);
          if (reducedNow()) staticRender(); else start();
        }
      },
      hide() { if (destroyed) return; running = false; canvas.style.opacity = "0"; },
      setImage(src) { if (destroyed) return; setImage(src); },
      setText(text, color) { if (destroyed) return; setText(text, color); },
      scatterOut() {
        if (destroyed || !logoImg) return;
        for (let i = 0; i < count; i++) {
          VX[i] += (Math.random() - 0.5) * 30 * DPR;
          VY[i] += (Math.random() - 0.5) * 30 * DPR;
        }
        canvas.style.opacity = "0";
        setTimeout(() => { if (!destroyed) running = false; }, 750);
      },
      update(patch) {
        if (destroyed || !patch) return;
        for (const k in patch) {
          const v = patch[k];
          if (v === undefined) continue;
          switch (k) {
            case "physics": phys = clamp01(v); break;
            case "rubber": rubber = clamp01(v); break;
            case "chaos": chaos = clamp01(v); break;
            case "radius": radiusCss = Math.max(1, +v || 1); break;
            case "speed": speed = Math.min(2.5, Math.max(0.3, +v || 1)); break;
            case "grain": grain = clamp01(v); scheduleRebuild(); break;
            case "density": density = clamp01(v); scheduleRebuild(); break;
            case "entry":
              assemble = ENTRIES.indexOf(v) !== -1 ? v : "random";
              cfg.entry = assemble;
              rebuildNow(false, true);
              break;
            case "logoSize": sizeCss = Math.max(16, +v || 512); rebuildNow(true, false); break;
            case "background":
              cfg.background = v;
              transp = v === "transparent";
              customBg = v !== "auto" && v !== "transparent" ? v : null;
              rebuildNow(true, false);
              break;
            case "effect":
              if (PRESETS[v]) {
                const p = PRESETS[v];
                phys = p.physics; rubber = p.rubber; chaos = p.chaos; speed = p.speed;
              }
              break;
            case "motion": {
              const prevReduced = reducedNow();
              cfg.motion = ["auto", "full", "reduced"].indexOf(v) !== -1 ? v : "auto";
              const nowReduced = reducedNow();
              if (!prevReduced && nowReduced) { if (logoImg) staticRender(); }
              else if (prevReduced && !nowReduced && running) start();
              break;
            }
            case "pointerEvents":
              cfg.pointerEvents = !!v;
              applyPointerMode();
              if (logoImg) {
                setTheme(document.body && document.body.dataset.theme === "dark" ? "dark" : "light");
              }
              break;
            case "interaction":
              cfg.interaction = v === "none" ? "none" : "cursor";
              applyPointerMode();
              break;
            case "image": currentText = ""; setImage(v); break;
            case "text": if (!v) { currentText = ""; } else setText(v, patch.textColor); break;
            case "textColor": cfg.textColor = String(v); if (currentText) setText(currentText, cfg.textColor); break;
            case "silent": cfg.silent = !!v; break;
            default: cfg[k] = v;
          }
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; running = false;
        registry.delete(api);
        clearTimeout(rebuildT);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        if (mq) {
          if (mq.removeEventListener) mq.removeEventListener("change", onMotionPrefChange);
          else if (mq.removeListener) mq.removeListener(onMotionPrefChange);
        }
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("scroll", onScrollInvalidate, true);
        if (gl) {
          [posBuf, colBuf, sizeBuf, qBuf].forEach(b => { if (b) gl.deleteBuffer(b); });
          if (fboTex) gl.deleteTexture(fboTex);
          if (fbo) gl.deleteFramebuffer(fbo);
          if (prog) gl.deleteProgram(prog);
          if (qProg) gl.deleteProgram(qProg);
          const lose = gl.getExtension("WEBGL_lose_context");
          if (lose) lose.loseContext();
          gl = null;
        }
        offStat = null; logoImg = null; bucketLists = []; bucketColors = [];
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        try { hostEl.__ps = null; } catch (e) {}
      },
      get playing() { return running; },
      get reduced() { return reducedNow(); },
      get image() { return currentURL; },
      get tier() { return tierName; },
      get config() {
        return {
          image: currentURL,
          physics: phys, rubber: rubber, chaos: chaos,
          radius: radiusCss, speed: speed, density: density, grain: grain,
          entry: assemble, logoSize: sizeCss,
          text: currentText, textColor: cfg.textColor,
          background: transp ? "transparent" : customBg || "auto",
          pointerEvents: cfg.pointerEvents, interaction: cfg.interaction,
          motion: cfg.motion, quality: cfg.quality, silent: cfg.silent
        };
      }
    };

    applyPointerMode();
    registry.add(api);
    return api;
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target;
  }

  function mount(target, options) {
    options = options || {};
    const hostEl = resolveTarget(target);
    if (!hostEl) {
      reportError(options, { code: "target", message: "Контейнер не найден: " + target });
      return null;
    }
    const cfg = normalizeOptions(options);
    const hooks = {};
    HOOK_NAMES.forEach(h => { if (typeof options[h] === "function") hooks[h] = options[h]; });
    let root = hostEl.shadowRoot;
    if (!root) {
      root = hostEl.attachShadow({ mode: "open" });
      const styleEl = document.createElement("style");
      styleEl.textContent = COMPONENT_CSS;
      root.appendChild(styleEl);
    }
    const oldCanvas = root.querySelector("canvas[data-ps-canvas]");
    if (oldCanvas) oldCanvas.remove();
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-ps-canvas", "");
    root.appendChild(canvas);
    const api = createEngine(hostEl, canvas, cfg, hooks);
    if (cfg.text) api.setText(cfg.text);
    else if (cfg.image) api.setImage(cfg.image);
    return api;
  }

  function fullscreen(options) {
    options = options || {};
    let api = null, layer = null, destroyed = false, hideRequested = false;
    let fallbackTimer = 0, loadTimer = 0;
    const hideDelay = Number(options.hideDelay) || 400;

    function hide() {
      if (hideRequested || destroyed) return;
      hideRequested = true;
      if (api) {
        api.scatterOut();
        setTimeout(() => { controller.destroy(); }, 800);
      } else {
        controller.destroy();
      }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(fallbackTimer);
      clearTimeout(loadTimer);
      if (api) api.destroy();
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    }

    const controller = {
      play() { if (api) api.play(); },
      pause() { if (api) api.pause(); },
      show() { if (api) api.show(); },
      hide,
      scatterOut() { if (api) api.scatterOut(); },
      setImage(src) { if (api) api.setImage(src); },
      setText(text, color) { if (api) api.setText(text, color); },
      update(patch) { if (api) api.update(patch); },
      destroy,
      get playing() { return api ? api.playing : false; },
      get reduced() { return api ? api.reduced : false; },
      get image() { return api ? api.image : options.image || ""; },
      get tier() { return api ? api.tier : ""; },
      get config() { return api ? api.config : normalizeOptions(options); }
    };

    function init() {
      if (destroyed) return;
      if (!document.body) return;
      layer = document.createElement("div");
      layer.setAttribute("data-ps-fullscreen", "");
      layer.style.cssText =
        "position:fixed;inset:0;z-index:" +
        (options.zIndex != null ? options.zIndex : 2147483000) +
        ";";
      document.body.appendChild(layer);
      const userOnTheme = options.onTheme;
      const userOnBackground = options.onBackground;
      const applyTheme = options.applyPageTheme !== false;
      const applyBackground = options.applyPageBackground !== false;
      const opts = Object.assign({}, options, {
        onTheme(t) {
          if (applyTheme) document.body.dataset.theme = t;
          if (userOnTheme) userOnTheme(t);
        },
        onBackground(b) {
          if (applyBackground) document.body.style.background = b;
          if (userOnBackground) userOnBackground(b);
        }
      });
      api = mount(layer, opts);
      if (!api) { layer.remove(); return; }
      if (hideRequested) hide();
    }

    if (document.body) init();
    else document.addEventListener("DOMContentLoaded", init, { once: true });

    if (options.hideOnLoad) {
      const onLoaded = () => { loadTimer = setTimeout(hide, hideDelay); };
      if (document.readyState === "complete") onLoaded();
      else window.addEventListener("load", onLoaded, { once: true });
    }
    const fallback = Number(options.fallbackHideTimeout) || 0;
    if (fallback > 0) fallbackTimer = setTimeout(hide, fallback);

    window.ParticlePreloader = {
      hide: () => controller.hide(),
      show: () => controller.show()
    };
    return controller;
  }

  function auto(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll("[data-ps-image]").forEach(el => {
      if (el.__ps) return;
      const opts = {};
      for (const k in el.dataset) {
        if (k === "psImage") { opts.image = el.dataset[k]; continue; }
        if (k.indexOf("ps") !== 0) continue;
        const key = k.charAt(2).toLowerCase() + k.slice(3);
        let v = el.dataset[k];
        if (v === "true") v = true;
        else if (v === "false") v = false;
        else if (v !== "" && !isNaN(+v)) v = +v;
        opts[key] = v;
      }
      el.__ps = mount(el, opts);
    });
  }

  const cs = document.currentScript;
  if (cs && cs.hasAttribute("data-ps-auto")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => auto());
    } else {
      auto();
    }
  }

  const previousParticleStudio = window.ParticleStudio;
  const ParticleStudio = {
    version: VERSION,
    mount,
    fullscreen,
    auto,
    presets: PRESETS,
    noConflict() {
      window.ParticleStudio = previousParticleStudio;
      return ParticleStudio;
    }
  };
  window.ParticleStudio = ParticleStudio;
})();
