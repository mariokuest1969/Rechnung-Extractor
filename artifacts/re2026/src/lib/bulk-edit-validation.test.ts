import test from "node:test";
import assert from "node:assert/strict";
import { validateBulkTaxRate, describeBulkEditError, TAX_NUMBER_ERROR, TAX_RANGE_ERROR, TAX_PRECISION_ERROR } from "./bulk-edit-validation";

test("valid custom rates, comma decimals, boundaries and blank unchanged values", () => {
  for (const [input, value] of [["19", 19], [" 7,5 ", 7.5], ["12.34", 12.34], ["0", 0], ["100", 100], [".5", 0.5], ["7.500", 7.5]] as const) {
    assert.deepEqual(validateBulkTaxRate(input), { value });
  }
  assert.deepEqual(validateBulkTaxRate("  "), {});
});

test("rejects the entire malformed input instead of accepting numeric prefixes", () => {
  for (const input of ["19abc", "19%", "19,2,3", "NaN", "Infinity", "1e1", "0x10", "1 9", "19.", ","]) {
    assert.equal(validateBulkTaxRate(input).error, TAX_NUMBER_ERROR, input);
  }
  for (const input of ["-1", "100,01"]) assert.equal(validateBulkTaxRate(input).error, TAX_RANGE_ERROR);
  for (const input of ["7,555", "0.0000001"]) assert.equal(validateBulkTaxRate(input).error, TAX_PRECISION_ERROR);
});

test("API Zod validation is translated and tax errors are assigned to the input", () => {
  const result = describeBulkEditError({ status: 400, data: { error: JSON.stringify([
    { path: ["steuersatz"], code: "too_big", message: "Number must be less than or equal to 100" },
    { path: ["lieferantId"], code: "invalid_type" },
  ]) } });
  assert.equal(result.taxError, TAX_RANGE_ERROR);
  assert.match(result.message, /Lieferant/);
  assert.doesNotMatch(result.message, /too_big|Number must/);
  assert.equal(describeBulkEditError({ status: 400, data: { error: JSON.stringify([{ path: ["steuersatz"], code: "custom" }]) } }).taxError, TAX_PRECISION_ERROR);
});

test("unexpected, network and authorization errors remain understandable", () => {
  for (const error of [null, new Error("network"), { status: 500, data: { error: "database internals" } }, { status: 400, data: { error: "not json" } }]) {
    const result = describeBulkEditError(error);
    assert.ok(result.message);
    assert.doesNotMatch(result.message, /database internals|not json/);
  }
  assert.match(describeBulkEditError({ status: 401 }).message, /Anmeldung/);
});
