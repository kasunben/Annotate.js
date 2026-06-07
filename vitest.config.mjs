import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs', 'tests/integration/**/*.test.mjs'],
    environment: 'node',
    pool: 'forks',
    env: { DATABASE_PATH: ':memory:' },
    coverage: {
      provider: 'v8',
      include: ['server/**/*.js'],
      reporter: ['text', 'lcov'],
    },
  },
});
