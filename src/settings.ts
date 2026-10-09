import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Limits } from './domain.js';
import { saveJson } from './setup.js';

export const Settings = z.object({ version: z.literal(1).default(1), view: z.enum(['compact', 'verbose']).default('compact'), editor: z.object({ executable: z.string().min(1).max(2000), args: z.array(z.string().max(2000)).max(20).default([]) }).strict().optional(), limits: Limits.default(() => Limits.parse({})), openBrowser: z.boolean().default(true), favorites: z.array(z.object({ provider: z.string().min(1), id: z.string().min(1) }).strict()).max(100).default([]) }).strict();
export function readSettings(home: string) { const path = join(home, 'settings.json'); return Settings.parse(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}); }
export function saveSettings(home: string, value: unknown) { const parsed = Settings.parse(value); saveJson(join(home, 'settings.json'), parsed); return parsed; }
