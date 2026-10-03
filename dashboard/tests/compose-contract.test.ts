import test from "node:test";
import assert from "node:assert/strict";
import { expectInssaLocationDefaults } from "../../utils/inssa-compose-contract";
import { INSSA_US_MARKET_LOCATIONS } from "../../utils/inssa-test-data";

test("all location subjects accept valid generic messages without pinning marketing copy", () => {
  for (const location of INSSA_US_MARKET_LOCATIONS) {
    for (const message of ["Found this spot and thought of you.", "A place worth remembering."]) {
      expectInssaLocationDefaults({ subject: location.place!, message }, location.place!);
    }
  }
});
test("wrong location, empty message and excessive lengths fail", () => {
  for (const value of [{subject:"wrong",message:"valid"},{subject:"New York, NY",message:"  "},{subject:"New York, NY",message:"x".repeat(3001)}]) {
    assert.throws(() => expectInssaLocationDefaults(value, "New York, NY"));
  }
  assert.throws(() => expectInssaLocationDefaults({subject:"x".repeat(141),message:"valid"},"x".repeat(141)));
});
