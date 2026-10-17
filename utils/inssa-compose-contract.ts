import assert from "node:assert/strict";

// Product owner confirmed generic message copy on 2026-10-03. Location belongs
// in the subject and route; message wording is not a contractual invariant.
export function expectInssaLocationDefaults(values: {subject: string; message: string}, subject: string) {
  assert.equal(values.subject, subject, "Subject must identify the selected location");
  assert.ok(values.subject.length <= 140, "Subject exceeds 140 characters");
  assert.ok(values.message.trim().length > 0, "Compose must seed a non-empty message");
  assert.ok(values.message.length <= 3000, "Message exceeds 3000 characters");
}

// Hosted 704aebc3: first recorded form snapshots were 27.1s / 31.8s after
// navigation. The surface check starts after navigation; cap the WHOLE check
// at 30s. Performance monitoring still flags >5s slow and >10s unstable.
export const INSSA_SAFE_COMPOSE_READINESS_MS = 30_000;
// Matches the existing Safe media audit: navigation (20s), readiness (30s),
// then metadata/error assertions and fixture overhead need a separate budget.
export const INSSA_SAFE_COMPOSE_TEST_MS = 90_000;
