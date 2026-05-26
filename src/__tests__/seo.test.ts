import test from "node:test";
import assert from "node:assert/strict";
import { actionPlan, alertScan, expectedCtr, queryPageOverlap } from "../seo.js";
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

test("queryPageOverlap ranks two-page cannibalization by balanced query and impression overlap", async () => {
  const mock = {
    searchanalytics: {
      query: async () => ({
        data: {
          rows: [
            { keys: ["shared-a", "https://example.com/a"], clicks: 40, impressions: 400, ctr: 0.1, position: 1 },
            { keys: ["shared-a", "https://example.com/b"], clicks: 38, impressions: 400, ctr: 0.095, position: 2 },
            { keys: ["shared-b", "https://example.com/a"], clicks: 30, impressions: 300, ctr: 0.1, position: 1.5 },
            { keys: ["shared-b", "https://example.com/b"], clicks: 28, impressions: 300, ctr: 0.093, position: 2.5 },
            { keys: ["only-a", "https://example.com/a"], clicks: 8, impressions: 100, ctr: 0.08, position: 3 },
            { keys: ["only-b", "https://example.com/b"], clicks: 7, impressions: 100, ctr: 0.07, position: 3 },
            { keys: ["lopsided", "https://example.com/a"], clicks: 10, impressions: 100, ctr: 0.1, position: 1 },
            { keys: ["lopsided", "https://example.com/c"], clicks: 0, impressions: 2, ctr: 0, position: 80 }
          ]
        }
      })
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await queryPageOverlap({ siteUrl: "sc-domain:example.com", days: 28, minImpressions: 1, limit: 10 });

  assert.equal(result.summary.pagePairCount, 2);
  assert.equal(result.summary.queryGroupCount, 3);

  const severe = result.pagePairs[0]!;
  assert.deepEqual(severe.pages, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(severe.overlappingQueries.count, 2);
  assert.equal(severe.overlappingQueries.percentOfSmallerPage, 66.67);
  assert.equal(severe.overlappingImpressions.balanced, 1400);
  assert.equal(severe.overlappingImpressions.percentOfPair, 82.35);
  assert.equal(severe.severity, "high");

  const lopsided = result.pagePairs.find((pair) => pair.pages.includes("https://example.com/c"));
  assert.ok(lopsided);
  assert.equal(lopsided.overlappingQueries.count, 1);
  assert.equal(lopsided.overlappingImpressions.balanced, 4);
  assert.equal(lopsided.overlappingImpressions.percentOfPair, 0.44);
  assert.equal(lopsided.severity, "negligible");

  assert.equal(result.queries[0]!.query, "shared-a");
  assert.equal(result.queries[0]!.pages.length, 2);
});

test("actionPlan uses page-pair overlap output for cannibalization recommendations", async () => {
  const mock = {
    searchanalytics: {
      query: async ({ requestBody }: any) => {
        if (requestBody.dimensions.join(",") !== "query,page") return { data: { rows: [] } };
        return {
          data: {
            rows: [
              { keys: ["shared-a", "https://example.com/a"], clicks: 40, impressions: 400, ctr: 0.1, position: 1 },
              { keys: ["shared-a", "https://example.com/b"], clicks: 38, impressions: 400, ctr: 0.095, position: 2 },
              { keys: ["shared-b", "https://example.com/a"], clicks: 30, impressions: 300, ctr: 0.1, position: 1.5 },
              { keys: ["shared-b", "https://example.com/b"], clicks: 28, impressions: 300, ctr: 0.093, position: 2.5 },
              { keys: ["only-a", "https://example.com/a"], clicks: 8, impressions: 100, ctr: 0.08, position: 3 },
              { keys: ["only-b", "https://example.com/b"], clicks: 7, impressions: 100, ctr: 0.07, position: 3 }
            ]
          }
        };
      }
    }
  } as any;
  setClientsForTests({ searchConsole: mock });

  const result = await actionPlan({ siteUrl: "sc-domain:example.com", days: 28, limit: 5 });

  const recommendation = result.recommendations.find((item) => item.action === "resolve_query_overlap") as any;
  assert.ok(recommendation);
  assert.equal(recommendation.target, "https://example.com/a");
  assert.equal(recommendation.secondaryTarget, "https://example.com/b");
  assert.match(recommendation.reason, /2 shared queries/);
  assert.match(recommendation.reason, /87.5% balanced impression overlap/);
});
