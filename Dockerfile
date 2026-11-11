# syntax=docker/dockerfile:1

# The payload is a directory of markdown and a few kilobytes of compiled JavaScript.
# Two stages: the first compiles `src/` with the TypeScript toolchain, the second carries
# only `dist/`, `content/` and the runtime dependencies, so the compiler never ships.
FROM node:22-alpine AS build

WORKDIR /srv

# The full tree, dev dependencies included, because `tsc` is one. Lifecycle scripts stay
# off here as in the runtime stage: `prepare` would run the same `tsc` the next line runs,
# and running install scripts by default is supply-chain risk with nothing to offset it.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine

# Lifecycle scripts are disabled. The build already happened in the stage above, so
# `prepare` has nothing to do here, and running scripts by default is supply-chain risk
# with nothing to offset it. `--omit=dev` keeps the compiler and the test-only tree out of
# the image; `.dockerignore` already excludes the test files themselves, so this image
# cannot run its own suite.
#
# Dependencies are installed from the lockfile only. `npm ci` fails rather than
# silently resolving something the lockfile does not contain, which is the point
# of building an image from a versioned tree.
WORKDIR /srv

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

# `content/` is the product. It is copied, not generated, and it is the only
# thing in this image that a change to the repository is expected to alter.
# `dist/` sits beside it, so the server still resolves `content/` as `../content`.
COPY --from=build /srv/dist ./dist
COPY content ./content

# Not root. The process reads files and answers JSON-RPC, and nothing else.
USER node

# 3000 is `dist/http.js`'s default, and `PORT` overrides it at runtime.
#
# This is declared because the server now has a listener. An earlier revision of this
# file omitted EXPOSE deliberately, on the reasoning that it would be a lie while stdio
# was the only transport — which was true then, and is the reason it is here now.
#
# EXPOSE documents; it does not publish. `docker run -p 3000:3000 …` is what makes the
# port reachable from outside the container. See wiki/environments/docker.md.
EXPOSE 3000

# stdio stays the default, so `docker run -i` behaves as it always has and a client
# spawning the process needs no change.
#
# The HTTP transport is a command away rather than a second image, because the two share
# every byte of payload and differ only in the entry point:
#
#   docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN … node dist/http.js
#
# The HTTP form refuses to start without MCP_AUTH_TOKEN (at least 32 characters) and exits 1
# with a line saying so; the stdio form never reads it. The token is passed at run time and
# is deliberately not an ENV line here: a value baked into the image ships to everyone who
# pulls it.
#
# The whole default lives in CMD, and this file sets no ENTRYPOINT of its own, which is
# what makes that command work. An ENTRYPOINT cannot be replaced by the command that
# follows the image name, only appended to, so `ENTRYPOINT ["node", "dist/index.js"]` turned
# the documented form into `node dist/index.js node dist/http.js`: the stdio server started,
# read a closed stdin, and exited 0 with the published port closed — a silent failure.
# `ENTRYPOINT ["node"]` is no better, giving `node node dist/http.js` and an exit 1. Both
# were built and run before this line was chosen.
#
# What this file inherits from `node:22-alpine` is `ENTRYPOINT ["docker-entrypoint.sh"]`,
# which ends in `exec "$@"`. That is what makes the override work: the documented command
# replaces CMD, the inherited entrypoint execs it, and `node dist/http.js` runs as written.
# Setting an ENTRYPOINT here would replace that script with a fixed prefix, which is the
# failure above. Do not add one back.
#
# Set MCP_ALLOWED_HOSTS when the container is reachable from anywhere but this machine;
# the Host allow-list is off unless you set it. See wiki/environments/env.md.
CMD ["node", "dist/index.js"]
