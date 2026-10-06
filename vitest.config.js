const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/setup/global.js'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    // Child-process workers crash intermittently on Windows (exit 0xC0000409); threads don't.
    pool: 'threads',
  },
});
