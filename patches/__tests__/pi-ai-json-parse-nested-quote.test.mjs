// Regression test for patches/@earendil-works+pi-ai+0.78.1.patch.
//
// Run directly with Node (no test framework dependency, since this validates a
// vendored dist file under node_modules rather than first-party workspace code):
//
//   node patches/__tests__/pi-ai-json-parse-nested-quote.test.mjs
//
// Exits non-zero on any assertion failure so it can be wired into CI if desired.
//
// Background: pi-ai's parseStreamingJson() is used to parse tool_call arguments
// both incrementally (on every streamed delta) and once more on the fully
// accumulated string once the tool call is complete. Before this patch, a single
// unescaped `"` anywhere inside a string value (e.g. an unescaped quote embedded
// in model-generated markdown/code, as MiniMax-family models have been observed
// to emit) caused repairJson()+JSON.parse() to fail, silently falling through to
// the lenient `partial-json` package's incomplete-JSON recovery path. That path
// truncates the string at the first unescaped quote AND drops every sibling key
// that appears later in the object -- even though the JSON was fully received,
// not actually incomplete. See patches/README.md for the full writeup.

import assert from "node:assert/strict";
import { parseStreamingJson } from "../../node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js";

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(error);
  }
}

// --- Case 1: the reported production shape -- a nested implementation_plan
// object containing an unescaped quote deep inside an array-of-objects field,
// followed by a sibling subtask_blueprint array. Both must survive intact. ---
test("nested object with a deeply-embedded unescaped quote is fully preserved, sibling array survives", () => {
  const raw =
    "{" +
    '"architect_summary":"Refine.",' +
    '"implementation_plan":{' +
    '"milestones":[' +
    '{"name":"M1","code_fence":"const s = "value"; done"},' +
    '{"name":"M2","code_fence":"no quotes here"}' +
    "]" +
    "}," +
    '"subtask_blueprint":[{"subtask_id":"st-1"},{"subtask_id":"st-2"}]' +
    "}";

  const result = parseStreamingJson(raw);

  assert.equal(result.architect_summary, "Refine.");
  assert.ok(
    result.implementation_plan,
    "implementation_plan must not be dropped",
  );
  assert.equal(typeof result.implementation_plan, "object");
  assert.equal(result.implementation_plan.milestones.length, 2);
  assert.equal(
    result.implementation_plan.milestones[0].code_fence,
    'const s = "value"; done',
  );
  assert.equal(
    result.implementation_plan.milestones[1].code_fence,
    "no quotes here",
  );
  assert.deepEqual(result.subtask_blueprint, [
    { subtask_id: "st-1" },
    { subtask_id: "st-2" },
  ]);
});

// --- Case 2: flat string field with one embedded unescaped quote pair,
// followed by a sibling array field. ---
test("flat string field with an embedded unescaped quote pair preserves the field and its siblings", () => {
  const raw =
    '{"a":"x","implementation_plan":"start "inner" end","subtask_blueprint":[{"id":1}]}';

  const result = parseStreamingJson(raw);

  assert.equal(result.a, "x");
  assert.equal(result.implementation_plan, 'start "inner" end');
  assert.deepEqual(result.subtask_blueprint, [{ id: 1 }]);
});

// --- Case 3: well-formed JSON (properly escaped quotes) must still parse via
// the strict/fast path, unaffected by the patch. ---
test("well-formed JSON with properly escaped quotes parses unchanged", () => {
  const raw = JSON.stringify({
    architect_summary: "Refine the work item.",
    implementation_plan: {
      milestones: [{ name: "M1", note: 'uses "quotes" correctly' }],
    },
    subtask_blueprint: [{ subtask_id: "st-1" }],
  });

  const result = parseStreamingJson(raw);

  assert.deepEqual(result, JSON.parse(raw));
});

// --- Case 4: totally unparseable input must still safely degrade to {} rather
// than throwing. ---
test("garbage input still degrades to an empty object", () => {
  assert.deepEqual(parseStreamingJson('not json at all {{{ ]] "" :::'), {});
  assert.deepEqual(parseStreamingJson(""), {});
  assert.deepEqual(parseStreamingJson("   "), {});
});

