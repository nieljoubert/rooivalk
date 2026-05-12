import 'dotenv/config';

import { REQUIRED_ENV } from './constants.ts';
import { watchConfigs } from './config/watcher.ts';
import { loadConfig } from './config/loader.ts';
import Cron, { DEFAULT_CRON } from './services/cron/index.ts';
import Rooivalk from './services/rooivalk/index.ts';

async function main() {
  // Validate required environment variables at startup
  const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missingEnv.length) {
    console.error(
      `Missing required environment variables: ${missingEnv.join(', ')}`,
    );
    process.exit(1);
  }

  const config = await loadConfig();
  // Pass config to Rooivalk and other services as needed
  const rooivalk = new Rooivalk(config);

  // Watch for config changes and reload in-memory config
  watchConfigs(async (_) => {
    try {
      const newConfig = await loadConfig();
      rooivalk.reloadConfig(newConfig);
    } catch (error) {
      console.error('Failed to reload config:', error);
    }
  });

  await rooivalk.init();

  const cron = new Cron(rooivalk);
  const motdExpr = process.env.ROOIVALK_MOTD_CRON || DEFAULT_CRON;
  cron.schedule(motdExpr, async () => {
    await rooivalk.sendMotdToMotdChannel();
  });
  if (process.env.STEAM_API_KEY) {
    cron.schedule('0 0 * * *', async () => {
      await rooivalk.syncSteamAppList();
    });
  }
}

main().catch((error) => {
  console.error('Application failed to initialize:', error);
  process.exit(1);
});
