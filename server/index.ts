import fs from 'node:fs';
import { assertRuntimeConfig, config } from './config.js';
import { createApp } from './app.js';

async function main() {
  assertRuntimeConfig();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const { app } = await createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[tj-social] API listening on http://0.0.0.0:${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[tj-social] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[tj-social] failed to start', error);
  process.exit(1);
});
