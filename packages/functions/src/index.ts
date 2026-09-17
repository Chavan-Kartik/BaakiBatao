/**
 * @fc/functions — thin Lambda handlers.
 *
 * Every handler is a wrapper: parse the event, do I/O, call into @fc/engine,
 * write the result. No money math lives here.
 *
 * To build (the build spec §11, §25 W1):
 *
 *   api/       create-case · get-case · submit-corrections · get-letter ·
 *              verify · simulate · events-stream (SSE via Function URL)
 *
 *   pipeline/  classify-docs · start-textract · textract-complete ·
 *              parse-tables · parse-queries · redact · checksum-rows ·
 *              normalise · reconstruct · write-prose · issue-certificate
 *
 * Two patterns worth getting right rather than improvising:
 *
 *   start-textract / textract-complete — there is no `.sync` service
 *   integration for async Textract, so the task token is stored keyed by the
 *   Textract JobId and SendTaskSuccess is called from the SNS completion
 *   handler. §11.3.
 *
 *   redact — fails CLOSED. If redaction cannot be confirmed, the execution
 *   stops with REDACTION_FAILED_OPEN and nothing reaches Bedrock. §13.
 */
export { markRedacted, PII_ENTITY_TYPES, PII_FORMAT_PATTERNS } from './shared/redacted';
export type { RedactedText, RedactionOutcome } from './shared/redacted';
