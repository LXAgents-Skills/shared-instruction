# syntax=docker/dockerfile:1

# The payload is a directory of markdown and two small static binaries.
# Two stages: the first compiles the crate with the Rust toolchain, the second carries only the
# binaries and `content/`, so the compiler never ships.
FROM rust:1.97-alpine AS build

WORKDIR /srv

# musl-dev is what links a static binary on Alpine.
RUN apk add --no-cache musl-dev

# The manifest and lockfile first, so a change to `src/` does not refetch every dependency.
# `--locked` fails rather than silently resolving something the lockfile does not contain.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked --bins

FROM alpine:3.22

WORKDIR /srv

# `content/` is the product. It is copied, not generated, and it is the only thing in this image
# a change to the repository is expected to alter. The binaries sit in `/srv/bin`, so the server
# finds the set as `/srv/content`, the first `content/` among its executable's ancestors.
COPY --from=build /srv/target/release/lxagents-shared-instruction /srv/target/release/lxagents-shared-instruction-http /srv/bin/
COPY content ./content
ENV PATH="/srv/bin:${PATH}"

# Not root. The process reads files and answers JSON-RPC, and nothing else.
RUN adduser -D -H -u 10001 mcp
USER mcp

# 3000 is the HTTP transport's default, and `PORT` overrides it at runtime. EXPOSE documents; it
# does not publish. `docker run -p 3000:3000 …` makes the port reachable from outside.
EXPOSE 3000

# stdio stays the default, so `docker run -i` behaves as it always has. The HTTP transport is a
# command away rather than a second image:
#
#   docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN … lxagents-shared-instruction-http
#
# The HTTP form refuses to start without MCP_AUTH_TOKEN (at least 32 characters) and exits 1 with
# a line saying so; the stdio form never reads it. The token is passed at run time and is never an
# ENV line here: a value baked into the image ships to everyone who pulls it.
#
# The whole default lives in CMD and this file sets no ENTRYPOINT, so the command after the image
# name replaces CMD rather than being appended to it.
#
# The container binds 0.0.0.0, which is not loopback, so HTTP here always needs the token. Set
# MCP_ALLOWED_HOSTS when the container is reachable from anywhere but this machine.
CMD ["lxagents-shared-instruction"]
