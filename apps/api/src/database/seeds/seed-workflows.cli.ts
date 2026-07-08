#!/usr/bin/env node
/**
 * CLI Script: Seed Workflows from YAML Definition Files
 *
 * Usage:
 *   npm run seed:workflows
 *
 * This script loads all .workflow.yaml files from the seeds directory
 * and populates them into the workflows table. Safe to run multiple times
 * (idempotent - checks by name before creating).
 *
 * Useful for:
 * - Adding workflows after initial setup
 * - Recovering workflows in development
 * - Bootstrapping workflows in CI/CD pipelines
 */

import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { Workflow } from '../../workflow/database/entities/workflow.entity';
import { seedWorkflows } from './workflow/workflows.seed';

// Load .env from apps/api directory (3 levels up from src/database/seeds)
// Use override: true to ensure local .env takes precedence over any preloaded vars
dotenv.config({ path: path.join(__dirname, '../../../.env'), override: true });
// Fallback to root .env without override
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

void (async () => {
  try {
    // Create database connection
    const dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'step_complete',
      entities: [Workflow],
      synchronize: false,
      logging: false,
    });

    console.log('[seed-workflows.cli] Connecting to database...');
    await dataSource.initialize();

    console.log('[seed-workflows.cli] Seeding workflows...');
    await seedWorkflows(dataSource);

    console.log('[seed-workflows.cli] ✅ Workflow seeding complete');
    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error(
      '[seed-workflows.cli] ❌ Failed to seed workflows:',
      err.message,
    );
    console.error(err.stack);
    process.exit(1);
  }
})();
