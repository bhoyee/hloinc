const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.js'],
  },
});
