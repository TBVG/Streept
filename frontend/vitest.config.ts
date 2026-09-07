import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // pure-function tests (geo math etc.) don't need a DOM
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
