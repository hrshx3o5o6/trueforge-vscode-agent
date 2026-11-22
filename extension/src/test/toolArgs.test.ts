import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolArgs } from "../toolArgs.js";

test("propose_edit content is replaced by a line count", () => {
  const out = summarizeToolArgs({ path: "src/flask/helpers.py", new_content: "a\nb\nc" });
  assert.deepEqual(out, { path: "src/flask/helpers.py", new_content: "<3 lines>" });
});

test("long strings are cut with an ellipsis", () => {
  const out = summarizeToolArgs({ query: "x".repeat(500) });
  assert.equal(String(out.query).length, 121);
  assert.ok(String(out.query).endsWith("…"));
});

test("short strings and non-strings pass through", () => {
  const out = summarizeToolArgs({ path: "a.py", start: 10, end: 20, flags: ["i"] });
  assert.deepEqual(out, { path: "a.py", start: 10, end: 20, flags: ["i"] });
});
