import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";

// Local-only contract checks. No authentication, staging requests, or product writes.
const notice = `<div role="status">Heads up about this browser session<button onclick="this.parentElement.remove()">Got it</button></div>`;
const form = `<main><h1>Step 1: Compose</h1><input type="text" aria-label="Search" value="decoy">
<label>Subject*<input type="text" value="New York, NY"></label><span>12/140</span>
<label>Your Message*<textarea>Found this spot and thought of you.</textarea></label><span>35/3000</span>
<button disabled>Discard draft</button><button>Save &amp; exit</button></main>`;

async function main() {
  const browser = await chromium.launch();
  try {
    for (const scenario of ["early notice", "late notice", "readonly", "missing form"] as const) {
      const page = await browser.newPage();
      let html = scenario === "missing form" ? `<main>Loading…</main>` : form;
      if (scenario === "early notice") html = notice + html;
      if (scenario === "readonly") html = html.replace('value="New York, NY"', 'readonly value="New York, NY"');
      if (scenario === "late notice") html = `<main>Loading…</main><script>window.showCompose = () => document.body.innerHTML = ${JSON.stringify(notice + form)}</script>`;
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("http://127.0.0.1/timecapsule");
      const compose = new TimeCapsulePage(page);
      const started = Date.now();
      let hydration: Promise<void> | undefined;
      if (scenario === "late notice") {
        const subjectField = compose.subjectField.bind(compose);
        compose.subjectField = () => {
          // The initial notice check has finished; release hydration when the
          // form assertion starts. No sleep or network is involved.
          hydration ??= page.evaluate(() => (window as unknown as { showCompose(): void }).showCompose());
          return subjectField();
        };
      }
      const readiness = compose.expectComposeSurface();
      if (scenario === "readonly" || scenario === "missing form") {
        await assert.rejects(readiness, scenario === "readonly" ? /Received: readOnly/ : /Subject/);
        assert.ok(Date.now() - started < 20_000, "unusable compose still fails within the existing readiness budget");
      } else {
        await readiness;
        await hydration;
        assert.equal(await compose.subjectField().inputValue(), "New York, NY", "ignore unrelated text inputs");
        assert.equal(await page.getByRole("status").count(), 0, "dismiss known notice before interactions");
        await compose.expectRequiredFieldMetadata();
      }
      console.log(`PASS ${scenario}: ${Date.now() - started}ms`);
      await page.close();
    }
    // Controlled hydration models a shell that precedes the real controls.
    // This delay exists only in the offline fixture, never in the live test.
    const page = await browser.newPage();
    const readonlyMessage = form.replace("<textarea>", "<textarea readonly>");
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body:
      `<main>Loading…</main>${notice}<script>setTimeout(() => document.body.innerHTML = ${JSON.stringify(readonlyMessage)}, 500)</script>` }));
    await page.goto("http://127.0.0.1/timecapsule");
    const bounded = new TimeCapsulePage(page);
    const started = Date.now();
    await assert.rejects(bounded.expectComposeSurface({ readinessTimeoutMs: 3000 }), (error: unknown) => {
      assert.match(String(error), /readOnly|readiness exceeded/);
      const result = (error as { matcherResult?: { timeout?: number } }).matcherResult;
      if (result?.timeout !== undefined) assert.ok(result.timeout > 0 && result.timeout < 2700,
        "the second field receives only the remaining budget, not a new 3000ms timeout");
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 2800 && elapsed < 6000, `one shared deadline, not 3000ms per control: ${elapsed}ms`);
    console.log(`PASS shared readiness deadline after delayed hydration: ${elapsed}ms`);
    await assert.rejects(bounded.expectComposeSurface({ readinessTimeoutMs: 0 }), /positive finite/);
    await assert.rejects(bounded.expectComposeSurface({ readinessTimeoutMs: Infinity }), /positive finite/);
    await page.close();

    const delayedNotice = await browser.newPage();
    await delayedNotice.route("**/*", route => route.fulfill({ contentType: "text/html", body:
      notice.replace("<button ", "<button disabled ") + form +
      `<script>setTimeout(() => document.querySelector('[role=status] button').disabled = false, 800)</script>` }));
    await delayedNotice.goto("http://127.0.0.1/timecapsule");
    await new TimeCapsulePage(delayedNotice).expectComposeSurface({ readinessTimeoutMs: 3000 });
    assert.equal(await delayedNotice.getByRole("status").count(), 0);
    console.log("PASS delayed notice actionability uses the shared readiness deadline");
    await delayedNotice.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
