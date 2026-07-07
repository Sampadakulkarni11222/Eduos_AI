export class AppError extends Error {
  /**
   * @param {string} message  Human-readable message
   * @param {number} statusCode  HTTP status
   * @param {string[]} errors  Field-level details
   * @param {string|null} code  Stable machine-readable code (e.g. OTP_WRONG)
   *   surfaced to clients so the UI can map friendly copy per failure type.
   */
  constructor(message, statusCode = 500, errors = [], code = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
