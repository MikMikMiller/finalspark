import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSteppedNumberParam } from "../src/url-state.js";

describe("URL state parsing", () => {
  it("keeps numeric fallback when a query parameter is absent", () => {
    const params = new URLSearchParams("");

    assert.equal(
      parseSteppedNumberParam(params, "threshold", {
        fallback: 50,
        min: 10,
        max: 500,
        step: 5,
      }),
      50,
    );
  });

  it("rounds and clamps present stepped number parameters", () => {
    const params = new URLSearchParams("threshold=503");

    assert.equal(
      parseSteppedNumberParam(params, "threshold", {
        fallback: 50,
        min: 10,
        max: 500,
        step: 5,
      }),
      500,
    );
  });

  it("keeps fallback for blank or invalid values", () => {
    assert.equal(
      parseSteppedNumberParam(new URLSearchParams("threshold="), "threshold", {
        fallback: 50,
        min: 10,
        max: 500,
        step: 5,
      }),
      50,
    );
    assert.equal(
      parseSteppedNumberParam(new URLSearchParams("threshold=oops"), "threshold", {
        fallback: 50,
        min: 10,
        max: 500,
        step: 5,
      }),
      50,
    );
  });
});
