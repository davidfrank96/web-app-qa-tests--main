import assert from "node:assert/strict";

// Product owner confirmed generic message copy on 2026-10-03. Location belongs
// in the subject and route; message wording is not a contractual invariant.
export function expectInssaLocationDefaults(values: {subject: string; message: string}, subject: string) {
  assert.equal(values.subject, subject, "Subject must identify the selected location");
  assert.ok(values.subject.length <= 140, "Subject exceeds 140 characters");
  assert.ok(values.message.trim().length > 0, "Compose must seed a non-empty message");
  assert.ok(values.message.length <= 3000, "Message exceeds 3000 characters");
}
