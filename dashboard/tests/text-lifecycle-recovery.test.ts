import assert from "node:assert/strict";
import test from "node:test";
import { extractInssaLifecycleIdentifiers } from "../../utils/inssa-lifecycle-network";
import {
  assertInssaContactSelectionTransition,
  assertInssaCleanupOwnership,
  classifyInssaCleanupIdentity
} from "../../utils/inssa-text-lifecycle-state";

test("contact selection requires the approved 0-to-1 transition", () => {
  assert.doesNotThrow(() =>
    assertInssaContactSelectionTransition({ afterCount: 1, beforeCount: 0, targetIdentityVerified: true })
  );
  assert.throws(
    () => assertInssaContactSelectionTransition({ afterCount: 0, beforeCount: 0, targetIdentityVerified: true }),
    /exactly 1 selected/
  );
  assert.throws(
    () => assertInssaContactSelectionTransition({ afterCount: 1, beforeCount: 0, targetIdentityVerified: false }),
    /approved secondary QA identity/
  );
});

test("cleanup identity fails closed after persistence without an object id", () => {
  assert.equal(
    classifyInssaCleanupIdentity({ capsuleId: null, finalShareActionClicked: true, persistenceSucceeded: true }),
    "failed_cleanup_identity"
  );
  assert.equal(
    classifyInssaCleanupIdentity({ capsuleId: "Zd7QsNEJGbMXOSvAn3qc", finalShareActionClicked: true, persistenceSucceeded: true }),
    "captured"
  );
});

test("cleanup ownership requires id, type, owner, state, and instructions", () => {
  assert.doesNotThrow(() =>
    assertInssaCleanupOwnership({
      capsuleId: "Zd7QsNEJGbMXOSvAn3qc",
      cleanupInstruction: "Delete the exact QA staging capsule.",
      objectType: "timeCapsule",
      owner: "p***@example.test",
      resultingState: "shared-contact-finalized"
    })
  );
  assert.throws(
    () =>
      assertInssaCleanupOwnership({
        capsuleId: null,
        cleanupInstruction: "Delete the exact QA staging capsule.",
        objectType: "timeCapsule",
        owner: "p***@example.test",
        resultingState: "shared-contact-finalized"
      }),
    /failed_cleanup_identity/
  );
});

test("Firestore WebChannel form payload exposes the exact time capsule id", () => {
  const encoded =
    "count=1&req0___data__=%7B%22writes%22%3A%5B%7B%22update%22%3A%7B%22name%22%3A%22projects%2Finssa%2Fdatabases%2F(default)%2Fdocuments%2FtimeCapsules%2FZd7QsNEJGbMXOSvAn3qc%22%7D%7D%5D%7D";
  const identifiers = extractInssaLifecycleIdentifiers(encoded);
  assert.deepEqual(identifiers.capsuleIds, ["Zd7QsNEJGbMXOSvAn3qc"]);
  assert.ok(identifiers.documentIds.includes("Zd7QsNEJGbMXOSvAn3qc"));
});
