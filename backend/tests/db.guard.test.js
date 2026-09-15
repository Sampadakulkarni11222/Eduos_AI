import { describe, it, expect } from 'vitest';
import { assessDatabaseTarget, databaseHostsOf, databaseGuardConfig } from '../src/config/env.js';

/**
 * The startup guard that keeps non-production processes off production data.
 * Pure function tests: nothing here connects to a database.
 */

const ATLAS = 'mongodb+srv://user:secret@cluster0.prod1.mongodb.net/school_erp?retryWrites=true';
const STAGING_ATLAS = 'mongodb+srv://stg:secret@staging.abc12.mongodb.net/eduos_staging';
const LOCAL = 'mongodb://localhost:27017/school_erp';

describe('assessDatabaseTarget', () => {
  it('refuses a remote cluster in development, naming the way out', () => {
    const r = assessDatabaseTarget({ nodeEnv: 'development', uri: ATLAS });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION=true/);
    expect(r.reason).not.toMatch(/secret|cluster0/);
  });

  it('allows a local database in development', () => {
    expect(assessDatabaseTarget({ nodeEnv: 'development', uri: LOCAL }).ok).toBe(true);
  });

  it('allows a staging cluster outside production only when explicitly permitted', () => {
    expect(assessDatabaseTarget({ nodeEnv: 'staging', uri: STAGING_ATLAS }).ok).toBe(false);
    expect(assessDatabaseTarget({ nodeEnv: 'staging', uri: STAGING_ATLAS, allowRemote: true }).ok).toBe(true);
  });

  it('refuses a listed production host outside production even when remote is allowed', () => {
    const r = assessDatabaseTarget({
      nodeEnv: 'staging', uri: ATLAS, allowRemote: true, productionHosts: ['cluster0.prod1.mongodb.net'],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/PRODUCTION_DB_HOSTS/);
  });

  it('matches a listed parent domain and multi-host URIs', () => {
    const uri = 'mongodb://a.prod1.mongodb.net:27017,b.prod1.mongodb.net:27017/db?replicaSet=rs0';
    expect(databaseHostsOf(uri)).toEqual(['a.prod1.mongodb.net', 'b.prod1.mongodb.net']);
    expect(assessDatabaseTarget({ nodeEnv: 'test', uri, allowRemote: true, productionHosts: ['prod1.mongodb.net'] }).ok).toBe(false);
  });

  it('never refuses in production — the production gate in env.js governs there', () => {
    expect(assessDatabaseTarget({ nodeEnv: 'production', uri: ATLAS, productionHosts: ['cluster0.prod1.mongodb.net'] }).ok).toBe(true);
  });

  it('reads its settings from the environment', () => {
    expect(databaseGuardConfig({ ALLOW_REMOTE_DB_OUTSIDE_PRODUCTION: 'true', PRODUCTION_DB_HOSTS: 'A.example.net, b.example.net' }))
      .toEqual({ allowRemote: true, productionHosts: ['a.example.net', 'b.example.net'] });
    expect(databaseGuardConfig({})).toEqual({ allowRemote: false, productionHosts: [] });
  });
});
