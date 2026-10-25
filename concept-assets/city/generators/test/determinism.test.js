const test = require("node:test"), assert = require("node:assert/strict");
const { loadPlan, gen } = require("./helpers.js");

// the whole output (Old Town lots, objects and prims, lantern, quarters, squares, skywalks, warnings) repeats exactly
test("generation is deterministic", () => {
  const a = JSON.stringify(gen(loadPlan())), b = JSON.stringify(gen(loadPlan()));
  assert.ok(a.length > 1000);
  assert.ok(a === b, "two runs on fresh plan copies differ"); });
