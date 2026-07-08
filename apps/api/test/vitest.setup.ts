import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { vi } from 'vitest';

const cwd = process.cwd();
const repoRootFromApi = path.resolve(cwd, '..', '..');

const dotenvCandidates = Array.from(
  new Set([
    path.resolve(cwd, '.env.local'),
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '.env.test'),
    path.resolve(cwd, 'apps/api/.env.local'),
    path.resolve(cwd, 'apps/api/.env'),
    path.resolve(cwd, 'apps/api/.env.test'),
    path.resolve(repoRootFromApi, '.env.local'),
    path.resolve(repoRootFromApi, '.env'),
  ]),
);

for (const filePath of dotenvCandidates) {
  if (existsSync(filePath)) {
    dotenv.config({ path: filePath, override: false });
  }
}

(globalThis as unknown as { jest: typeof vi }).jest = vi;