// --- Case 5: regression guard -- genuinely incomplete (mid-stream) JSON at
// various cut points must still return the same partial results as before the
// patch. This is the behavior parseStreamingJson exists to provide and must not
// regress. ---
test("genuinely incomplete streaming JSON still returns expected partial results", () => {
  const full =
    '{"architect_summary":"Refine the item and produce output.","sdd_targets":["a","b"],' +
    '"implementation_plan":"Step 1: do the thing.\\nStep 2: verify it works."}';

  const expectedByCut = {
    1: {},
    5: {},
    20: {},
    40: { architect_summary: "Refine the item an" },
    60: { architect_summary: "Refine the item and produce output." },
    80: {
      architect_summary: "Refine the item and produce output.",
      sdd_targets: ["a", "b"],
    },
    100: {
      architect_summary: "Refine the item and produce output.",
      sdd_targets: ["a", "b"],
    },
    120: {
      architect_summary: "Refine the item and produce output.",
      sdd_targets: ["a", "b"],
      implementation_plan: "Step 1: do the",
    },
    140: {
      architect_summary: "Refine the item and produce output.",
      sdd_targets: ["a", "b"],
      implementation_plan: "Step 1: do the thing.\nStep 2: ver",
    },
  };

  for (const [cut, expected] of Object.entries(expectedByCut)) {
    const result = parseStreamingJson(full.slice(0, Number(cut)));
    assert.deepEqual(result, expected, `mismatch at cut=${cut}`);
  }

  // Fully accumulated string parses exactly like plain JSON.parse.
  assert.deepEqual(parseStreamingJson(full), JSON.parse(full));
});

// --- Case 6: realistic streaming scenario -- a payload with an embedded
// stray quote (same shape as Case 2), chunked at many cut points that land
// inside/around the stray quotes themselves, not just before/after the whole
// field. Production calls parseStreamingJson on every accumulated delta while
// a tool call is still streaming, so the stray-quote field is very often
// mid-flight exactly when a stray quote has just been emitted. This must
// never throw, and the fully accumulated string must still recover correctly
// (same assertion style as Case 2). Intermediate partial values are best-effort
// by design and are not pinned to exact expected values here. ---
test("streaming chunks cutting inside/around an embedded stray quote never throw and the final call still recovers the field", () => {
  const raw =
    '{"a":"x","implementation_plan":"start "inner" end","subtask_blueprint":[{"id":1}]}';

  // Bounds of the stray-quote field's string content, including its two
  // embedded (stray) quotes around "inner".
  const fieldStart = raw.indexOf('"start '); // opening quote of the field value
  const firstStrayQuote = raw.indexOf('"inner'); // stray quote before "inner"
  const secondStrayQuote = raw.indexOf('" end'); // stray quote after "inner"
  const fieldEnd = raw.indexOf('end"') + 4; // just past the real terminator quote

  assert.ok(
    fieldStart >= 0 && firstStrayQuote > fieldStart,
    "test fixture indices must be found",
  );
  assert.ok(
    secondStrayQuote > firstStrayQuote && fieldEnd > secondStrayQuote,
    "test fixture indices must be ordered",
  );

  const cutPoints = new Set([
    firstStrayQuote,
    firstStrayQuote + 1,
    secondStrayQuote,
    secondStrayQuote + 1,
  ]);
  for (let i = fieldStart; i <= fieldEnd; i += 1) {
    cutPoints.add(i);
  }

  for (const cut of [...cutPoints].sort((x, y) => x - y)) {
    const partial = raw.slice(0, cut);
    let result;
    try {
      result = parseStreamingJson(partial);
    } catch (error) {
      assert.fail(
        `parseStreamingJson threw at cut=${cut} (partial=${JSON.stringify(partial)}): ${error.message}`,
      );
    }
    assert.equal(
      typeof result,
      "object",
      `parseStreamingJson must return an object at cut=${cut}`,
    );
    assert.notEqual(
      result,
      null,
      `parseStreamingJson must not return null at cut=${cut}`,
    );
  }

  // The fully accumulated string -- as delivered once the tool call finishes
  // streaming -- must still recover the stray-quote field and its siblings.
  const result = parseStreamingJson(raw);
  assert.equal(result.a, "x");
  assert.equal(result.implementation_plan, 'start "inner" end');
  assert.deepEqual(result.subtask_blueprint, [{ id: 1 }]);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll pi-ai json-parse nested-quote regression tests passed.");
}
