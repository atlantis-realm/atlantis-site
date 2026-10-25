/*@CITYGEN@*/
(() => {
  "use strict";
  const { TAU, rad } = CityGen;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => Number(v).toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const maxOf = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity), minOf = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);

  const DRESSINGS = ["", "KIT_Facade_civic", "KB3D Age of Egypt", "KB3D Atlantis", "KB3D Black Market", "KB3D Brutalist 2055",
    "KB3D Cyberpunk", "KB3D Future Slums 2", "KB3D Gaea", "KB3D Japanese Neighborhoods", "KB3D Neo Dubai", "KB3D Neo NYC",
    "KB3D Neo San Francisco", "KB3D New Delhi", "KB3D Noir Futurism", "KB3D Oasis", "KB3D Paris",
    "KB3D Secrets of the Luminara", "KB3D Utopia"];
  const TYPE_LABEL = { perimeter: "Perimeter blocks", campus: "Colleges & planting", towers: "Setback towers", oldtown: "Old Town" };
  // Old Town settings live in these district keys; citygen.js defaults any that an older plan lacks
  const OLD_TOWN_KEYS = ["grid", "quarters", "heights", "lantern", "landmarks", "second_avenue", "quay"];
  const TOWER_PLANS = [["rect", "Rectangular"], ["round", "Round"], ["stepped", "Stepped"], ["twin", "Twin"]];
  const TOWER_CROWNS = [["flat", "Flat"], ["needle", "Needle"], ["fins", "Fins"], ["lantern", "Lantern"], ["garden", "Garden"]];
  // the college buildings' signature forms, as the tooltip names them
  const FORM_LABEL = { lab_hall: "Lab hall", treehouse: "Tree-house", opera: "Opera", amphitheatre: "Amphitheatre", bigtop: "Big top", print: "Print works", studio: "Studios", dye_garden: "Dye garden", arcology: "Arcology" };
  const BAND_KINDS = [["grove", "Groves"], ["campus", "Colleges"], ["orchard", "Orchards"]];
  const CITY = "city";
  const USES = CityGen.USES, USE_LABEL = { residential: "Residential", commercial: "Commercial", industrial: "Industrial", hydroponics: "Hydroponics", entertainment: "Entertainment", park: "Park", college: "College", harbour: "Harbour", waterworks: "Waterworks" };

  // ---------------------------------------------------------------- state
  let plan = null, gen = null, selected = CITY, readOnly = false, secSpoke = 0;
  let ref = null, editSeq = 0, saving = false, saveTimer = 0, remote = null;
  const dirty = new Set();
  const view = { x: -3200, y: -3200, w: 6400, h: 6400 };
  const VIEWS = () => {
    const R = plan ? Math.max(...plan.scene.rings.map((r) => r.r1)) + 150 : 3200;
    const cam = plan ? [plan.scene.camera.x - plan.scene.center[0], plan.scene.camera.y - plan.scene.center[1]] : [0, -2400];
    const isl = plan ? plan.scene.rings.find((r) => r.r0 === 0).r1 + 80 : 540;
    return { city: [-R, -R, 2 * R, 2 * R], core: [-isl, -isl, 2 * isl, 2 * isl], hero: [cam[0] - 900, -cam[1] - 1800, 1800, 1800] };
  };
  const setStatus = (state, text) => { const s = $("status"); s.dataset.state = state; s.textContent = text; };

  // ---------------------------------------------------------------- canvas plan (26k lots: canvas, not SVG)
  const cv = $("plan"), ctx = cv.getContext("2d");
  let css = {}, ramp = [], grid = null;
  function readColors() {
    const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
    css = Object.fromEntries(["--sheet", "--ink", "--muted", "--line", "--land", "--land-edge", "--water", "--water-edge", "--pave", "--road", "--h-lo", "--h-hi", "--tree", "--gold", "--cyan", "--cam", "--canal", "--skywalk", ...USES.map((u) => `--u-${u}`)].map((n) => [n, g(n)]));
    const hex = (h) => { const m = h.replace("#", ""); const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
    const a = hex(css["--h-lo"]), b = hex(css["--h-hi"]);
    ramp = Array.from({ length: 48 }, (_, i) => `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * i / 47)).join(",")})`);
  }
  let hMax = 250;  // the height ramp's top: the tallest roof in the city bar the Lantern, set from gen
  const shade = (top) => ramp[Math.max(0, Math.min(47, Math.round(top / hMax * 47)))];
  function setHeightScale() {
    const tops = gen.lots.filter((l) => l.kind !== "lantern").map((l) => l.top);
    hMax = Math.max(50, Math.ceil((tops.length ? maxOf(tops) : 250) / 10) * 10);
    $("rampMax").textContent = `0–${fmt(hMax)} m`;
  }
  let S = 1, OX = 0, OY = 0, DPR = 1;
  function fit() {
    const r = cv.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * DPR); cv.height = Math.round(r.height * DPR);
    S = Math.min(r.width / view.w, r.height / view.h);
    OX = (r.width - view.w * S) / 2; OY = (r.height - view.h * S) / 2;
  }
  const sx = (x) => OX + (x - view.x) * S, sy = (y) => OY + (-y - view.y) * S;
  function poly(pts) { ctx.moveTo(sx(pts[0][0]), sy(pts[0][1])); for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i][0]), sy(pts[i][1])); ctx.closePath(); }
  const spokePt = (a, t, s) => [t * Math.cos(a) - s * Math.sin(a), t * Math.sin(a) + s * Math.cos(a)];
  const band = (a, t0, t1, s0, s1) => [spokePt(a, t0, s0), spokePt(a, t1, s0), spokePt(a, t1, s1), spokePt(a, t0, s1)];
  // canvas angles: plan y points up, screen y points down, so a plan angle a is drawn at -a
  function arcBand(r0, r1, a0, a1) { ctx.arc(sx(0), sy(0), r1 * S, -a0, -a1, true); ctx.arc(sx(0), sy(0), r0 * S, -a1, -a0, false); ctx.closePath(); }

  let frameP = 0;
  function drawPlan() {
    if (frameP) return;
    frameP = requestAnimationFrame(() => {
      frameP = 0;
      if (!plan || !gen) return;
      fit(); readColors();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const P = plan.spokes, split = P.road_half + P.verge + (P.corridor_half - P.road_half - P.verge) * P.ramp_share;
      for (const r of [...plan.scene.rings].sort((a, b) => b.r1 - a.r1)) {
        ctx.beginPath(); ctx.arc(sx(0), sy(0), r.r1 * S, 0, TAU); if (r.r0 > 0) ctx.arc(sx(0), sy(0), r.r0 * S, 0, TAU, true);
        ctx.fillStyle = css[r.kind === "water" ? "--water" : "--land"]; ctx.fill("evenodd");
        ctx.strokeStyle = css[r.kind === "water" ? "--water-edge" : "--land-edge"]; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); gen.heroFill.forEach(poly); ctx.fillStyle = css["--land"]; ctx.fill();
      ctx.beginPath(); gen.heroWater.forEach(poly); ctx.fillStyle = css["--water"]; ctx.fill();
      // ring avenues: pavement, carriageway and one-way arrows
      for (const av of gen.avenues) for (const [a0, a1] of av.arcs) {
        ctx.beginPath(); arcBand(av.r - av.w / 2, av.r + av.w / 2, a0, a1); ctx.fillStyle = css["--pave"]; ctx.fill();
        ctx.beginPath(); arcBand(av.r - av.road / 2, av.r + av.road / 2, a0, a1); ctx.fillStyle = css["--road"]; ctx.fill();
        const stepA = Math.max(60, 90 / S) / av.r, sign = av.dir === "cw" ? -1 : 1, L = Math.max(6, 7 / S), Wd = Math.max(3, 4 / S);
        ctx.beginPath();
        for (let a = a0 + stepA / 2; a < a1; a += stepA) {
          poly([[av.r * Math.cos(a + sign * L / av.r), av.r * Math.sin(a + sign * L / av.r)], [(av.r - Wd) * Math.cos(a), (av.r - Wd) * Math.sin(a)], [(av.r + Wd) * Math.cos(a), (av.r + Wd) * Math.sin(a)]]);
        }
        ctx.fillStyle = css["--gold"]; ctx.fill();
      }
      for (const s of gen.spokes) {
        ctx.beginPath(); for (const [t0, t1] of s.ranges) poly(band(s.a, t0, t1, -P.corridor_half, P.corridor_half)); ctx.fillStyle = css["--pave"]; ctx.fill();
        ctx.beginPath(); for (const [t0, t1] of s.ranges) poly(band(s.a, t0, t1, -P.road_half, P.road_half)); ctx.fillStyle = css["--road"]; ctx.fill();
        ctx.beginPath(); for (const st of s.stairs) for (const side of [-1, 1]) poly(band(s.a, st.t, st.t + st.run, side * split, side * P.corridor_half)); ctx.fillStyle = css["--gold"]; ctx.fill();
        ctx.beginPath(); for (const rp of s.ramps) for (const side of [-1, 1]) poly(band(s.a, rp.t, rp.t + rp.len, side * (P.road_half + P.verge), side * split)); ctx.fillStyle = css["--cyan"]; ctx.fill();
      }
      // cell-edge canals
      ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = css["--canal"];
      const quayOf = (cl) => (plan.districts.find((x) => x.id === cl.d)?.canals?.quay || 0);
      ctx.strokeStyle = css["--pave"];
      for (const cl of gen.canalLines) { ctx.beginPath(); cl.line.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.lineWidth = Math.max(1.2, (cl.width + 2 * quayOf(cl)) * S); ctx.stroke(); }
      ctx.strokeStyle = css["--canal"];
      for (const cl of gen.canalLines) { ctx.beginPath(); cl.line.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.lineWidth = Math.max(1.2, cl.width * S); ctx.stroke(); }
      if (S > 0.25) {
        ctx.beginPath(); gen.boats.forEach(poly); ctx.fillStyle = css["--ink"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); gen.canalBridges.forEach(poly); ctx.fillStyle = css["--pave"]; ctx.fill(); ctx.strokeStyle = css["--land-edge"]; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); gen.basins.forEach((b) => poly(b.poly)); ctx.fillStyle = css["--canal"]; ctx.fill();
      ctx.beginPath(); for (const t of gen.tanks) { ctx.moveTo(sx(t.x) + t.r * S, sy(t.y)); ctx.arc(sx(t.x), sy(t.y), t.r * S, 0, TAU); } ctx.fillStyle = css["--water"]; ctx.fill(); ctx.strokeStyle = css["--land-edge"]; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); gen.parks.forEach(poly); ctx.fillStyle = css["--u-park"]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      // energy: solar farms in the orchards, and the wind blimps flying over their winch stations
      ctx.beginPath(); (gen.solar || []).forEach(poly); ctx.fillStyle = css["--cyan"]; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      for (const b of gen.blimps || []) {
        ctx.save(); ctx.translate(sx(b.x), sy(b.y)); ctx.rotate(-b.wind);
        ctx.beginPath(); ctx.ellipse(0, 0, Math.max(4, b.len / 2 * S), Math.max(1.6, b.r * S), 0, 0, TAU);
        ctx.fillStyle = css["--sheet"]; ctx.fill(); ctx.strokeStyle = css["--ink"]; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
      }
      const mode = $("colorBy").value, byUse = mode === "use", byNb = mode === "nb", nbMap = byNb ? nbIndex() : null;
      if (byUse) for (const u of USES) { ctx.beginPath(); let any = false; for (const c of gen.cells) if (c.use === u && u !== "park") { poly(c.poly); any = true; } if (any) { ctx.fillStyle = css[`--u-${u}`]; ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1; } }
      ctx.strokeStyle = css["--water-edge"]; ctx.lineWidth = Math.max(1, 2.4 * S);
      for (const r of gen.rills) { ctx.beginPath(); ctx.arc(sx(0), sy(0), r.r * S, -r.a0, -r.a1, true); ctx.stroke(); }
      // the Lantern's square, paved, under the planted squares' tint
      if (gen.lantern?.square) { ctx.beginPath(); poly(gen.lantern.square); ctx.fillStyle = css["--pave"]; ctx.fill(); ctx.strokeStyle = css["--land-edge"]; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.beginPath(); (gen.squares || []).forEach(poly); ctx.globalAlpha = 0.35; ctx.fillStyle = css["--tree"]; ctx.fill(); ctx.globalAlpha = 1;
      // lots, batched by colour so 26k footprints draw in a few dozen fills
      const low = new Map(), high = new Map();
      const push = (m, k, pts) => { const l = m.get(k); if (l) l.push(pts); else m.set(k, [pts]); };
      // Old Town lots carry their culture: colour by it rather than by the one Old Town neighbourhood
      const nbCol = (l) => (l.culture ? cultureColour(l.culture) : collegeColour(l) || nbColour(l.nb, nbMap));
      for (const l of gen.lots) {
        if (l.tower && byNb && (l.nb || l.culture)) { const c = nbCol(l); push(low, c, l.poly); push(high, c, l.tower); push(high, c, l.crown); }
        else if (l.tower) { push(low, shade(l.podiumTop), l.poly); push(high, shade(l.top * 0.85), l.tower); push(high, shade(l.top), l.crown); }
        else push(low, byNb && (l.nb || l.culture) ? nbCol(l) : byUse && l.use ? css[`--u-${l.use}`] : shade(l.top), l.poly);
      }
      for (const m of [low, high]) for (const [col, list] of m) {
        ctx.beginPath(); list.forEach(poly); ctx.fillStyle = col; ctx.fill();
        if (S > 0.35) { ctx.strokeStyle = css["--land-edge"]; ctx.lineWidth = 0.5; ctx.stroke(); }
      }
      // Old Town: faint quarter edges, and the landmark buildings outlined in gold
      if ((gen.quarters || []).length) {
        ctx.beginPath(); gen.quarters.forEach((q) => poly(q.poly));
        ctx.strokeStyle = css["--muted"]; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      const landmarks = gen.lots.filter((l) => l.kind === "landmark");
      if (landmarks.length) { ctx.beginPath(); landmarks.forEach((l) => poly(l.poly)); ctx.strokeStyle = css["--gold"]; ctx.lineWidth = Math.max(1.5, 2 * S); ctx.stroke(); }
      if ($("lyr-sky").checked && gen.skywalks.length) {
        ctx.strokeStyle = css["--skywalk"]; ctx.lineWidth = Math.max(1.5, (plan.skywalks?.width || 4) * S); ctx.lineCap = "butt";
        ctx.beginPath();
        for (const w of gen.skywalks) {
          if (w.kind === "arc") { ctx.moveTo(sx(w.r * Math.cos(w.a0)), sy(w.r * Math.sin(w.a0))); ctx.arc(sx(0), sy(0), w.r * S, -w.a0, -w.a1, true); }
          else { ctx.moveTo(sx(w.a[0]), sy(w.a[1])); ctx.lineTo(sx(w.b[0]), sy(w.b[1])); }
        }
        ctx.stroke();
        if (S > 0.2) {  // lifts and staircases
          const m = Math.max(3, 4 * S);
          for (const kind of ["lift", "stairs"]) {
            ctx.beginPath(); for (const a of gen.skyAccess) if (a.kind === kind) ctx.rect(sx(a.x) - m / 2, sy(a.y) - m / 2, m, m);
            ctx.fillStyle = kind === "lift" ? css["--cyan"] : css["--ink"]; ctx.fill();
          }
        }
      }
      if ($("lyr-trees").checked) {
        const tr = Math.max(0.6, 2.6 * S);
        ctx.beginPath();
        for (const [x, y] of gen.trees) { const X = sx(x), Y = sy(y); ctx.moveTo(X + tr, Y); ctx.arc(X, Y, tr, 0, TAU); }
        ctx.fillStyle = css["--tree"]; ctx.fill();
      }
      if ($("lyr-cloud").checked) drawCloud();
      // the Lantern: its base as an outline, its glowing heart as a cyan disc
      const LT = gen.lantern;
      if (LT) {
        const X0 = sx(LT.x), Y0 = sy(LT.y);
        ctx.beginPath(); ctx.arc(X0, Y0, Math.max(3, LT.r_base * S), 0, TAU); ctx.fillStyle = css["--sheet"]; ctx.fill(); ctx.strokeStyle = css["--ink"]; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(X0, Y0, Math.max(2, LT.r_top * S), 0, TAU); ctx.fillStyle = css["--cyan"]; ctx.fill();
      }
      if ($("lyr-labels").checked && S > 0.8 && landmarks.length) {
        ctx.font = `11px "Source Sans 3", system-ui, sans-serif`; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = css["--sheet"]; ctx.fillStyle = css["--gold"];
        for (const l of landmarks) { const [x, y] = centroid(l.poly); ctx.strokeText(l.label, sx(x), sy(y)); ctx.fillText(l.label, sx(x), sy(y)); }
      }
      const d = plan.districts.find((x) => x.id === selected), ring = d && plan.scene.rings.find((r) => r.id === d.ring);
      if (ring) {
        ctx.setLineDash([10, 6]); ctx.strokeStyle = css["--gold"]; ctx.lineWidth = 2;
        for (const r of [ring.r0, ring.r1]) if (r > 0) { ctx.beginPath(); ctx.arc(sx(0), sy(0), r * S, 0, TAU); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      if ($("lyr-cam").checked) {
        const sc = plan.scene, cam = sc.camera, cx = cam.x - sc.center[0], cy = cam.y - sc.center[1], half = rad(cam.hfov_deg / 2), L = 3200;
        ctx.beginPath(); poly([[cx, cy], [cx + L * Math.sin(-half), cy + L * Math.cos(half)], [cx + L * Math.sin(half), cy + L * Math.cos(half)]]);
        ctx.fillStyle = css["--cam"]; ctx.fill(); ctx.setLineDash([3, 5]); ctx.strokeStyle = css["--gold"]; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(sx(cx), sy(cy), 5, 0, TAU); ctx.fillStyle = css["--gold"]; ctx.fill();
      }
      if ($("lyr-labels").checked && (byNb || S > 0.3)) {
        ctx.font = `${byNb ? 14 : 12}px Marcellus, Georgia, serif`; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = css["--sheet"]; ctx.fillStyle = css["--ink"];
        for (const n of gen.neighbourhoods || []) { ctx.strokeText(n.name, sx(n.x), sy(n.y)); ctx.fillText(n.name, sx(n.x), sy(n.y)); }
      }
      if ($("lyr-labels").checked && !byNb) {
        ctx.font = `15px Marcellus, Georgia, serif`; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = css["--sheet"]; ctx.fillStyle = css["--ink"];
        const a = rad(212);
        for (const r of plan.scene.rings) {
          if (r.kind === "water") continue;
          const rr = r.r0 === 0 ? r.r1 * 0.72 : (r.r0 + r.r1) / 2, dist = plan.districts.find((x) => x.ring === r.id);
          const X = sx(rr * Math.cos(a)), Y = sy(rr * Math.sin(a)), txt = dist ? dist.name : r.label;
          ctx.strokeText(txt, X, Y); ctx.fillText(txt, X, Y);
        }
      }
      const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000].find((m) => m * S >= 70) || 2000;
      $("scaleBar").style.width = `${Math.round(nice * S)}px`; $("scaleTxt").textContent = `${fmt(nice)} m`;
    });
  }
  // the cloud heightmap as a tint: gold where it lifts the skyline, cyan where it drops it
  let cloudImg = null, cloudKey = "";
  function drawCloud() {
    const R = Math.max(...plan.scene.rings.map((r) => r.r1)), N = 160, key = JSON.stringify(plan.cloud) + R;
    if (key !== cloudKey) {
      const off = document.createElement("canvas"); off.width = off.height = N;
      const c2 = off.getContext("2d"), img = c2.createImageData(N, N);
      const hex = (h) => { const m = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)); };
      const up = hex(css["--gold"]), down = hex(css["--cyan"]);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -R + (i + 0.5) * 2 * R / N, y = R - (j + 0.5) * 2 * R / N, k = (j * N + i) * 4;
        if (Math.hypot(x, y) > R) { img.data[k + 3] = 0; continue; }
        const n = CityGen.cloud(plan, x, y), col = n >= 0 ? up : down;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Math.round(Math.abs(n) * 150);
      }
      c2.putImageData(img, 0, 0); cloudImg = off; cloudKey = key;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cloudImg, sx(-R), sy(R), 2 * R * S, 2 * R * S);
  }
  const centroid = (q) => q.reduce(([a, b], [x, y]) => [a + x / q.length, b + y / q.length], [0, 0]);
  const cultureLabel = (id) => (plan.neighbourhoods?.types || []).find((t) => t.id === id)?.label || id;
  function cultureColour(id) {
    const t = (plan.neighbourhoods?.types || []).find((x) => x.id === id);
    return t && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : css["--land-edge"];
  }
  // a college ring lot takes its college's colour
  function collegeColour(l) {
    const d = plan.districts.find((x) => x.id === l.d), c = isCampus(d) ? CityGen.collegeOf(d, l.nb) : null;
    return c && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null;
  }
  const nbIndex = () => new Map((gen.neighbourhoods || []).map((n, i) => [n.id, { ...n, i }]));
  function nbColour(id, map) {
    const n = map.get(id), t = (plan.neighbourhoods?.types || []).find((x) => x.id === n?.type);
    if (!n || !t) return css["--land-edge"];
    const v = [1, 3, 5].map((k) => parseInt(t.color.slice(k, k + 2), 16)), f = ((n.i * 37) % 10) / 24;
    return `rgb(${v.map((c) => Math.round(c + (255 - c) * f)).join(",")})`;
  }
  function drawLegend() {
    const mode = $("colorBy").value, byUse = mode !== "height";
    $("legendHeight").hidden = byUse; $("legendUse").hidden = !byUse;
    if (mode === "nb") {
      const park = (plan?.districts || []).find(isCampus), cols = park ? Object.values(CityGen.collegeConfig(park)) : [];
      const name = (c) => plan.neighbourhoods?.renames?.[`park-${c.group}`] || c.name;
      $("legendUse").innerHTML = (plan?.neighbourhoods?.types || []).map((t) => `<span class="key"><i style="background:${esc(t.color)}"></i>${esc(t.label)}</span>`).join("") +
        cols.map((c) => `<span class="key"><i style="background:${esc(c.color)}"></i>${esc(name(c))}</span>`).join("");
      return;
    }
    $("legendUse").innerHTML = "";
    if (byUse && !$("legendUse").childElementCount) $("legendUse").innerHTML = USES.map((u) => `<span class="key"><i style="background:var(--u-${u})"></i>${USE_LABEL[u]}</span>`).join("") + `<span class="key"><i style="background:var(--canal)"></i>Canal</span><span class="key"><i style="background:var(--skywalk)"></i>Skywalk</span>`;
  }
  $("colorBy").addEventListener("change", () => { drawLegend(); drawPlan(); });
  function buildGrid() {
    const cell = 60, m = new Map();
    gen.lots.forEach((l, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of l.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = gx + "," + gy, l2 = m.get(k); if (l2) l2.push(i); else m.set(k, [i]);
      }
    });
    grid = { cell, m };
  }
  function lotAt(x, y) {
    if (!grid) return null;
    for (const i of grid.m.get(Math.floor(x / grid.cell) + "," + Math.floor(y / grid.cell)) || []) {
      const q = gen.lots[i].poly; let inside = false;
      for (let a = 0, b = q.length - 1; a < q.length; b = a++) if ((q[a][1] > y) !== (q[b][1] > y) && x < (q[b][0] - q[a][0]) * (y - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
      if (inside) return i;
    }
    return null;
  }
  function setView(name) {
    const [x, y, w, h] = VIEWS()[name]; Object.assign(view, { x, y, w, h });
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === name)));
    drawPlan();
  }

  // ---------------------------------------------------------------- section along a spoke
  function drawSection() {
    const sc = plan.scene, ter = gen.terrain, W = 1000, H = 250, padL = 36, padR = 10, padT = 12, padB = 26;
    // tall enough for the Lantern and the highest band of roofs
    const LT = gen.lantern, bandHi = maxOf(Object.values(gen.bands).map((b) => b.hi));
    const maxR = Math.max(...sc.rings.map((r) => r.r1)), maxZ = Math.max(LT ? LT.top : 0, Number.isFinite(bandHi) ? bandHi : 0, 220) + 40;
    const X = (r) => padL + (r / maxR) * (W - padL - padR), Y = (z) => padT + (1 - (z + 10) / (maxZ + 10)) * (H - padT - padB);
    const spk = gen.spokes.find((s) => s.k === secSpoke) || gen.spokes[0], prof = spk.profile;
    let s = "";
    for (let z = 0; z <= maxZ; z += 100) s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(z)}" y2="${Y(z)}" stroke="var(--line)"/><text x="${padL - 6}" y="${Y(z) + 4}" font-size="10" text-anchor="end" fill="var(--muted)" font-family="var(--font-data)">${z}</text>`;
    for (const b of Object.values(gen.bands)) s += `<rect x="${X(b.r0)}" y="${Y(b.hi)}" width="${Math.max(2, X(b.r1) - X(b.r0))}" height="${Math.max(0, Y(b.lo) - Y(b.hi))}" fill="${shade(b.hi)}" opacity="0.45"/>`;
    let ground = `M${X(0)} ${Y(-10)}`;
    for (let t = 0; t <= maxR; t += 4) ground += `L${X(t)} ${Y(ter.isWater(t) ? ter.G(t) - 6 : ter.G(t))}`;
    ground += `L${X(maxR)} ${Y(-10)}Z`;
    s += `<path d="${ground}" fill="var(--land)" stroke="var(--land-edge)"/>`;
    for (const r of sc.rings.filter((r) => r.kind === "water")) { const z = ter.G((r.r0 + r.r1) / 2); s += `<rect x="${X(r.r0)}" y="${Y(z)}" width="${X(r.r1) - X(r.r0)}" height="${Y(z - 6) - Y(z)}" fill="var(--water)"/>`; }
    for (const av of gen.avenues) s += `<line x1="${X(av.r)}" x2="${X(av.r)}" y1="${Y(ter.G(av.r) + 18)}" y2="${Y(ter.G(av.r))}" stroke="var(--gold)"/><text x="${X(av.r)}" y="${Y(ter.G(av.r) + 21)}" font-size="10" text-anchor="middle" fill="var(--gold)" font-family="var(--font-data)">${av.dir === "cw" ? "↻" : "↺"}</text>`;
    for (const [t0, t1] of spk.ranges) {
      let road = "", walk = "";
      for (let t = t0; t <= t1 + 1e-6; t += 3) { road += `${t === t0 ? "M" : "L"}${X(t)} ${Y(prof.road(t))}`; walk += `${t === t0 ? "M" : "L"}${X(t)} ${Y(prof.walk(t))}`; }
      s += `<path d="${walk}" fill="none" stroke="var(--cyan)" stroke-width="1.6"/><path d="${road}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>`;
    }
    for (const st of spk.stairs) s += `<rect x="${X(st.t)}" y="${Y(prof.road(st.t))}" width="${Math.max(3, X(st.t + st.run) - X(st.t))}" height="${Y(prof.road(st.t) - st.rise) - Y(prof.road(st.t))}" fill="var(--gold)"/><text x="${X(st.t)}" y="${Y(prof.road(st.t)) - 6}" font-size="10" text-anchor="middle" fill="var(--gold)" font-family="var(--font-data)">${st.n} steps</text>`;
    // the Lantern: tapered shaft to the crown, the glowing heart a little proud of it, crown fins and mast
    if (LT) {
      const crown = LT.crown ?? LT.base + 0.92 * (LT.top - LT.base), w = (r) => Math.max(1.5, X(r) - X(0));
      const rAt = (z) => LT.r_base + (LT.r_top - LT.r_base) * Math.min(1, Math.max(0, (z - LT.base) / (crown - LT.base)));
      s += `<path d="M${X(0)} ${Y(LT.base)}L${X(0) + w(LT.r_base)} ${Y(LT.base)}L${X(0) + w(LT.r_top)} ${Y(crown)}L${X(0)} ${Y(crown)}Z" fill="${shade(hMax * 0.6)}" stroke="var(--land-edge)"/>`;
      s += `<rect x="${X(0)}" y="${Y(LT.heart[1])}" width="${w(rAt(LT.heart[0]) + 1.8)}" height="${Y(LT.heart[0]) - Y(LT.heart[1])}" fill="var(--cyan)"/>`;
      const fins = crown + 0.5 * (LT.top - crown);
      s += `<rect x="${X(0)}" y="${Y(fins)}" width="${w(LT.r_top * 1.05)}" height="${Y(crown) - Y(fins)}" fill="var(--gold)" opacity="0.8"/>`;
      s += `<line x1="${X(0) + 0.5}" x2="${X(0) + 0.5}" y1="${Y(fins)}" y2="${Y(LT.top)}" stroke="var(--gold)" stroke-width="1.4"/>`;
      const cam = sc.camera, camR = Math.hypot(cam.x - sc.center[0], cam.y - sc.center[1]);
      s += `<line x1="${X(camR)}" y1="${Y(cam.z)}" x2="${X(0)}" y2="${Y(LT.top)}" stroke="var(--gold)" stroke-width="1.2" stroke-dasharray="5 4"/><circle cx="${X(camR)}" cy="${Y(cam.z)}" r="4" fill="var(--gold)"/>`;
      s += `<text x="${X(camR)}" y="${Y(cam.z) - 8}" font-size="10" text-anchor="middle" fill="var(--gold)" font-family="var(--font-data)">camera</text><text x="${X(0) + 10}" y="${Y(LT.top) + 9}" font-size="10" fill="var(--gold)" font-family="var(--font-data)">Lantern ${fmt(LT.top - LT.base)} m · top +${fmt(LT.top)} m</text>`;
      s += `<text x="${X(0) + w(LT.r_base) + 6}" y="${(Y(LT.heart[0]) + Y(LT.heart[1])) / 2 + 3}" font-size="10" fill="var(--cyan)" font-family="var(--font-data)">heart +${fmt(LT.heart[0])}–${fmt(LT.heart[1])} m</text>`;
    }
    for (let r = 0; r <= maxR; r += 500) s += `<text x="${X(r)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--muted)" font-family="var(--font-data)">${fmt(r)} m</text>`;
    s += `<g font-size="10" font-family="var(--font-data)"><line x1="${W - 260}" x2="${W - 244}" y1="18" y2="18" stroke="var(--ink)" stroke-width="1.6"/><text x="${W - 240}" y="21" fill="var(--muted)">road</text><line x1="${W - 200}" x2="${W - 184}" y1="18" y2="18" stroke="var(--cyan)" stroke-width="1.6"/><text x="${W - 180}" y="21" fill="var(--muted)">sidewalk</text><rect x="${W - 120}" y="13" width="10" height="10" fill="var(--gold)"/><text x="${W - 106}" y="21" fill="var(--muted)">stairs · ↻↺ avenues</text></g>`;
    const svg = $("section"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none"); svg.innerHTML = s;
  }

  // ---------------------------------------------------------------- inspector
  const NBTAB = "neighbourhoods";
  const TABS = () => [{ id: CITY, name: "Whole city", sub: "Terrain · spokes · skyline" }, { id: NBTAB, name: "Neighbourhoods", sub: "Blobs · types · names" }, ...plan.districts.map((d) => ({ id: d.id, name: d.name, sub: plan.scene.rings.find((r) => r.id === d.ring)?.label || "" }))];
  function drawTabs() {
    $("tabs").innerHTML = TABS().map((t) => `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-selected="${t.id === selected}" data-tab="${t.id}" title="${esc(t.name)}${t.sub ? " · " + esc(t.sub) : ""}"><b>${esc(t.name)}</b><span>${esc(t.sub)}</span></button>`).join("");
  }
  const num = (path, label, unit, o = {}) => ({ path, label, unit, ...o });
  function owner() { return selected === CITY || selected === NBTAB ? null : plan.districts.find((x) => x.id === selected); }
  const isOldTown = (d) => d && d.type === "oldtown";
  const isCampus = (d) => d && d.type === "campus";
  function getPath(path) {
    const [root, rest] = path.startsWith("@") ? [plan, path.slice(1)] : [owner(), path];
    const walk = (r) => rest.split(".").reduce((o, k) => (o == null ? o : o[k]), r);
    const v = walk(root);
    // an Old Town or college setting an older plan lacks shows the value citygen.js builds with
    if (v !== undefined || root === plan) return v;
    if (isOldTown(root)) return walk(CityGen.oldTownConfig(root));
    if (isCampus(root) && rest.startsWith("colleges.")) return walk({ colleges: CityGen.collegeConfig(root) });
    return v;
  }
  function setPath(path, val) {
    const [root, rest] = path.startsWith("@") ? [plan, path.slice(1)] : [owner(), path];
    const ks = rest.split("."), last = ks.pop();
    // fill in an Old Town section from the defaults first, so ranges stay [lo, hi] arrays and an edit to one
    // field never drops the others' defaults
    if (root !== plan && isOldTown(root) && OLD_TOWN_KEYS.includes(ks[0] ?? last)) {
      const k = ks[0] ?? last; root[k] = clone(CityGen.oldTownConfig(root)[k]);
    }
    // the same for the colleges: an edit to one college's setting keeps every other college default
    if (root !== plan && isCampus(root) && ks[0] === "colleges") root.colleges = clone(CityGen.collegeConfig(root));
    const isIdx = (k) => /^\d+$/.test(k);
    const box = ks.reduce((o, k, i) => (o[k] == null ? (o[k] = isIdx(ks[i + 1] ?? last) ? [] : {}) : o[k]), root);
    // no holes in a list: "" for text (a culture left to the seed), else the value itself (a [v, v] range)
    if (Array.isArray(box) && isIdx(last)) for (let i = box.length; i < +last; i++) box[i] = typeof val === "string" ? "" : val;
    // undefined clears the setting (a blank weight field: the key goes, so it reads as unset)
    if (val === undefined) { if (Array.isArray(box)) box[last] = null; else delete box[last]; return; }
    box[last] = val;
  }
  function fieldHTML(f) {
    const raw = getPath(f.path), v = raw == null ? "" : Math.round(raw * (f.scale || 1) * 1e4) / 1e4;
    const id = `f-${selected}-${f.path.replace(/[.@]/g, "-")}`, dis = readOnly ? " disabled" : "";
    return `<div class="f${f.wide ? " wide" : ""}"><label for="${id}">${esc(f.label)}</label><div class="in"><input type="number" id="${id}" data-path="${f.path}" value="${v}" step="${f.step ?? 1}"${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.int ? ' data-int="1"' : ""}${f.blank ? ' data-blank="1"' : ""}${f.scale ? ` data-scale="${f.scale}"` : ""}${dis}>${f.unit ? `<span class="unit">${f.unit}</span>` : ""}</div></div>`;
  }
  function selectHTML(path, label, options, o = {}) {
    // options whose values are "true"/"false" store real booleans; o.fixed shows a value that can't change
    const v = String(o.fixed ?? getPath(path) ?? ""), id = `f-${selected}-${path.replace(/[.@]/g, "-")}`, dis = readOnly || o.fixed != null ? " disabled" : "";
    const kind = options.every(([k]) => k === "true" || k === "false") ? ' data-bool="1"' : ' data-str="1"';
    return `<div class="f"><label for="${id}">${esc(label)}</label><div class="in"><select id="${id}" data-path="${path}"${kind}${dis}>${options.map(([k, t]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div></div>`;
  }
  const group = (legend, fields) => `<fieldset><legend>${legend}</legend>${fields.map(fieldHTML).join("")}</fieldset>`;

  function districtChecks(d) {
    const w = [], L = CityGen.ringLayout(plan, d), ring = L.ring;
    // Old Town runs one ring avenue unless the second is switched on
    const want = isOldTown(d) && !CityGen.oldTownConfig(d).second_avenue ? 1 : 2;
    if (L.avenues.length !== want || (d.avenues || []).length < want) w.push(want === 1 ? "Old Town needs its ring avenue." : isOldTown(d) ? "The second ring avenue is on, so Old Town needs two ring avenues." : "Each ring should carry exactly two ring avenues.");
    L.avenues.forEach((a, i) => {
      if (a.r - a.w / 2 < ring.r0 || a.r + a.w / 2 > ring.r1) w.push(`Ring avenue ${i + 1} runs outside its ring, ${ring.label} (${fmt(ring.r0)}–${fmt(ring.r1)} m).`);
      if ((a.road || 12) > a.w - 4) w.push(`Ring avenue ${i + 1}: the road leaves no room for pavements.`);
    });
    if (L.avenues.length === 2 && L.avenues[0].r + L.avenues[0].w / 2 >= L.avenues[1].r - L.avenues[1].w / 2) w.push("The two ring avenues overlap.");
    L.bands.forEach((b, i) => { if (b.r1 - b.r0 < 40) w.push(`Band ${i + 1} is only ${fmt(b.r1 - b.r0)} m deep; blocks need about 40 m.`); });
    const capped = gen.lots.filter((l) => l.d === d.id && l.capped).length;
    if (capped) w.push(`${capped} tower${capped > 1 ? "s are" : " is"} capped to keep the Lantern's heart in view.`);
    return w;
  }
  function statsHTML() {
    if (selected === NBTAB) return $("panel").querySelector(".readout")?.outerHTML || "";
    if (selected === CITY) {
      const tops = gen.lots.map((l) => l.top);
      return `<div class="readout"><div class="stats"><div class="stat"><span>Buildings</span><strong>${fmt(gen.lots.length)}</strong></div><div class="stat"><span>Tallest roof</span><strong>${fmt(maxOf(tops))} m</strong></div><div class="stat"><span>Skywalks</span><strong>${fmt(gen.skywalks.filter((w) => w.kind === "arc").reduce((t, w) => t + (w.a1 - w.a0) * w.r, 0) / 1000, 1)} km</strong></div></div></div>`;
    }
    const d = owner(), mine = gen.lots.filter((l) => l.d === d.id), tops = mine.map((l) => l.top);
    const gfa = mine.reduce((t, l) => t + l.area * Math.max(1, l.storeys), 0);
    const cells = gen.cells.filter((c) => c.d === d.id), counts = USES.map((u) => [u, cells.filter((c) => c.use === u).length]).filter(([, n]) => n);
    const mix = cells.length ? `<div class="mix" title="${counts.map(([u, n]) => `${USE_LABEL[u]} ${Math.round(100 * n / cells.length)}%`).join(" · ")}">${counts.map(([u, n]) => `<i style="width:${100 * n / cells.length}%;background:var(--u-${u})"></i>`).join("")}</div><div class="panel-foot">${counts.map(([u, n]) => `${USE_LABEL[u]} ${Math.round(100 * n / cells.length)}%`).join(" · ")}</div>` : "";
    return `<div class="readout">` + mix + `<div class="stats"><div class="stat"><span>${d.type === "towers" ? "Towers" : "Buildings"}</span><strong>${fmt(mine.length)}</strong></div>` +
      `<div class="stat"><span>Roofs (m)</span><strong>${tops.length ? `${fmt(minOf(tops))}–${fmt(maxOf(tops))}` : "—"}</strong></div>` +
      `<div class="stat"><span>Floor area</span><strong>${fmt(gfa / 10000, 0)} ha</strong></div></div></div>`;
  }
  function warnsHTML() {
    if (selected === NBTAB) return `<div class="warns"></div>`;
    const w = selected === CITY ? gen.warnings : districtChecks(owner());
    return `<div class="warns" aria-live="polite">${w.map((x) => `<div class="warn">${esc(x)}</div>`).join("")}</div>`;
  }

  function cityPanel() {
    let h = `<div><div class="kind">Shared by every district</div><h3>Whole city</h3></div>` + statsHTML() + warnsHTML();
    h += group("Terrain heights", [
      num("@scene.terrain.belt.0", "Green belt, outer edge", "m", { step: 0.1 }), num("@scene.terrain.belt.1", "Green belt, inner edge", "m", { step: 0.1 }),
      num("@scene.terrain.park.0", "College ring, outer edge", "m", { step: 0.1 }), num("@scene.terrain.park.1", "College ring, inner edge", "m", { step: 0.1 }),
      num("@scene.terrain.island.0", "Old Town canal edge", "m", { step: 0.1 }), num("@scene.terrain.island.1", "Old Town centre", "m", { step: 0.1 }),
      num("@scene.terrain.plateau_r", "Plateau radius", "m", { min: 0, max: 400 }), num("@scene.terrain.canal2_below", "Canal 2 water below belt", "m", { step: 0.1, min: 0.2 })]);
    h += group("Spoke avenues", [
      num("@spokes.count", "Spokes", "", { int: true, min: 3, max: 16 }), num("@spokes.offset_deg", "Rotate spokes", "°", { min: -30, max: 30 }),
      num("@spokes.grade", "Road grade", "%", { scale: 100, step: 0.1, min: 2, max: 10 }), num("@spokes.corridor_half", "Half width, wall to wall", "m", { step: 0.5, min: 12, max: 60 }),
      num("@spokes.road_half", "Half width, road", "m", { step: 0.1, min: 4, max: 30 }), num("@spokes.verge", "Tree verge", "m", { step: 0.1, min: 0, max: 10 }),
      num("@spokes.tree_spacing", "Verge tree spacing", "m", { step: 0.5, min: 4, max: 40 }), num("@spokes.hero_fill_deg", "Ground fill by hero avenue", "°", { step: 0.5, min: 0, max: 20 })]);
    h += group("Stairs and ramps at level changes", [
      num("@spokes.step_threshold", "Stairs from a rise of", "m", { step: 0.1, min: 0.2, max: 5 }), num("@spokes.riser_max", "Max riser", "m", { step: 0.01, min: 0.12, max: 0.2 }),
      num("@spokes.tread", "Tread", "m", { step: 0.01, min: 0.25, max: 0.45 }), num("@spokes.landing_every", "Landing every", "steps", { int: true, min: 6, max: 20 }),
      num("@spokes.ramp_slope", "Ramp gradient", "%", { scale: 100, step: 0.1, min: 4, max: 8.4 }), num("@spokes.ramp_share", "Ramp share of sidewalk", "%", { scale: 100, step: 1, min: 20, max: 70 })]);
    h += group("Skyline", [
      num("@skyline.outer_storeys", "Storeys at the edge", "", { step: 0.5, min: 1 }), num("@skyline.inner_storeys", "Storeys by the colleges", "", { step: 0.5, min: 1 }),
      num("@skyline.chaos", "Chaos", "", { step: 0.02, min: 0, max: 1 }), num("@skyline.spike_chance", "Spike chance", "%", { scale: 100, step: 0.5, min: 0, max: 40 }),
      num("@skyline.spike.0", "Spike from", "×", { step: 0.05, min: 1, max: 4 }), num("@skyline.spike.1", "Spike to", "×", { step: 0.05, min: 1, max: 4 }),
      num("@skyline.min", "Fewest storeys", "", { int: true, min: 1 }), num("@skyline.max", "Most storeys", "", { int: true, min: 2, max: 60 })]);
    h += `<fieldset><legend>Cloud heightmap · lifts or drops the skyline</legend>${selectHTML("@cloud.enabled", "Cloud", [["true", "On"], ["false", "Off"]])}` +
      [num("@cloud.amount", "Strength", "×", { step: 0.05, min: 0, max: 2 }), num("@cloud.scale", "Patch size", "m", { step: 10, min: 100, max: 5000 }),
       num("@cloud.octaves", "Detail layers", "", { int: true, min: 1, max: 8 }), num("@cloud.persistence", "Detail strength", "", { step: 0.05, min: 0.1, max: 0.9 }),
       num("@cloud.contrast", "Contrast", "", { step: 0.05, min: 0.5, max: 4 }), num("@cloud.bias", "Overall lift", "", { step: 0.05, min: -1, max: 1 }),
       num("@cloud.seed", "Seed", "", { int: true, min: 0, max: 99999 }), num("@cloud.tower_share", "Share on Old Town towers", "×", { step: 0.05, min: 0, max: 1 })].map(fieldHTML).join("") + `</fieldset>`;
    h += `<fieldset><legend>Skywalks · one connected network per ring</legend>${selectHTML("@skywalks.enabled", "Skywalks", [["true", "On"], ["false", "Off"]])}` +
      [num("@skywalks.levels.0", "Storeys up, from", "", { int: true, min: 1, max: 10 }), num("@skywalks.levels.1", "Storeys up, to", "", { int: true, min: 1, max: 10 }),
       num("@skywalks.width", "Deck width", "m", { step: 0.5, min: 2, max: 12 }), num("@skywalks.frontage.commercial", "Along commercial", "%", { scale: 100, step: 1, min: 0, max: 100 }),
       num("@skywalks.frontage.entertainment", "Along entertainment", "%", { scale: 100, step: 1, min: 0, max: 100 }), num("@skywalks.frontage.residential", "Along housing", "%", { scale: 100, step: 1, min: 0, max: 100 }),
       num("@skywalks.frontage.college", "Along colleges", "%", { scale: 100, step: 1, min: 0, max: 100 }), num("@skywalks.join_gap", "Join gaps up to", "m", { step: 5, min: 0, max: 400 }),
       num("@skywalks.min_run", "Shortest run kept", "m", { step: 5, min: 0, max: 1000 }), num("@skywalks.cross_every", "Avenue crossing every", "m", { step: 10, min: 50, max: 5000 }),
       num("@skywalks.access_every", "Lift or stairs every", "m", { step: 10, min: 40, max: 2000 }),
       num("@skywalks.rungs_per_sector", "Links between a ring's two loops, per sector", "", { int: true, min: 1, max: 8 }),
       num("@skywalks.over.per_sector", "Sky bridges over the roofs, per sector", "", { int: true, min: 0, max: 12 }), num("@skywalks.over.clearance", "Bridge clearance over roofs", "m", { step: 0.5, min: 1, max: 20 }),
       num("@skywalks.over.max_storeys", "Bridges no higher than", "storeys", { int: true, min: 4, max: 60 }),
       num("@skywalks.spoke_links.clearance_storeys", "Ring-to-ring links clear the spoke by", "storeys", { step: 0.5, min: 1, max: 10 }),
       num("@skywalks.edges.chance", "Walkways along cell streets", "%", { scale: 100, step: 1, min: 0, max: 100 }), num("@skywalks.edges.end_access", "Lift or stairs at loose ends", "%", { scale: 100, step: 1, min: 0, max: 100 })].map(fieldHTML).join("") +
      selectHTML("@skywalks.edges.over_canals", "Walkways above canals too", [["false", "No"], ["true", "Yes"]]) +
      selectHTML("@skywalks.spoke_links.enabled", "Link the rings along the spokes", [["true", "Yes"], ["false", "No"]]) +
      `<div class="f"><label for="f-sky-sides">Links on each spoke</label><div class="in"><select id="f-sky-sides" data-path="@skywalks.spoke_links.sides"${readOnly ? " disabled" : ""}>${[[1, "One side"], [2, "Both sides"]].map(([k, t]) => `<option value="${k}"${(plan.skywalks?.spoke_links?.sides || 1) === k ? " selected" : ""}>${t}</option>`).join("")}</select></div></div>` +
      selectHTML("@skywalks.spoke_links.skip_hero", "On the hero avenue too", [["false", "Yes"], ["true", "No"]]) + `</fieldset>`;
    h += `<fieldset><legend>Energy · in the orchards</legend>${selectHTML("@energy.enabled", "Solar farms and wind blimps", [["true", "On"], ["false", "Off"]])}` +
      [num("@energy.solar.per_sector", "Solar farms per sector", "", { int: true, min: 0, max: 8 }), num("@energy.blimps.per_sector", "Wind blimps per sector", "", { int: true, min: 0, max: 8 }),
       num("@energy.blimps.altitude.0", "Blimps fly from", "m", { step: 10, min: 60, max: 1000 }), num("@energy.blimps.altitude.1", "Blimps fly to", "m", { step: 10, min: 60, max: 1000 }),
       num("@energy.blimps.length", "Blimp length", "m", { step: 1, min: 15, max: 150 }), num("@energy.wind_deg", "Prevailing wind from", "°", { step: 5, min: 0, max: 360 })].map(fieldHTML).join("") + `</fieldset>`;
    h += `<fieldset><legend>Plots · Voronoi cells are plots, buildings sit inside</legend>${selectHTML("@plots.layout", "Buildings", [["buildings", "Separate, squared to the street"], ["cell", "One block filling the cell (old)"]])}` +
      [num("@plots.height_var", "Height variety between buildings", "", { step: 0.02, min: 0, max: 1 }), num("@plots.gap.1", "Gaps between buildings up to", "m", { step: 0.5, min: 0, max: 40 }), num("@plots.setback", "Set back from the street", "m", { step: 0.5, min: 0, max: 20 }),
       num("@plots.roofs.deco", "Roofs · decorative tops", "", { step: 0.05, min: 0, max: 10 }), num("@plots.roofs.open", "Roofs · open terraces", "", { step: 0.05, min: 0, max: 10 }),
       num("@plots.roofs.garden", "Roofs · gardens", "", { step: 0.05, min: 0, max: 10 }), num("@plots.roofs.farm", "Roofs · farms", "", { step: 0.05, min: 0, max: 10 })].map(fieldHTML).join("") + `</fieldset>`;
    h += group("Land use", [num("@landuse.waterfront_depth", "Waterfront reaches inland", "m", { step: 5, min: 10, max: 1000 }), num("@landuse.clustering", "Neighbourhood clustering", "", { step: 0.05, min: 0, max: 3 }),
      num("@landuse.cluster_scale", "Neighbourhood size", "m", { step: 10, min: 50, max: 3000 }), num("@landuse.types.commercial.height", "Commercial height", "×", { step: 0.05, min: 0.5, max: 3 }),
      num("@landuse.types.industrial.storeys.0", "Industrial storeys from", "", { int: true, min: 1, max: 6 }), num("@landuse.types.industrial.storeys.1", "Industrial storeys to", "", { int: true, min: 1, max: 6 }),
      num("@landuse.types.industrial.storey", "Industrial storey height", "m", { step: 0.5, min: 3, max: 15 }), num("@landuse.types.hydroponics.storeys.1", "Greenhouse storeys up to", "", { int: true, min: 1, max: 10 }),
      num("@landuse.types.entertainment.storeys.1", "Venue storeys up to", "", { int: true, min: 1, max: 15 }), num("@landuse.types.park.tree_spacing", "Park tree spacing", "m", { step: 0.5, min: 4, max: 60 })]);
    h += `<fieldset><legend>Roofs</legend>${selectHTML("@skyline.roof_by", "Roof heights per", [["cell", "Cell (whole block)"], ["lot", "Lot (varied)"]])}</fieldset>`;
    h += `<fieldset><legend>Canal houses · gabled, along the grachten</legend>${selectHTML("@canal_houses.enabled", "Canal houses", [["true", "On"], ["false", "Off"]])}` +
      [num("@canal_houses.lot.0", "Frontage from", "m", { step: 0.5, min: 4, max: 20 }), num("@canal_houses.lot.1", "Frontage to", "m", { step: 0.5, min: 4, max: 30 }), num("@canal_houses.depth", "House depth", "m", { step: 0.5, min: 6, max: 30 })].map(fieldHTML).join("") + `</fieldset>`;
    h += group("Voronoi blocks", [num("@voronoi.jitter", "Seed jitter", "%", { scale: 100, step: 1, min: 0, max: 100 }), num("@voronoi.relax", "Relaxation passes", "", { int: true, min: 0, max: 4 })]);
    h += group("Organic layout", [
      num("@skyline.block_var", "Block length variation", "%", { scale: 100, step: 1, min: 0, max: 90 }), num("@skyline.street_var", "Street width variation", "%", { scale: 100, step: 1, min: 0, max: 90 }),
      num("@skyline.skew_deg", "Skew of cross streets", "°", { step: 0.5, min: 0, max: 25 }), num("@skyline.plaza_chance", "Square instead of a block", "%", { scale: 100, step: 0.5, min: 0, max: 40 }),
      num("@skyline.lot.0", "Lot frontage from", "m", { step: 0.5, min: 6 }), num("@skyline.lot.1", "Lot frontage to", "m", { step: 0.5, min: 8 }),
      num("@storey", "Storey height", "m", { step: 0.1, min: 2.5, max: 6 }), num("@side_street", "Local street width", "m", { step: 0.5, min: 4, max: 40 })]);
    return h;
  }

  function districtPanel(d) {
    const dis = readOnly ? " disabled" : "";
    let h = `<div><div class="kind">${esc(TYPE_LABEL[d.type] || d.type)} · ${esc(plan.scene.rings.find((r) => r.id === d.ring)?.label || "")}</div><h3>${esc(d.name)}</h3></div>` + statsHTML() + warnsHTML();
    h += `<fieldset><legend>District</legend>
      <div class="f"><label for="f-${d.id}-enabled">Build in Blender</label><div class="in"><select id="f-${d.id}-enabled" data-path="enabled" data-bool="1"${dis}><option value="true"${d.enabled !== false ? " selected" : ""}>Yes</option><option value="false"${d.enabled === false ? " selected" : ""}>No, skip</option></select></div></div>
      ${d.type !== "towers" && !isOldTown(d) ? selectHTML("layout", "Block layout", [["voronoi", "Voronoi cells"], ["rows", "Rows between avenues"]]) : ""}
      <div class="f"><label for="f-${d.id}-dressing">Kit dressing (later)</label><div class="in"><select id="f-${d.id}-dressing" data-path="dressing" data-str="1"${dis}>${DRESSINGS.map((k) => `<option value="${esc(k)}"${(d.dressing || "") === k ? " selected" : ""}>${k ? esc(k) : "Massing only"}</option>`).join("")}</select></div></div></fieldset>`;
    // the two ring avenues, counted from the centre: the first runs clockwise, the second anticlockwise
    const shown = isOldTown(d) && !CityGen.oldTownConfig(d).second_avenue ? 1 : Infinity;
    [...(d.avenues || [])].map((a, k) => ({ a, k })).sort((x, y) => x.a.r - y.a.r).slice(0, shown).forEach(({ a, k }, order) => {
      const ring = plan.scene.rings.find((r) => r.id === d.ring);
      const f = [num(`avenues.${k}.r`, "Radius", "m", { min: Math.ceil(ring.r0 + a.w / 2), max: Math.floor(ring.r1 - a.w / 2) }), num(`avenues.${k}.w`, "Width, wall to wall", "m", { min: 8, max: 80, step: 0.5 }), num(`avenues.${k}.road`, "Road width", "m", { min: 4, max: 40, step: 0.5 })];
      if (a.tree_spacing != null) f.push(num(`avenues.${k}.tree_spacing`, "Tree spacing", "m", { min: 4, max: 60, step: 0.5 }));
      h += group(`Ring avenue ${order + 1} · ${order % 2 === 0 ? "clockwise ↻" : "anticlockwise ↺"}`, f);
    });
    if (d.recipe && d.layout === "voronoi") {
      const cell = (side, u) => { const id = `f-${d.id}-recipe-${side}-${u}`; return `<input type="number" id="${id}" data-path="recipe.${side}.${u}" value="${d.recipe[side]?.[u] ?? 0}" step="0.1" min="0" max="20" aria-label="${USE_LABEL[u]} ${side}"${readOnly ? " disabled" : ""}>`; };
      h += `<fieldset><legend>Land-use recipe · relative weights</legend><table class="recipe"><thead><tr><th>Use</th><th>Waterfront</th><th>Inland</th></tr></thead><tbody>${CityGen.RECIPE_USES.map((u) => `<tr><td><i style="background:var(--u-${u})"></i>${USE_LABEL[u]}</td><td>${cell("waterfront", u)}</td><td>${cell("inland", u)}</td></tr>`).join("")}</tbody></table></fieldset>`;
    }
    if (d.neighbourhood && plan.neighbourhoods?.types) h += `<fieldset><legend>Neighbourhoods in this ring</legend>${selectHTML("neighbourhood.mode", "Layout", [["", "Blobs, like the other rings"], ["whole", "One neighbourhood"], ["spokes", "Split at the spokes"]])}${selectHTML("neighbourhood.type", "Type", plan.neighbourhoods.types.map((t) => [t.id, t.label]))}` +
      [num("neighbourhood.per", "Spoke sectors each", "", { int: true, min: 1, max: plan.spokes.count }), num("neighbourhood.start_spoke", "First split at spoke", "", { int: true, min: 0, max: plan.spokes.count - 1 })].map(fieldHTML).join("") + `</fieldset>`;
    if (d.layout === "voronoi" && plan.neighbourhoods?.types) h += group("Neighbourhood mix · relative weights", plan.neighbourhoods.types.map((t) => num(`neighbourhood_weights.${t.id}`, t.label, "", { step: 0.1, min: 0, max: 20 })));
    if (d.harbours && d.layout === "voronoi") h += group("Harbours on the ring canals", [num("harbours.chance", "Chance per canal-side cell", "%", { scale: 100, step: 1, min: 0, max: 100 }), num("harbours.waterworks_share", "Of those, waterworks", "%", { scale: 100, step: 1, min: 0, max: 100 })]);
    if (d.canals && d.layout === "voronoi") h += group("Canals along cell edges · Dutch grachten", [num("canals.per_sector", "Canals per sector", "", { int: true, min: 0, max: 8 }), num("canals.width", "Water width", "m", { step: 0.5, min: 4, max: 40 }),
      num("canals.quay", "Quay street each side", "m", { step: 0.5, min: 0, max: 20 }), num("canals.depth", "Water below the quay", "m", { step: 0.1, min: 0.5, max: 6 }),
      num("canals.tree_spacing", "Elm spacing on the quays", "m", { step: 0.5, min: 0, max: 40 }), num("canals.houseboat_chance", "Houseboats", "%", { scale: 100, step: 1, min: 0, max: 100 }),
      num("canals.bridge_chance", "Bridges at street crossings", "%", { scale: 100, step: 1, min: 0, max: 100 })]);
    if (d.type === "perimeter") h += group("Blocks", [num("quay_in", "Setback from inner edge", "m", { min: 0, max: 200 }), num("quay_out", "Setback from outer edge", "m", { min: 0, max: 200 }),
      num("row_depth", "Block depth", "m", { min: 30, max: 300 }), num("block", "Block length", "m", { min: 20, max: 400 }),
      num("wing", "Courtyard wing depth", "m", { min: 6, max: 40 }), num("wobble", "Wobble", "m", { step: 0.5, min: 0, max: 40 }), num("height_scale", "Height scale", "×", { step: 0.05, min: 0.3, max: 3, wide: true })]);
    if (d.type === "campus") {
      h += `<fieldset><legend>Bands, centre outward</legend>${[0, 1, 2].map((k) => selectHTML(`band_kinds.${k}`, `Band ${k + 1}`, BAND_KINDS)).join("")}</fieldset>`;
      h += group("Colleges", [num("campus.row_depth", "Court depth", "m", { min: 30, max: 300 }), num("campus.block", "Plot length", "m", { min: 30, max: 400 }), num("campus.street", "Walk between plots", "m", { min: 6, max: 120 }), num("campus.wing", "Court wing depth", "m", { min: 6, max: 40 }), num("storeys.0", "Storeys from", "", { int: true, min: 1, max: 20 }), num("storeys.1", "Storeys to", "", { int: true, min: 1, max: 20 })]);
      h += group("Planting", [num("orchard.spacing", "Orchard spacing", "m", { min: 4, max: 60, step: 0.5 }), num("grove.spacing", "Grove spacing", "m", { min: 4, max: 60, step: 0.5 }), num("grove.clearing", "Grove clearings", "%", { scale: 100, min: 0, max: 90, step: 1 }), num("quay_in", "Setback from inner edge", "m", { min: 0, max: 200 })]);
    }
    if (isCampus(d)) h += collegeGroups(d);
    if (isOldTown(d)) h += oldTownGroups(d);
    h += `<fieldset><legend>Notes</legend><div class="f wide"><label for="f-${d.id}-notes">For this district</label><div class="in"><textarea id="f-${d.id}-notes" data-path="notes" data-str="1"${dis}>${esc(d.notes || "")}</textarea></div></div></fieldset>`;
    return h;
  }

  // the college ring's three colleges: each one's name (its neighbourhood's), its landmark and whether it grows
  function collegeGroups(d) {
    const cfg = CityGen.collegeConfig(d), renames = plan.neighbourhoods?.renames || {}, dis = readOnly ? " disabled" : "", onOff = [["true", "On"], ["false", "Off"]];
    const rows = Object.entries(cfg).map(([id, c]) => {
      const g = `park-${c.group}`, n = (gen.neighbourhoods || []).find((x) => x.id === g), auto = n ? n.auto : c.name, fid = `f-${d.id}-college-${id}-name`;
      return `<div class="f"><label for="${fid}"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(c.color)}"></i> Name</label><div class="in"><input type="text" id="${fid}" data-path="@neighbourhoods.renames.${g}" data-str="1" placeholder="${esc(auto)}" value="${esc(renames[g] || "")}" aria-label="Name for ${esc(c.name)}"${dis}></div></div>` +
        selectHTML(`colleges.${id}.landmark`, `${renames[g] || auto} · landmark`, onOff) +
        selectHTML(`colleges.${id}.grow`, `${renames[g] || auto} · grows into its band`, onOff, id === "saffron" ? { fixed: "false" } : {});
    });
    return `<fieldset><legend>Colleges · names, landmarks and growth</legend>${rows.join("")}</fieldset>`;
  }

  // Old Town: the street grid round the Lantern square, the culture quarters, heights, the Lantern, landmarks
  function oldTownGroups(d) {
    const types = plan.neighbourhoods?.types || [], cfg = CityGen.oldTownConfig(d), n = Math.max(0, Math.round(cfg.quarters.count) || 0);
    let h = group("Grid · round the Lantern square", [num("grid.block", "Block size", "m", { step: 0.5, min: 30, max: 80 }), num("grid.street", "Street width", "m", { step: 0.5, min: 6, max: 30 }),
      num("grid.square", "Square size", "m", { step: 1, min: 60, max: 200 })]);
    // relative weights: a blank (or 0) field leaves that culture out; with every field blank the pick is even
    if (types.length) h += group("Grid tower forms · relative weights; blank or 0 leaves a culture out, all blank for an even mix", types.map((t) => num(`grid.forms.${t.id}`, t.label, "", { step: 0.1, min: 0, max: 20, blank: true })));
    h += `<fieldset><legend>Quarters · between the ring avenue and the canal</legend>` + [num("quarters.count", "Quarters", "", { int: true, min: 4, max: 30 }), num("quarters.seed", "Angle seed", "", { int: true, min: 0, max: 99999 }),
      num("quarters.block.0", "Block size from", "m", { step: 0.5, min: 20, max: 80 }), num("quarters.block.1", "Block size to", "m", { step: 0.5, min: 20, max: 80 })].map(fieldHTML).join("") +
      Array.from({ length: n }, (_, k) => {
        const now = (gen.quarters || []).find((q) => q.k === k);
        return selectHTML(`quarters.cultures.${k}`, `Quarter ${k + 1}${now ? ` · now ${cultureLabel(now.culture)}` : ""}`, [["", "Seeded"], ...types.map((t) => [t.id, t.label])]);
      }).join("") + `</fieldset>`;
    // the seeded pick for quarters left to the seed (an override above always wins)
    if (types.length) h += group("Quarter cultures · relative weights; blank or 0 leaves a culture out, all blank for an even mix", types.map((t) => num(`quarters.weights.${t.id}`, t.label, "", { step: 0.1, min: 0, max: 20, blank: true })));
    h += group("Heights · above the ground", [num("heights.grid.0", "Grid towers from", "m", { min: 10, max: 900 }), num("heights.grid.1", "Grid towers to", "m", { min: 10, max: 900 }),
      num("heights.band.0", "Quarter towers from", "m", { min: 10, max: 900 }), num("heights.band.1", "Quarter towers to", "m", { min: 10, max: 900 }),
      num("heights.landmark.0", "Landmarks from", "m", { min: 5, max: 400 }), num("heights.landmark.1", "Landmarks to", "m", { min: 5, max: 400 })]);
    h += group("Lantern", [num("lantern.height", "Height above the square", "m", { step: 5, min: 100, max: 900 }), num("lantern.base", "Base width", "m", { step: 1, min: 20, max: 120 }),
      num("lantern.taper", "Taper, top over base", "", { step: 0.01, min: 0.7, max: 0.95 }), num("lantern.clearance", "Roofs stay below the heart's top by", "m", { step: 1, min: 0, max: 300 }),
      num("lantern.heart.0", "Heart from", "%", { scale: 100, step: 1, min: 5, max: 90 }), num("lantern.heart.1", "Heart to", "%", { scale: 100, step: 1, min: 5, max: 90 })]);
    h += group("Landmarks", [num("landmarks.embassies", "Embassies", "", { int: true, min: 0, max: 20 }), num("landmarks.guild_halls", "Guild halls", "", { int: true, min: 0, max: 20 })]);
    h += `<fieldset><legend>Ring avenues</legend>${selectHTML("second_avenue", "Second ring avenue", [["false", "Off"], ["true", "On"]])}</fieldset>`;
    return h;
  }

  function nbPanel() {
    const N = plan.neighbourhoods || {}, types = N.types || [], dis = readOnly ? " disabled" : "";
    let h = `<div><div class="kind">A coarse Voronoi grid over the building cells</div><h3>Neighbourhoods</h3></div>`;
    h += `<div class="readout"><div class="stats"><div class="stat"><span>Neighbourhoods</span><strong>${(gen.neighbourhoods || []).length}</strong></div><div class="stat"><span>Types</span><strong>${types.length}</strong></div><div class="stat"><span>Cells each</span><strong>${(gen.neighbourhoods || []).length ? Math.round(gen.cells.filter((c) => c.nb).length / gen.neighbourhoods.length) : 0}</strong></div></div></div><div class="warns"></div>`;
    h += `<fieldset><legend>Blobs</legend>${selectHTML("@neighbourhoods.enabled", "Neighbourhoods", [["true", "On"], ["false", "Off"]])}${selectHTML("@neighbourhoods.span_rings", "Across rings", [["true", "Span the ring canals"], ["false", "Stay in one ring"]])}` +
      [num("@neighbourhoods.count", "How many, roughly", "", { int: true, min: 2, max: 400 }), num("@neighbourhoods.warp", "Blob wobble", "", { step: 0.05, min: 0, max: 2 }),
       num("@neighbourhoods.warp_scale", "Wobble size", "m", { step: 10, min: 50, max: 4000 }), num("@neighbourhoods.seed", "Seed (new layout and names)", "", { int: true, min: 0, max: 99999 })].map(fieldHTML).join("") + `</fieldset>`;
    types.forEach((t, k) => {
      h += `<fieldset><legend><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(t.color)}"></i> ${esc(t.label)}</legend>
        <div class="f"><label for="f-nb-label-${k}">Type name</label><div class="in"><input type="text" id="f-nb-label-${k}" data-path="@neighbourhoods.types.${k}.label" data-str="1" value="${esc(t.label)}"${dis}></div></div>
        <div class="f"><label for="f-nb-dress-${k}">Kit dressing</label><div class="in"><select id="f-nb-dress-${k}" data-path="@neighbourhoods.types.${k}.dressing" data-str="1"${dis}>${DRESSINGS.map((x) => `<option value="${esc(x)}"${(t.dressing || "") === x ? " selected" : ""}>${x ? esc(x) : "Massing only"}</option>`).join("")}</select></div></div>` +
        [num(`@neighbourhoods.types.${k}.height`, "Height", "×", { step: 0.05, min: 0.2, max: 3 }), num(`@neighbourhoods.types.${k}.skywalk`, "Skywalks", "×", { step: 0.05, min: 0, max: 5 }),
         // the culture's way of building: blank fields fall back to the city-wide plot settings
         num(`@neighbourhoods.types.${k}.style.lot.0`, "Building frontage, from", "m", { step: 0.5, min: 4, max: 80 }), num(`@neighbourhoods.types.${k}.style.lot.1`, "Building frontage, to", "m", { step: 0.5, min: 4, max: 120 }),
         num(`@neighbourhoods.types.${k}.style.depth`, "Building depth", "m", { step: 0.5, min: 5, max: 60 }), num(`@neighbourhoods.types.${k}.style.gap.1`, "Gaps between buildings up to", "m", { step: 0.5, min: 0, max: 40 }),
         num(`@neighbourhoods.types.${k}.style.setback`, "Set back from the street", "m", { step: 0.5, min: 0, max: 20 }), num(`@neighbourhoods.types.${k}.style.height_var`, "Height variety", "", { step: 0.02, min: 0, max: 1 })].map(fieldHTML).join("") +
        [["deco", "Decorative tops"], ["open", "Open roof terraces"], ["garden", "Roof gardens"], ["farm", "Roof farms"]].map(([rk, rl]) => fieldHTML(num(`@neighbourhoods.types.${k}.style.roofs.${rk}`, `Roofs · ${rl}`, "", { step: 0.05, min: 0, max: 10 }))).join("") +
        // how this culture builds its Old Town towers
        [num(`@neighbourhoods.types.${k}.style.tower.podium.0`, "Old Town tower podium, storeys from", "", { int: true, min: 0, max: 20 }), num(`@neighbourhoods.types.${k}.style.tower.podium.1`, "Podium storeys to", "", { int: true, min: 0, max: 20 }),
         num(`@neighbourhoods.types.${k}.style.tower.tiers`, "Tower tiers", "", { int: true, min: 1, max: 5 }), num(`@neighbourhoods.types.${k}.style.tower.taper`, "Tower taper", "", { step: 0.05, min: 0, max: 0.5 })].map(fieldHTML).join("") +
        selectHTML(`@neighbourhoods.types.${k}.style.tower.plan`, "Tower plan", TOWER_PLANS) + selectHTML(`@neighbourhoods.types.${k}.style.tower.crown`, "Tower crown", TOWER_CROWNS) +
        `<div class="f wide"><label for="f-nb-names-${k}">Name patterns ({W} is the word)</label><div class="in"><input type="text" id="f-nb-names-${k}" data-path="@neighbourhoods.types.${k}.names" data-list="1" value="${esc((t.names || []).join(", "))}"${dis}></div></div>
        <table class="recipe"><thead><tr><th>Leans toward</th><th>×</th></tr></thead><tbody>${CityGen.RECIPE_USES.map((u) => `<tr><td><i style="background:var(--u-${u})"></i>${USE_LABEL[u]}</td><td><input type="number" id="f-nb-${k}-${u}" data-path="@neighbourhoods.types.${k}.bias.${u}" value="${t.bias?.[u] ?? 1}" step="0.1" min="0" max="10"${dis}></td></tr>`).join("")}</tbody></table></fieldset>`;
    });
    const rings = new Map(plan.districts.map((x) => [x.id, x.name]));
    h += `<fieldset><legend>Names · leave blank for the generated one</legend><table class="nbtable" style="grid-column:1/-1"><thead><tr><th>Name</th><th>Type</th><th>Rings</th><th>Cells</th></tr></thead><tbody>${(gen.neighbourhoods || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((n) =>
      `<tr><td><input type="text" id="f-nb-name-${n.id}" data-path="@neighbourhoods.renames.${n.id}" data-str="1" placeholder="${esc(n.auto)}" value="${esc((N.renames || {})[n.id] || "")}" aria-label="Name for ${esc(n.auto)}"${dis}></td><td>${esc(types.find((t) => t.id === n.type)?.label || n.type)}</td><td>${esc((n.rings && n.rings.length ? n.rings : [n.ring]).map((r) => plan.scene.rings.find((g) => g.id === r)?.label || r).join(" · "))}</td><td>${n.cells}</td></tr>`).join("")}</tbody></table></fieldset>`;
    return h;
  }
  function drawPanel() {
    $("panel").innerHTML = (selected === CITY ? cityPanel() : selected === NBTAB ? nbPanel() : districtPanel(owner())) +
      `<p class="panel-foot">Changes save to the shared plan. Ask Claude to rebuild the Blender scene and it builds exactly what this plan shows.</p>`;
  }
  function refreshPanelReadouts() {
    const panel = $("panel"), stats = panel.querySelector(".readout") || panel.querySelector(".stats"), warns = panel.querySelector(".warns");
    if (!stats || !warns) return;
    stats.outerHTML = statsHTML(); warns.outerHTML = warnsHTML();
  }
  function drawSpokeChooser() {
    if (!gen.spokes.some((s) => s.k === secSpoke)) secSpoke = gen.spokes[0]?.k ?? 0;
    const sel = $("secSpoke"), opts = gen.spokes.map((s) => `<option value="${s.k}"${s.k === secSpoke ? " selected" : ""}>${s.hero ? "Hero avenue" : `Spoke ${s.k + 1}`} (${fmt(((s.a * 180 / Math.PI) % 360 + 360) % 360)}°)</option>`).join("");
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
  }

  // ---------------------------------------------------------------- render cycle
  let frame = 0, panelDirty = false;
  function render(rebuildPanel) {
    panelDirty = panelDirty || rebuildPanel;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try { gen = CityGen.generate(plan); }
      catch (e) { setStatus("error", "This plan can't be drawn. Check the last value you changed"); console.error(e); return; }
      readColors(); setHeightScale(); buildGrid(); drawPlan(); drawSpokeChooser(); drawSection();
      if (panelDirty) { drawTabs(); drawPanel(); panelDirty = false; } else refreshPanelReadouts();
    });
  }
  function showPlan() { $("empty").hidden = true; drawLegend(); setView("city"); render(true); }
  function showEmpty(title, body) { $("empty").hidden = false; $("empty").innerHTML = `<div><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`; }

  // ---------------------------------------------------------------- editing + saving
  // Saves merge only what this page changed (whole districts or whole top-level sections) onto a
  // fresh read of the shared copy, so two people editing different parts never erase each other.
  function merged(base) {
    const out = clone(base || plan);
    for (const key of dirty) {
      if (key.startsWith("@")) out[key.slice(1)] = clone(plan[key.slice(1)]);
      else {
        const id = key.slice(2), local = plan.districts.find((d) => d.id === id), k = out.districts.findIndex((d) => d.id === id);
        if (local && k >= 0) out.districts[k] = clone(local); else if (local) out.districts.push(clone(local));
      }
    }
    return out;
  }
  function edited(key, rebuildPanel) {
    editSeq++; dirty.add(key);
    setStatus("dirty", "Unsaved changes");
    render(rebuildPanel);
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 800);
  }
  async function save(retried) {
    if (!ref || readOnly) return;
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); return; }
    saving = true;
    const seq = editSeq, keys = [...dirty];
    setStatus("saving", "Saving");
    try {
      const latest = await ref.get();
      if (latest.exists) remote = clone(latest.data());
      const body = merged(remote);
      await ref.set(body);
      remote = body;
      if (editSeq === seq) { dirty.clear(); adopt(body); setStatus("saved", "Saved"); }
      else { keys.forEach((k) => dirty.add(k)); setStatus("dirty", "Unsaved changes"); }
    } catch (e) {
      if (e && e.code === "invalid_argument") { readOnly = true; dirty.clear(); setStatus("idle", "View only"); render(true); if (remote) adopt(remote); }
      else if (e && e.code === "unavailable" && !retried) { saving = false; setTimeout(() => save(true), 600 + Math.random() * 900); return; }
      else setStatus("error", "Couldn't save. Edits stay on this page; change a value to retry");
    } finally { saving = false; }
  }
  let formStale = false;
  function adopt(body) {
    if (plan && JSON.stringify(body) === JSON.stringify(plan)) return;
    const first = !plan;
    plan = clone(body);
    if (selected !== CITY && selected !== NBTAB && !plan.districts.some((d) => d.id === selected)) selected = CITY;
    if (first) { showPlan(); return; }
    const typing = $("panel").contains(document.activeElement) && document.activeElement !== document.body;
    if (typing) { formStale = true; render(false); } else render(true);
  }
  $("panel").addEventListener("focusout", () => {
    requestAnimationFrame(() => { if (formStale && !$("panel").contains(document.activeElement)) { formStale = false; render(true); } });
  });
  $("panel").addEventListener("input", (e) => {
    const el = e.target, path = el.dataset && el.dataset.path; if (!path || readOnly || !plan) return;
    let v;
    if (el.dataset.list) v = el.value.split(",").map((x) => x.trim()).filter(Boolean);
    else if (el.dataset.str) v = el.value;
    else if (el.dataset.bool) v = el.value === "true";
    else if (el.dataset.blank && String(el.value).trim() === "") { v = undefined; el.setAttribute("aria-invalid", "false"); }
    else {
      v = parseFloat(el.value);
      const bad = !Number.isFinite(v) || (el.min !== "" && v < +el.min) || (el.max !== "" && v > +el.max);
      el.setAttribute("aria-invalid", String(bad));
      if (bad) return;            // out-of-range values never reach the plan
      if (el.dataset.int) v = Math.round(v);
      if (el.dataset.scale) v = v / +el.dataset.scale;
    }
    setPath(path, v);
    edited(path.startsWith("@") ? "@" + path.slice(1).split(".")[0] : `d:${selected}`, false);
  });
  $("panel").addEventListener("change", (e) => { if (e.target.tagName === "SELECT") render(true); });
  $("tabs").addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (!t) return; selected = t.dataset.tab; render(true); });
  $("tabs").addEventListener("keydown", (e) => {
    if (!plan || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const ids = TABS().map((t) => t.id), k = ids.indexOf(selected);
    selected = ids[(k + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    render(true); requestAnimationFrame(() => requestAnimationFrame(() => $(`tab-${selected}`)?.focus()));
  });
  $("secSpoke").addEventListener("change", (e) => { secSpoke = Number(e.target.value); if (plan) drawSection(); });

  // ---------------------------------------------------------------- plan interaction
  function toPlan(ev) {
    const r = cv.getBoundingClientRect();
    return [view.x + (ev.clientX - r.left - OX) / S, -(view.y + (ev.clientY - r.top - OY) / S)];
  }
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [px, py] = toPlan(e), vy = -py, nw = Math.min(8000, Math.max(120, view.w * Math.exp(e.deltaY * 0.0015))), f = nw / view.w;
    view.x = px - (px - view.x) * f; view.y = vy - (vy - view.y) * f; view.w = nw; view.h *= f;
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    drawPlan();
  }, { passive: false });
  let drag = null;
  cv.addEventListener("pointerdown", (e) => { const [px, py] = toPlan(e); drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, hit: lotAt(px, py), id: e.pointerId }; });
  cv.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; cv.classList.add("dragging"); $("tip").hidden = true; try { cv.setPointerCapture(drag.id); } catch (_) {} }
      if (drag.moved) { view.x = drag.vx - dx / S; view.y = drag.vy - dy / S; drawPlan(); }
      return;
    }
    showTip(e);
  });
  cv.addEventListener("pointerup", () => {
    const d = drag; drag = null; cv.classList.remove("dragging");
    if (d && !d.moved && d.hit != null && gen && gen.lots[d.hit]) { selected = gen.lots[d.hit].d; render(true); }
  });
  cv.addEventListener("pointercancel", () => { drag = null; cv.classList.remove("dragging"); });
  cv.addEventListener("pointerleave", () => { $("tip").hidden = true; });
  function showTip(e) {
    const tip = $("tip");
    if (!gen) { tip.hidden = true; return; }
    const [px, py] = toPlan(e), i = lotAt(px, py), l = i == null ? null : gen.lots[i];
    if (!l) { tip.hidden = true; return; }
    const d = plan.districts.find((x) => x.id === l.d);
    // a college building names its form; a dye garden is open ground, so it has no storeys
    const storeys = l.storeys > 0 ? ` · ${l.storeys} storeys` : "";
    const what = l.kind === "landmark" ? `${l.label || "landmark"}${storeys}`
      : l.height != null ? `${l.kind === "plaza" ? "low block" : "tower"} ${fmt(l.height)} m${l.capped ? " (capped)" : ""}`
      : l.college && l.form ? `${l.form === "dye_garden" ? l.label || FORM_LABEL.dye_garden : FORM_LABEL[l.form] || l.label || "College"}${storeys}`
      : `${USE_LABEL[l.use] || l.label || "lot"}${storeys}`;
    const nbn = l.nb ? (gen.neighbourhoods || []).find((n) => n.id === l.nb) : null;
    // Old Town lots name their culture quarter (or a grid tower's form); landmarks their own culture
    const cult = l.culture ? cultureLabel(l.culture) + " · " : l.form && !l.college ? cultureLabel(l.form) + " form · " : "";
    tip.textContent = `${nbn ? nbn.name + " · " : ""}${d ? d.name : l.d} · ${l.kind === "landmark" ? "" : cult}${what} · floor +${fmt(l.base, 1)} m · roof +${fmt(l.top)} m${l.plinth > 0.1 ? ` · ${fmt(l.plinth, 1)} m plinth` : ""}`;
    const r = $("planWrap").getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.max(0, Math.min(e.clientX - r.left, r.width - tip.offsetWidth - 24))}px`;
    tip.style.top = `${Math.min(e.clientY - r.top, r.height - tip.offsetHeight - 24)}px`;
  }
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  for (const id of ["lyr-trees", "lyr-cam", "lyr-labels", "lyr-cloud", "lyr-sky"]) $(id).addEventListener("change", drawPlan);
  new ResizeObserver(() => drawPlan()).observe($("planWrap"));
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", drawPlan);
  new MutationObserver(drawPlan).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  $("copy").addEventListener("click", () => {
    if (!plan) return;
    const text = JSON.stringify(plan, null, 2), btn = $("copy");
    const done = (ok) => { btn.textContent = ok ? "Copied" : "Select and copy below"; setTimeout(() => { btn.textContent = "Copy plan JSON"; }, 1800); };
    const fallback = () => {
      let ta = $("jsonFallback");
      if (!ta) { ta = document.createElement("textarea"); ta.id = "jsonFallback"; ta.readOnly = true; ta.style.cssText = "width:100%;height:200px;margin-top:8px;font:12px var(--font-data)"; $("panel").append(ta); }
      ta.value = text; ta.focus(); ta.select(); done(false);
    };
    try { navigator.clipboard.writeText(text).then(() => done(true), fallback); } catch (_) { fallback(); }
  });

  // ---------------------------------------------------------------- connect to the shared plan
  (async () => {
    const claude = window.claude;
    if (!claude || !claude.use) { setStatus("offline", "Offline"); showEmpty("The shared plan isn't available here", "Open this page in Claude to load and edit the plan."); return; }
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    if (!db) { setStatus("offline", "Offline"); showEmpty("The shared plan isn't available here", "Sign in to Claude to load and edit the plan."); return; }
    if (user) { try { if ((await user.can("data.write")) === false) readOnly = true; } catch (_) {} }
    ref = db.doc("plan/current");
    setStatus(readOnly ? "idle" : "saved", readOnly ? "View only" : "Live");
    ref.onSnapshot((snap) => {
      if (!snap.exists) { if (!plan) showEmpty("No plan yet", "Ask Claude to seed the city plan from the Blender scene."); return; }
      if (snap.metadata.hasPendingWrites) return;
      remote = clone(snap.data());
      adopt(dirty.size ? merged(remote) : remote);
    }, () => { setStatus("error", "Lost the live connection. Reload to reconnect"); });
  })();
})();
