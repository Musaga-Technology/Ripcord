// The owner side's settings from the environment, shared by the MCP server and the demo agent.
//   RIPCORD_APP_URL     where guards are set up; its /api/checker relay reaches the checker
//   RIPCORD_POKERS      the pokers that watch a funded guard, comma-separated
//   RIPCORD_PASSPHRASE  locks the seal files (the model never sees it)
//   RIPCORD_HOME        where seal files live, ~/.ripcord by default
//   AURORA_KEY          Aurora's Intents API key (public by design), for funding a guard in any token
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OwnerDeps } from './owner';
import type { Sources } from './read';

export function ownerFromEnv(src: Sources, env: NodeJS.ProcessEnv = process.env): OwnerDeps {
  const appUrl = appUrlFrom(env);
  return {
    sources: src,
    relay: appUrl && `${appUrl}/api/checker`,
    pokers: (env.RIPCORD_POKERS ?? '')
      .split(',')
      .map((p) => p.trim().replace(/\/$/, ''))
      .filter(Boolean),
    home: env.RIPCORD_HOME || join(homedir(), '.ripcord'),
    passphrase: env.RIPCORD_PASSPHRASE || null,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: Date.now,
    aurora: {
      api: env.AURORA_API || 'https://intents-api.aurora.dev',
      key: env.AURORA_KEY || env.NEXT_PUBLIC_AURORA_KEY || null,
      // NEAR Intents' public token list: ids, chains and decimals.
      tokens: 'https://1click.chaindefuser.com/v0/tokens',
    },
  };
}

export const appUrlFrom = (env: NodeJS.ProcessEnv = process.env) => env.RIPCORD_APP_URL?.replace(/\/$/, '') || null;
