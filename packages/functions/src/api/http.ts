import { handle } from 'hono/aws-lambda';
import type { LambdaContext, LambdaEvent } from 'hono/aws-lambda';
import { app } from './app';

/**
 * Every route except the events stream, behind the HTTP API. Buffered
 * request/response — API Gateway cannot stream, which is why `/events` has
 * its own entry point on a Function URL.
 */
export const handler = async (event: LambdaEvent, context: LambdaContext) => {
  return handle(await app())(event, context);
};
