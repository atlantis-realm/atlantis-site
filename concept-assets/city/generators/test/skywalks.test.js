const test = require("node:test"), assert = require("node:assert/strict");
const { loadPlan, gen, core, ringR } = require("./helpers.js");

const S = 239.5, eps = 0.01;
const p1 = loadPlan(), o1 = gen(p1);  // default plan: one ring avenue round Old Town
const isCore = (w) => w.ring === "core";
const isCoreLink = (w) => w.over === "spoke-link" && String(w.ring).split(">").includes("core");
const ptsOf = (w) => (w.kind === "arc" ? [[w.r - w.w / 2, w.a0], [w.r + w.w / 2, w.a1]].map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)]) : [w.a, w.b]);
// where a link point sits along its spoke (links run beside the road, a few metres off the spoke's axis)
const along = (w, p) => { const ax = w.b[0] - w.a[0], ay = w.b[1] - w.a[1], a = Math.atan2(ay, ax); return p[0] * Math.cos(a) + p[1] * Math.sin(a); };
const inPoly = (x, y, q) => { let inside = false;
  for (let a = 0, b = q.length - 1; a < q.length; b = a++) if ((q[a][1] > y) !== (q[b][1] > y) && x < (q[b][0] - q[a][0]) * (y - q[a][1]) / (q[b][1] - q[a][1]) + q[a][0]) inside = !inside;
  return inside; };
const overlaps = (arcs) => { const TAU = 2 * Math.PI, n = (a) => ((a % TAU) + TAU) % TAU;
  for (let i = 0; i < arcs.length; i++) for (let j = i + 1; j < arcs.length; j++) {
    const A = arcs[i], B = arcs[j], mA = n((A.a0 + A.a1) / 2), mB = n((B.a0 + B.a1) / 2);
    const d = Math.min(Math.abs(mA - mB), TAU - Math.abs(mA - mB));
    if (d < (A.a1 - A.a0) / 2 + (B.a1 - B.a0) / 2 - 1e-6) return [A, B];
  }
  return null; };

test("Old Town has one skywalk spine on the first ring avenue", () => {
  const arcs = o1.skywalks.filter((w) => isCore(w) && w.kind === "arc");
  assert.ok(arcs.length > 0, "no core arcs");
  for (const w of arcs) assert.ok(Math.abs(w.r - S) < eps, `core arc at r ${w.r}`);
  assert.equal(overlaps(arcs), null, "two core arcs overlap: the spine is built twice"); });
test("core spoke links start on the spine and run outward", () => {
  const links = o1.skywalks.filter(isCoreLink);
  assert.ok(links.length > 0, "no spoke links from Old Town");
  // each link is a run of segments beside one spoke: the run's innermost end lands on the spine
  const runs = new Map();
  for (const w of links) { const a = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]), off = w.a[1] * Math.cos(a) - w.a[0] * Math.sin(a), k = `${a.toFixed(3)}|${off.toFixed(1)}`;
    runs.set(k, Math.min(runs.get(k) ?? Infinity, ...[w.a, w.b].map((p) => along(w, p)))); }
  assert.ok(runs.size >= 6, `only ${runs.size} link runs`);
  for (const [k, t] of runs) assert.ok(Math.abs(t - S) < eps, `link run ${k} starts at ${t}, not on the spine`);
  for (const w of links) for (const p of [w.a, w.b]) assert.ok(along(w, p) >= S - eps, "link runs inside the spine"); });
test("no rungs or roof bridges in Old Town", () => {
  assert.equal(o1.skywalks.filter((w) => isCore(w) && ["rung", "roofs"].includes(w.over)).length, 0); });
test("no core skywalk reaches into the grid", () => {
  for (const w of o1.skywalks.filter((w) => isCore(w) || isCoreLink(w))) for (const p of ptsOf(w)) assert.ok(ringR(...p) >= 230, `skywalk point at r ${ringR(...p)}`); });
test("no skywalk tower stands on an Old Town lot", () => {
  const lots = o1.lots.filter((l) => l.d === "core");
  assert.ok(lots.length > 0 && o1.skyAccess.length > 0);
  for (const s of o1.skyAccess) for (const l of lots) assert.ok(!inPoly(s.x, s.y, l.poly), `${s.kind} at ${s.x},${s.y} inside ${l.key || l.kind}`); });
test("second avenue brings back two spines and rungs", () => {
  const p = loadPlan(); core(p).second_avenue = true;
  const o = gen(p), arcs = o.skywalks.filter((w) => isCore(w) && w.kind === "arc");
  const rs = [...new Set(arcs.map((w) => w.r.toFixed(2)))].map(Number).sort((a, b) => a - b);
  assert.ok(rs.some((r) => Math.abs(r - S) < eps), `radii ${rs}`);
  assert.ok(rs.some((r) => Math.abs(r - 342.5) < 0.6), `radii ${rs}`);
  for (const r of [S]) assert.equal(overlaps(arcs.filter((w) => Math.abs(w.r - r) < eps)), null);
  assert.ok(o.skywalks.some((w) => isCore(w) && w.over === "rung"), "no core rungs"); });
