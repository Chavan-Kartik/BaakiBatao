import { serve } from '@hono/node-server';
import { createServer } from './server';

const { app, env, deps } = await createServer();

serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(
    `fc-api listening on http://localhost:${info.port}  data=${env.dataDir}  extractor=${deps.extractor.name}  env=${env.nodeEnv}`,
  );
});
