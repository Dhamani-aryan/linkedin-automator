import { describe, expect, it } from "vitest";
import { AppError, ErrorCodes, toErrorResponse } from "./errors.js";

describe("toErrorResponse", () => {
  it("preserves stable application error codes", () => {
    const response = toErrorResponse(new AppError(ErrorCodes.RUN_STOPPED, "Run stopped."));

    expect(response).toEqual({
      code: ErrorCodes.RUN_STOPPED,
      message: "Run stopped.",
      detail: undefined
    });
  });
});
