/** Incoming syllabus PDF bytes (Vercel body limit; typical syllabi are smaller). */
export const MAX_SYLLABUS_PDF_BYTES = Math.floor(3.5 * 1024 * 1024);
/** Whole multipart request: PDF plus small text fields. */
export const MAX_SYLLABUS_BODY = MAX_SYLLABUS_PDF_BYTES + 32_768;

/** Gemini PDF parse is slow; leave headroom under the route `maxDuration` (300s). */
export const SYLLABUS_GEMINI_ATTEMPTS = 5;
export const SYLLABUS_GEMINI_TIMEOUT_MS = 55_000;
export const SYLLABUS_GEMINI_BUDGET_MS = 280_000;
/** One extra client-side try after the API still returns busy/unreachable. */
export const SYLLABUS_CLIENT_RETRY_MS = 2_000;
