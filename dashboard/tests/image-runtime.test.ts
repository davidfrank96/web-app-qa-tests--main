import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("patched native image runtime decodes ordinary PNG, WebP and AVIF evidence", async () => {
  const source = { create: { width: 2, height: 2, channels: 3 as const, background: "#2468ac" } };
  const fixtures = [
    await sharp(source).png().toBuffer(),
    await sharp(source).webp({ lossless: true }).toBuffer(),
    await sharp(source).avif({ lossless: true }).toBuffer()
  ];
  for (const fixture of fixtures) {
    const decoded = await sharp(fixture).png().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 2);
    assert.equal(decoded.info.height, 2);
    assert.equal(decoded.info.format, "png");
    assert.ok(decoded.data.byteLength > 0);
  }
});
