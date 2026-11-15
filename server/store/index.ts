import { config, supabaseConfigured } from '../config.js';
import { LocalStore } from './local.js';
import { SupabaseStore } from './supabase.js';
import type { Store } from './types.js';

let instance: Store | null = null;

export async function getStore(): Promise<Store> {
  if (instance) return instance;
  if (supabaseConfigured) {
    const store = new SupabaseStore(config.supabaseUrl, config.supabaseServiceKey);
    try {
      await store.init();
      instance = store;
      console.log('[store] using Supabase');
      return store;
    } catch (error) {
      console.error('[store] Supabase unavailable:', (error as Error).message);
      console.error('[store] falling back to the local file store');
    }
  }
  const local = new LocalStore(config.dataDir);
  await local.init();
  instance = local;
  console.log('[store] using local file store');
  return local;
}

export type { Store } from './types.js';
