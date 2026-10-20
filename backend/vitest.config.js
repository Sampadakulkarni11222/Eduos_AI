import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    // Never load the developer's backend/.env into a test run. config/env.js
    // imports `dotenv/config`, which honours DOTENV_CONFIG_PATH; pointing it at
    // a file that does not exist makes a local run see exactly what CI sees
    // (CI has no .env). Without this, a local .env with live AI, WhatsApp or
    // payment credentials made tests call those services — spending credits,
    // risking real messages, and routing through a live model instead of the
    // deterministic one the assertions describe.
    //
    // TZ: the process runs on the school's clock, as a production server must
    // (SCHOOL_TIMEZONE=Asia/Kolkata, see config/env.js). Attendance reads
    // "today" from the process's local date while the principal's overview,
    // the campus and PTM convert to IST themselves; on a UTC runner the two
    // disagree from 18:30 to 24:00 UTC, and suites seeded with one "today"
    // were checked against the other.
    env: { DOTENV_CONFIG_PATH: './tests/.no-dotenv-in-tests', TZ: 'Asia/Kolkata' },
    include: ['tests/**/*.test.js'],
    // Every file connects to the same in-memory MongoDB via a global setup, so
    // files must not run concurrently against each other's collections.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000, // first run downloads the mongodb-memory-server binary
  },
});
