/**
 * @fc/fixtures — reference claim packs.
 *
 * Deliberately data-only and dependency-light, so the browser bundle can
 * import a pack without dragging the eval harness in with it.
 */
export {
  ACTUAL_PAID,
  AS_OF,
  BILL_DOC,
  CLAIM_LEVEL,
  LINES,
  SHEET_DOC,
  billRef,
  buildInput,
  lineDescription,
} from './worked-example';
export type { FixtureLine } from './worked-example';
