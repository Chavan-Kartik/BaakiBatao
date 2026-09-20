import { Hono } from 'hono';
import { streamHandle } from 'hono/aws-lambda';
import { app } from './app';

/**
 * `GET /api/cases/{id}/events` on a Function URL with response streaming —
 * the one route API Gateway cannot serve, because server-sent events are a
 * response that stays open. Same app, same session cookie: CloudFront routes
 * this path here and everything else to the HTTP API, under one origin.
 *
 * `streamHandle` wraps the handler in `awslambda.streamifyResponse`, and the
 * runtime only streams when *that* is the exported handler — so the export is
 * built synchronously over a proxy that defers to the real app per request.
 */
const proxy = new Hono();
proxy.all('*', async (c) => (await app()).fetch(c.req.raw, c.env));

export const handler = streamHandle(proxy);
