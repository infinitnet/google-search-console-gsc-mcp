import test from "node:test";
import assert from "node:assert/strict";
import { alertScan, expectedCtr } from "../seo.js";
import { resetClientsForTests, setClientsForTests } from "../auth.js";

test.afterEach(() => resetClientsForTests());

test("expectedCtr curve is monotonic enough for opportunity estimates", () => {
  assert.ok(expectedCtr(1) > expectedCtr(3));
  assert.ok(expectedCtr(3) > expectedCtr(10));
  assert.ok(expectedCtr(20) > 0);
});

test("alertScan uses relative CTR drop threshold, not percentage-point threshold", async () => {
  let call = 0;
  const mock = {
    searchanalytics: {
      query: async () => {
        call += 1;
        return call === 1
          ? { data: { rows: [{ keys: ["https://example.com/a"], clicks: 8, impressions: 200, ctr: 0.04, position: 4 }] } }
          : { data: { rows: [{ keys: ["https://example.com/a"], clicks: 10, impressions: 100, ctr: 0.10, position: 3 }] } };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });
  const result = await alertScan({ siteUrl: "sc-domain:example.com", days: 7, ctrDropPercent: 30, clickDropPercent: 90, positionDrop: 50 });
  assert.equal(result.counts.total, 1);
  assert.equal(result.alerts[0]!.type, "ctr_loss");
  assert.match(result.alerts[0]!.detail, /-60%/);
});
