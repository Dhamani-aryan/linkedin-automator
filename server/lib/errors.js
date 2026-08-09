export const ErrorCodes = Object.freeze({
  CHROME_NOT_CONNECTED: "CHROME_NOT_CONNECTED",
  LINKEDIN_LOGGED_OUT: "LINKEDIN_LOGGED_OUT",
  NAVIGATION_TIMEOUT: "NAVIGATION_TIMEOUT",
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  LAYOUT_MISMATCH: "LAYOUT_MISMATCH",
  AUTH_CHALLENGE: "AUTH_CHALLENGE",
  WEEKLY_LIMIT_REACHED: "WEEKLY_LIMIT_REACHED",
  RUN_STOPPED: "RUN_STOPPED",
  AMBIGUOUS_OUTCOME: "AMBIGUOUS_OUTCOME"
});

export class AppError extends Error {
  constructor(code, message, detail = undefined) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }
}

export function toErrorResponse(error) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail
    };
  }

  return {
    code: "SERVER_ERROR",
    message: error instanceof Error ? error.message : "Unexpected server error."
  };
}
