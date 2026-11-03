(() => {
  // assets/glisse/svg.ts
  var SVG = "http://www.w3.org/2000/svg";
  var defs;
  function svg(name, attributes) {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }
  function container() {
    if (defs?.isConnected) return defs;
    const root = svg("svg", { width: 0, height: 0, "aria-hidden": "true" });
    root.style.cssText = "position:absolute;pointer-events:none";
    defs = svg("defs", {});
    root.append(defs);
    document.body.append(root);
    return defs;
  }

  // assets/glisse/lens.ts
  var DARK = { angle: 45, glow: 0.4, spread: 0.5, glowPower: 1.5, edge: 0.5, edgeWidth: 2, edgePower: 1.5 };
  var LIGHT = { angle: 30, glow: 0.4, spread: 0.5, glowPower: 2, edge: 0.5, edgeWidth: 1.5, edgePower: 1 };
  var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  var erf = (x) => Math.tanh(1.7724538509 * x);
  function distance(x, y, halfWidth, halfHeight, radius) {
    const qx = Math.abs(x) - halfWidth + radius;
    const qy = Math.abs(y) - halfHeight + radius;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  }
  function arc(sag, half) {
    const radius = (half * half + sag * sag) / (2 * sag);
    let sum2 = 0;
    for (let i = 0; i <= 200; i++) {
      const x = i / 200 * half;
      const slope2 = x / Math.sqrt(radius * radius - x * x);
      sum2 += i === 0 || i === 200 ? slope2 / 2 : slope2;
    }
    const mean = sum2 / 200;
    return { radius, scale: mean > 0 ? 0.5 / mean : 1 };
  }
  var slope = (x, { radius, scale }) => {
    const inside = Math.min(x, 0.999 * radius);
    return inside / Math.sqrt(radius * radius - inside * inside) * scale;
  };
  function lensMap(shape, options, light, density) {
    const { width, height } = shape;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const radius = clamp(shape.radius, 0, Math.min(halfWidth, halfHeight));
    const columns = Math.max(1, Math.round(width * density));
    const rows = Math.max(1, Math.round(height * density));
    const pullAcross = new Uint8ClampedArray(columns * rows * 4);
    const pullDown = new Uint8ClampedArray(columns * rows * 4);
    const caught = new Uint8ClampedArray(columns * rows * 4);
    const shapeMask = new Uint8ClampedArray(columns * rows * 4);
    const grey = (data, i, value, alpha = 255) => {
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = alpha;
    };
    const share = options.relative ? Math.min(width, height) : 1;
    const depth = options.depth * share;
    const dome = options.dome * share;
    const { splay } = options;
    const innerWidth = Math.max(0, halfWidth - depth);
    const innerHeight = Math.max(0, halfHeight - depth);
    const innerRadius = clamp(radius, 0, Math.min(innerWidth, innerHeight));
    const ramp = depth > 0 ? 1 / (depth * Math.SQRT2) : 1e6;
    const sag = Math.max(0.01, Math.min(dome, Math.min(halfWidth, halfHeight) - 1));
    const across = dome > 0 ? arc(sag, halfWidth) : null;
    const down = dome > 0 ? arc(sag, halfHeight) : null;
    const reach = 0.5 * Math.min(halfWidth, halfHeight);
    const cos = Math.cos(light.angle * Math.PI / 180);
    const sin = Math.sin(light.angle * Math.PI / 180);
    const glowStart = (1 - light.spread) * Math.SQRT2;
    const glowRange = light.spread * Math.SQRT2;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const i = (row * columns + column) * 4;
        const x = (column + 0.5) / columns * width - halfWidth;
        const y = (row + 0.5) / rows * height - halfHeight;
        const edge = distance(x, y, halfWidth, halfHeight, radius);
        const inside = Math.round(255 * clamp(-edge, 0, 1));
        grey(shapeMask, i, 0, inside);
        if (edge >= 0) {
          grey(pullAcross, i, 128);
          grey(pullDown, i, 128);
          grey(caught, i, 128, 0);
          continue;
        }
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        let dx = across ? Math.sign(x) * slope(ax, across) : clamp(x / halfWidth, -1, 1);
        let dy = down ? Math.sign(y) * slope(ay, down) : clamp(y / halfHeight, -1, 1);
        if (splay < 1 && reach > 0) {
          const keepX = Math.max(0, 1 - (halfHeight - ay) / reach) * (1 - splay);
          const keepY = Math.max(0, 1 - (halfWidth - ax) / reach) * (1 - splay);
          if (keepX > 1e-3 || keepY > 1e-3) {
            const before = Math.hypot(dx, dy);
            dx *= 1 - keepX;
            dy *= 1 - keepY;
            const after = Math.hypot(dx, dy);
            if (after > 1e-3) {
              dx *= before / after;
              dy *= before / after;
            }
          }
        }
        const falloff = 0.5 * (1 + erf(distance(x, y, innerWidth, innerHeight, innerRadius) * ramp));
        grey(shapeMask, i, Math.round(255 * falloff), inside);
        grey(pullAcross, i, Math.round((0.5 - 0.5 * dx * falloff) * 255));
        grey(pullDown, i, Math.round((0.5 - 0.5 * dy * falloff) * 255));
        const facing = Math.abs(clamp(x / halfWidth, -1, 1) * cos + clamp(y / halfHeight, -1, 1) * sin);
        const glow = glowRange > 1e-3 ? light.glow * clamp((facing - glowStart) / glowRange, 0, 1) ** light.glowPower * falloff : 0;
        const rim = light.edge * Math.max(0, 1 + edge / light.edgeWidth) * facing ** light.edgePower;
        const amount = Math.min(1, glow + rim);
        const bends = Math.min(1, falloff * 20, -edge);
        grey(caught, i, Math.round(127 * amount + 128), Math.round(255 * bends));
      }
    }
    return { columns, rows, across: pullAcross, down: pullDown, light: caught, shape: shapeMask };
  }
  var encoded = /* @__PURE__ */ new Map();
  function encode(key, draw) {
    const cached = encoded.get(key);
    if (cached) return cached;
    const map = draw();
    const canvas = document.createElement("canvas");
    canvas.width = map.columns;
    canvas.height = map.rows;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(map.columns, map.rows);
    const png = (data) => {
      image.data.set(data);
      context.putImageData(image, 0, 0);
      return canvas.toDataURL();
    };
    const result = {
      across: png(map.across),
      down: png(map.down),
      light: png(map.light),
      shape: png(map.shape)
    };
    encoded.set(key, result);
    return result;
  }
  var CHANNELS = ["1 0 0 0 0  0 0 0 0 0  0 0 0 0 0", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"];
  var matrix = (input, values, result) => svg("feColorMatrix", { in: input, type: "matrix", values, result });
  var sum = (a, b, k2, k3, result) => svg("feComposite", { in: a, in2: b, operator: "arithmetic", k2, k3, result });
  function spread(k) {
    return [
      ...CHANNELS.map((channel, i) => matrix(`ray-${k}-${i}`, `${channel}  0 0 0 0.3333 0`, `light-${k}-${i}`)),
      sum(`light-${k}-0`, `light-${k}-1`, 1, 1, `light-${k}-01`),
      sum(`light-${k}-01`, `light-${k}-2`, 1, 1, `spread-${k}`),
      matrix(`spread-${k}`, "3 0 0 0 0  0 3 0 0 0  0 0 3 0 0  0 0 0 1 0", `bent-${k}`)
    ];
  }
  function inked(k, page) {
    const white = page === "light" ? 1 : 0;
    const steps = [];
    const own = (i) => [0, 1, 2].map((r) => r === i ? `${[0, 1, 2].map((c) => c === i ? white ? -1 : 1 : 0).join(" ")} 0 ${white}` : "0 0 0 0 0").join("  ") + "  0 0 0 1 0";
    CHANNELS.forEach((_, i) => {
      const ray = `ray-${k}-${i}`;
      steps.push(
        // How much it covers, as an opaque grey, to find the most.
        matrix(ray, "0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1", `cover-${k}-${i}`),
        // Its coverage alone.
        matrix(ray, "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", `covers-${k}-${i}`),
        // What its colour gives over black, or takes from white.
        matrix(ray, own(i), `inks-${k}-${i}`)
      );
    });
    steps.push(
      svg("feBlend", { in: `cover-${k}-0`, in2: `cover-${k}-1`, mode: "lighten", result: `most-${k}-01` }),
      svg("feBlend", { in: `most-${k}-01`, in2: `cover-${k}-2`, mode: "lighten", result: `most-${k}` }),
      matrix(`most-${k}`, `0 0 0 0 ${white}  0 0 0 0 ${white}  0 0 0 0 ${white}  1 0 0 0 0`, `inked-${k}`)
    );
    let at = `inked-${k}`;
    CHANNELS.forEach((_, i) => {
      const [gain, loss] = white ? [`covers-${k}-${i}`, `inks-${k}-${i}`] : [`inks-${k}-${i}`, `covers-${k}-${i}`];
      steps.push(
        sum(at, gain, i === 0 ? 0.5 : 1, 0.5, `inked-${k}-${i}a`),
        sum(`inked-${k}-${i}a`, loss, 1, -0.5, `inked-${k}-${i}b`)
      );
      at = `inked-${k}-${i}b`;
    });
    const double = svg("feComponentTransfer", { in: at, result: `bent-${k}` });
    double.append(svg("feFuncA", { type: "linear", slope: 2, intercept: 0 }));
    steps.push(double);
    return steps;
  }
  function graph(lenses, box, standIn) {
    const unit = box ? "objectBoundingBox" : "userSpaceOnUse";
    const filter = svg("filter", { filterUnits: unit, primitiveUnits: unit, "color-interpolation-filters": "sRGB" });
    if (box) {
      for (const [key, value] of Object.entries({ x: 0, y: 0, width: 1, height: 1 })) filter.setAttribute(key, String(value));
    }
    const single = lenses.length === 1;
    const parts = lenses.map(({ maps, shine, blur, ink }, k) => {
      const merged = (name) => single ? name : `${name}-${k}`;
      const image = (href, result) => svg("feImage", { href, preserveAspectRatio: "none", result });
      const boxed = [
        image(maps.across, `across-${k}`),
        image(maps.down, `down-${k}`),
        image(maps.light, merged("raw")),
        svg("feFlood", { "flood-color": "rgb(128, 128, 128)", result: `neutral-${k}` })
      ];
      if (standIn) boxed.push(image(maps.shape, merged("shape")));
      filter.append(...boxed);
      for (const pull of ["across", "down"]) {
        const half = svg("feComponentTransfer", { in: `${pull}-grey-${k}`, result: `${pull}-pull-${k}` });
        half.append(svg("feFuncA", { type: "linear", slope: 0, intercept: 0.5 }));
        filter.append(
          svg("feComposite", { in: `${pull}-${k}`, in2: `neutral-${k}`, operator: "over", result: `${pull}-grey-${k}` }),
          half
        );
      }
      const rays = CHANNELS.map((_, i) => {
        const across = svg("feDisplacementMap", {
          in: "SourceGraphic",
          in2: `across-pull-${k}`,
          xChannelSelector: "R",
          yChannelSelector: "A",
          result: `across-${k}-${i}`
        });
        const down = svg("feDisplacementMap", {
          in: `across-${k}-${i}`,
          in2: `down-pull-${k}`,
          xChannelSelector: "A",
          yChannelSelector: "R",
          result: `ray-${k}-${i}`
        });
        boxed.push(across);
        filter.append(across, down);
        return [across, down];
      });
      filter.append(...ink ? inked(k, ink) : spread(k));
      let soften;
      if (blur) {
        soften = svg("feGaussianBlur", { in: `bent-${k}`, result: `soft-${k}` });
        const weight = image(maps.shape, `weight-${k}`);
        boxed.push(weight);
        filter.append(
          weight,
          svg("feColorMatrix", { in: `weight-${k}`, type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0", result: `bends-${k}` }),
          soften,
          svg("feComposite", { in: `soft-${k}`, in2: `bends-${k}`, operator: "in", result: `soft-in-${k}` }),
          svg("feComposite", { in: `bent-${k}`, in2: `bends-${k}`, operator: "out", result: `sharp-${k}` }),
          svg("feComposite", { in: `soft-in-${k}`, in2: `sharp-${k}`, operator: "arithmetic", k2: 1, k3: 1, result: `softened-${k}` })
        );
      }
      const bent = blur ? `softened-${k}` : `bent-${k}`;
      let lit = bent;
      if (shine > 0) {
        const white = `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 ${-128 / 255}`;
        filter.append(
          svg("feColorMatrix", { in: merged("raw"), type: "matrix", values: white, result: `glint-${k}` }),
          svg("feComposite", { in: `glint-${k}`, in2: bent, operator: "arithmetic", k2: shine, k3: 1, result: `lit-${k}` })
        );
        lit = `lit-${k}`;
      } else if (shine < 0) {
        const row = `0 0 ${shine} 0 ${1 - 128 * shine / 255}`;
        filter.append(
          svg("feColorMatrix", { in: merged("raw"), type: "matrix", values: `${row}  ${row}  ${row}  0 0 0 0 1`, result: `shade-${k}` }),
          svg("feComposite", { in: `shade-${k}`, in2: bent, operator: "arithmetic", k1: 1, result: `lit-${k}` })
        );
        lit = `lit-${k}`;
      }
      filter.append(svg("feComposite", { in: lit, in2: merged("raw"), operator: "in", result: merged("inside") }));
      return { boxed, rays, soften };
    });
    if (!single) {
      for (const name of ["raw", "inside", ...standIn ? ["shape"] : []]) {
        const merge = svg("feMerge", { result: name });
        lenses.forEach((_, k) => merge.append(svg("feMergeNode", { in: `${name}-${k}` })));
        filter.append(merge);
      }
    }
    filter.append(
      svg("feComposite", { in: "SourceGraphic", in2: "raw", operator: "out", result: "outside" }),
      svg("feComposite", { in: "inside", in2: "outside", operator: "arithmetic", k2: 1, k3: 1, result: "seen" })
    );
    if (standIn) filter.append(svg("feComposite", { in: "seen", in2: "shape", operator: "in" }));
    return { filter, parts };
  }
  function place(graph2, placed, across, down, box) {
    if (!box) {
      for (const [key, value] of Object.entries({ x: 0, y: 0, width: across, height: down })) {
        graph2.filter.setAttribute(key, String(value));
      }
    }
    placed.forEach((lens, k) => {
      const part = graph2.parts[k];
      const spectrum = [1 + 0.2 * lens.dispersion, 1 + 0.1 * lens.dispersion, 1];
      part.rays.forEach(([pullAcross, pullDown], i) => {
        pullAcross.setAttribute("scale", String((box ? lens.reach / across : lens.reach) * spectrum[i]));
        pullDown.setAttribute("scale", String((box ? lens.reach / down : lens.reach) * spectrum[i]));
      });
      const blur = Math.max(lens.blur, 0.01);
      part.soften?.setAttribute("stdDeviation", box ? `${blur / across} ${blur / down}` : String(blur));
      const rect = box ? { x: lens.x / across, y: lens.y / down, width: lens.width / across, height: lens.height / down } : { x: lens.x, y: lens.y, width: lens.width, height: lens.height };
      for (const element of part.boxed) {
        for (const [key, value] of Object.entries(rect)) element.setAttribute(key, String(value));
      }
    });
  }
  function shapeOf(glass, style = getComputedStyle(glass)) {
    const width = glass.offsetWidth;
    const height = glass.offsetHeight;
    if (!width || !height) return null;
    const corner = style.borderTopLeftRadius;
    const radius = Math.min(
      width / 2,
      height / 2,
      corner.endsWith("%") ? Math.min(width, height) * parseFloat(corner) / 100 : parseFloat(corner) || 0
    );
    return { width, height, radius };
  }
  function fit(glass, options) {
    const style = getComputedStyle(glass);
    const shape = shapeOf(glass, style);
    if (!shape) return null;
    const { width, height, radius } = shape;
    const page = parseFloat(style.getPropertyValue("--lg-lens-shine")) || 0;
    const shine = options.paintsLight ? 0 : options.shine === void 0 ? page : Math.sign(page) * options.shine;
    const tuned = options.strengthProperty ? parseFloat(style.getPropertyValue(options.strengthProperty)) : NaN;
    const own = page > 0 ? options.darkStrength ?? options.strength : options.strength;
    const strength = Number.isFinite(tuned) ? tuned : own;
    const split = options.dispersionProperty ? parseFloat(style.getPropertyValue(options.dispersionProperty)) : NaN;
    const dispersion = Number.isFinite(split) ? Math.max(0, split) : options.dispersion;
    const density = Math.min(devicePixelRatio || 1, 2);
    const theme = page < 0 && !options.paintsLight ? LIGHT : DARK;
    const light = options.edgeWidth === void 0 ? theme : { ...theme, edgeWidth: options.edgeWidth };
    const key = [width, height, radius, density, JSON.stringify(light), JSON.stringify(options)].join("|");
    const maps = encode(key, () => lensMap(shape, options, light, density));
    const blur = options.blur ?? 0;
    const ink = options.ink ? page < 0 ? "light" : "dark" : void 0;
    return maps ? { maps, key: `${key}|${shine}|${ink}`, shine, ink, blur, strength, dispersion, width, height } : null;
  }
  var backdrops = /* @__PURE__ */ new Map();
  function fitBackdropLens(glass, options) {
    const fitted = fit(glass, options);
    if (!fitted) return;
    const { maps, key, shine, strength, dispersion, width, height } = fitted;
    const reach = strength * Math.min(width, height);
    const id = `${key}|${reach}|${dispersion}`;
    let name = backdrops.get(id);
    if (!name) {
      const built = graph([{ maps, shine }], false, false);
      place(built, [{ x: 0, y: 0, width, height, reach, dispersion, blur: 0 }], width, height, false);
      name = `glisse-backdrop-${backdrops.size}`;
      built.filter.id = name;
      container().append(built.filter);
      backdrops.set(id, name);
    }
    glass.style.setProperty("--lg-filter", `url("#${name}") saturate(1.5)`);
  }

  // assets/glisse/rim.ts
  var GLASS = {
    strength: 0.45,
    strengthProperty: "--lg-glass-bend",
    dispersion: 0.4,
    dispersionProperty: "--lg-glass-dispersion",
    depth: 0.25,
    dome: 0.5,
    splay: 1,
    relative: true,
    paintsLight: true
  };
  var clamp2 = (value, min, max) => Math.min(max, Math.max(min, value));
  var RIM_WIDTH = 1.22;
  var EDGE_WIDTH = 0.5;
  function rimMap({ width, height, radius }, shine, density, edge = [0, 0, 0, 0]) {
    const columns = Math.max(1, Math.round(width * density));
    const rows = Math.max(1, Math.round(height * density));
    const data = new Uint8ClampedArray(columns * rows * 4);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const corner = clamp2(radius, 0, Math.min(halfWidth, halfHeight));
    const half = 0.5 / density;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = (column + 0.5) / columns * width - halfWidth;
        const y = (row + 0.5) / rows * height - halfHeight;
        const depth = -distance(x, y, halfWidth, halfHeight, corner);
        if (depth < -half || depth > 2 * RIM_WIDTH) continue;
        const qx = Math.abs(x) - halfWidth + corner;
        const qy = Math.abs(y) - halfHeight + corner;
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0) {
          const length = Math.hypot(qx, qy);
          nx = Math.sign(x) * qx / length;
          ny = Math.sign(y) * qy / length;
        } else if (qx > qy) nx = Math.sign(x);
        else ny = Math.sign(y);
        const facing = Math.abs(nx + ny);
        const along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)));
        const cover = clamp2((depth + half) * density, 0, 1);
        const lined = clamp2((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1);
        const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0;
        const line = edge[3] * lined * (1 - light);
        const alpha = light + line;
        if (alpha <= 0) continue;
        const i = (row * columns + column) * 4;
        for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round((255 * light + edge[channel] * line) / alpha);
        data[i + 3] = Math.round(255 * alpha);
      }
    }
    return { columns, rows, data };
  }
  function parseColour(context, colour) {
    context.fillStyle = "#0000";
    context.fillStyle = colour;
    const value = String(context.fillStyle);
    if (value.startsWith("#")) {
      const [r2, g2, b2] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
      return [r2, g2, b2, 1];
    }
    const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
    return [r, g, b, a];
  }
  var rims = /* @__PURE__ */ new Map();
  var palette;
  function paintRim(element) {
    const style = getComputedStyle(element);
    const shape = shapeOf(element, style);
    palette ?? (palette = document.createElement("canvas").getContext("2d"));
    if (!shape || !palette) return;
    const tuned = parseFloat(style.getPropertyValue("--lg-rim-shine"));
    const shine = Number.isFinite(tuned) ? clamp2(tuned, 0, 1) : 0.13;
    const edge = parseColour(palette, style.getPropertyValue("--lg-edge").trim() || "transparent");
    const density = Math.min(devicePixelRatio || 1, 3);
    const key = [shape.width, shape.height, shape.radius, shine, edge, density].join("|");
    let url = rims.get(key);
    if (!url) {
      const { columns, rows, data } = rimMap(shape, shine, density, edge);
      const canvas = document.createElement("canvas");
      canvas.width = columns;
      canvas.height = rows;
      const context = canvas.getContext("2d");
      if (!context) return;
      const image = context.createImageData(columns, rows);
      image.data.set(data);
      context.putImageData(image, 0, 0);
      url = `url("${canvas.toDataURL()}")`;
      rims.set(key, url);
    }
    element.style.setProperty("--lg-rim", url);
    element.setAttribute("data-rim", "");
  }

  // assets/glisse/site-glass.ts
  var selectors = [
    ".site-header__brand",
    ".site-header__back",
    ".site-control",
    ".profile-card-modal__panel",
    ".lazy-video-play",
    ".link-item",
    ".island",
    ".award-card",
    ".section-content-shell",
    ".top-bar",
    ".back-btn",
    ".ctrl-btn",
    ".case-card",
    ".lottie-item",
    ".logo-cell",
    ".poster-item",
    ".volunteer-card",
    ".volunteer-tap-hint",
    ".video-item",
    ".unwordle-card",
    ".game-action",
    ".daily-timer",
    ".shyfr-shell",
    ".toast",
    ".connection"
  ].join(",");
  var chrome = /Chrom(?:e|ium)\//.test(navigator.userAgent) && !/EdgiOS|CriOS/.test(navigator.userAgent);
  var surfaces = /* @__PURE__ */ new Map();
  var pending = /* @__PURE__ */ new Set();
  var scheduled = false;
  function fit2(element) {
    if (!element.isConnected || document.documentElement.classList.contains("performance-mode")) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (rect.width * rect.height > 6e4) {
      element.style.removeProperty("--lg-filter");
      element.style.removeProperty("--lg-rim");
      return;
    }
    paintRim(element);
    if (chrome) fitBackdropLens(element, GLASS);
  }
  function queue(element) {
    pending.add(element);
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      const next = pending.values().next().value;
      if (!next) return;
      pending.delete(next);
      fit2(next);
      if (pending.size) queue(pending.values().next().value);
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 500 });
    else window.setTimeout(run, 50);
  }
  var resize = new ResizeObserver((entries) => entries.forEach((entry) => queue(entry.target)));
  var visibility = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const element = entry.target;
      if (entry.isIntersecting) {
        resize.observe(element);
        queue(element);
      } else {
        resize.unobserve(element);
        pending.delete(element);
      }
    });
  }, { rootMargin: "100px" }) : null;
  function scan() {
    for (const [element, rim] of surfaces) {
      if (element.isConnected) continue;
      visibility?.unobserve(element);
      resize.unobserve(element);
      pending.delete(element);
      rim.remove();
      surfaces.delete(element);
    }
    document.querySelectorAll(selectors).forEach((element) => {
      const existingRim = surfaces.get(element);
      if (existingRim) {
        if (!existingRim.isConnected) element.append(existingRim);
        return;
      }
      const style = getComputedStyle(element);
      if ((style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter")) === "none") return;
      if (document.body.classList.contains("telegram-mini-app") && element.matches(".unwordle-card, .shyfr-shell")) return;
      const rim = document.createElement("span");
      rim.className = "glisse-rim";
      rim.setAttribute("aria-hidden", "true");
      if (style.position === "static") element.classList.add("glisse-positioned");
      element.classList.add("glisse-surface");
      element.append(rim);
      surfaces.set(element, rim);
      if (visibility) visibility.observe(element);
      else {
        resize.observe(element);
        queue(element);
      }
    });
  }
  function start() {
    scan();
    let scanPending = false;
    new MutationObserver(() => {
      if (scanPending) return;
      scanPending = true;
      requestAnimationFrame(() => {
        scanPending = false;
        scan();
      });
    }).observe(document.body, { childList: true, subtree: true });
    new MutationObserver(() => {
      scan();
      surfaces.forEach((_rim, element) => queue(element));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
