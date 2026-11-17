import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditableCell } from "../src/components/EditableCell";
import { singleEditError, validateSingleNumber } from "../src/lib/single-edit-validation";

afterEach(cleanup);

describe("single invoice numeric edits", () => {
  it("accepts null, zero, custom tax rates and signed booking boundaries", () => {
    for (const text of ["", " ", null]) expect(validateSingleNumber("steuersatz", text)).toEqual({ value: null });
    for (const text of ["0", "7,5", "100", "99.99"]) expect(validateSingleNumber("steuersatz", text).error).toBeUndefined();
    for (const field of ["buchungskonto1Betrag", "buchungskonto2Betrag"] as const) {
      for (const text of ["-9999999999.99", "9999999999,99", "-123,45", "0", ""])
        expect(validateSingleNumber(field, text).error).toBeUndefined();
      for (const text of ["10000000000", "-10000000000", "1.001", "12abc", "1e-7", "NaN", "Infinity"])
        expect(validateSingleNumber(field, text).error).toBeTruthy();
    }
    for (const text of ["-1", "100.01", "1.001", "7,123", "1e-7", "19%"])
      expect(validateSingleNumber("steuersatz", text).error).toBeTruthy();
  });

  it("keeps invalid input editable and does not send a request", () => {
    const save = vi.fn();
    render(<EditableCell value={19} onSave={save} validate={(v) => validateSingleNumber("steuersatz", v).error} />);
    fireEvent.click(screen.getByText("19"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "101" } });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("0 und 100");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("101");
  });

  it("retains a rejected draft across refresh and permits correction", async () => {
    const save = vi.fn().mockRejectedValueOnce({ status: 400, data: { error: JSON.stringify([{ path: ["steuersatz"], code: "custom" }]) } }).mockResolvedValue(undefined);
    const props = { onSave: save, describeError: (e: unknown) => singleEditError(e, "steuersatz") };
    const { rerender } = render(<EditableCell value={19} {...props} />);
    fireEvent.click(screen.getByText("19"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "7,55" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await screen.findByRole("alert");
    rerender(<EditableCell value={20} {...props} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("7,55");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(save).toHaveBeenLastCalledWith("0");
  });
});
