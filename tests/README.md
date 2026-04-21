# Tests

Pure helpers are tested with Node's built-in test runner. No dependencies needed.

## Run all tests

From the repo root:

    node --test

Or with an explicit glob:

    node --test 'tests/**/*.test.js'

Requires Node 20+ (for `node:test` auto-discovery).
