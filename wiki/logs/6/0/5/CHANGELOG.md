# 6.0.5

**Released:** 2026-11-11

**The server is TypeScript.** `src/` and `test/` are strict TypeScript, and `tsc` compiles `src/` to
`dist/`. `dist/` is not committed: the `prepare` script builds it, so `git clone` followed by
`npm install` gives a runnable server with no extra step. Every dependency is on its latest
version, and `npm audit` is clean.

**Nothing a client sees changes.** All 49 tool ids, their descriptions, their input schemas,
every body, the server name and the `initialize` instructions are byte-identical to `6.0.4`
(compared over stdio, one sha256 for both). The two transports, the environment variables and
the SDK calls are unchanged.

**Consumers must:** change a server config that runs a checkout from `src/index.js` to
`dist/index.js` (and `src/http.js` to `dist/http.js`), then run `npm install` once in the
checkout so `dist/` exists. A client using `npx` or the image needs nothing beyond pulling `6.0.5`.

This is a patch, by the owner's standing preference, even though the entry-point paths move.

## Added

- **`tsconfig.json`**: ES2022, `NodeNext`, `rootDir` `src`, `outDir` `dist`, `strict`.
- **`tsconfig.test.json`**: the same options over `src/` and `test/`, with no output.
- **Scripts** `build` (`tsc`), `prepare`, and `typecheck`. `pretest` builds and type-checks
  before the suite runs.
- **Dev dependencies** `typescript` 7.0.2, `@types/node` 26.6.6, `@types/express` 5.0.6 and
  `tsx` 4.23.15.

## Changed

- **Runtime dependencies**: `@modelcontextprotocol/sdk` 1.32.2, `express` 5.3.0, `zod` 4.6.7.
  `npm audit` went from 8 vulnerabilities (3 high) to 0.
- **Every source and test file** is renamed to `.ts` and typed. The logic is unchanged.
- **`main`, `bin` and the start scripts** run `dist/`. `test` runs
  `node --import tsx --test test/*.test.ts`, and the process tests spawn the compiled build.
- **The `Dockerfile`** has two stages. The first compiles, and the second carries `dist/` and
  `content/` without the compiler. It still uses `--ignore-scripts`, still runs as `USER node`,
  and its CMD is `node dist/index.js`.
- **`.agents/rules/repository.md`** describes the TypeScript build in place of "no build step".
  Compiled output is still never committed.
- **The documentation** names `src/*.ts` for sources and `dist/*.js` for everything that runs.
- **The image tag** in the README, the Docker page and the security model is now `6.0.5`.

## Removed

- **A dead argument**: `inputSchema: config.schema` in `src/server.ts`. It was always
  `undefined`.

Tests: 74, all passing. The surface is 49 tools.
