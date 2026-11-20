# Docker

The server runs in a container. The image supports **both transports**: its default command is
the stdio server, and the HTTP one is a command away.

## What a container is for here

A client can spawn this server as a subprocess and speak JSON-RPC over its stdin and stdout, or
reach it over HTTP. What the image buys either way:

* **A pinned toolchain.** The binaries are built in `rust:1.97-alpine` instead of whatever is on
  the host.
* **A reproducible build.** `cargo build --release --locked` fails rather than resolving
  something `Cargo.lock` does not contain.
* **No compiler in the image.** The first stage compiles; the image itself, on `alpine:3.22`,
  carries only the two binaries in `/srv/bin` and `content/` in `/srv/content`.
* **A non-root process.** The image ends as `USER mcp` (uid 10001).
* **Isolation from the host**, which matters if the client is on a different machine.
* **A network boundary**, if you run it as a service.

## Build

```bash
docker build -t lxagents-shared-instruction:6.0.6 .
```

Tag it with the version in `Cargo.toml` rather than `latest`. The image's job is to be
reproducible, and `latest` is the one tag that cannot be.

## Run — stdio

stdio means the container's stdin has to stay open and attached:

```bash
docker run --rm -i lxagents-shared-instruction:6.0.6
```

**`-i` is not optional.** Without it Docker does not attach stdin, the server sees closed
input, and it exits immediately — which reads as a broken image rather than a missing flag.
There is nothing to publish: this form has no port.

## Run — HTTP

Name the HTTP binary after the image to serve instead of attaching a pipe. The image sets no
`ENTRYPOINT`, so the name replaces the default command:

```bash
docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-shared-instruction:6.0.6 lxagents-shared-instruction-http
```

**`MCP_AUTH_TOKEN` is required for this form.** The container binds `0.0.0.0`, which is not
loopback. `-e MCP_AUTH_TOKEN` with no value passes the variable through from your shell;
`--env-file` or your host's secret store work too. Without it the container exits with code `1`
and one line saying why — it does not start open. The stdio form needs no token. Never bake the
value into the image with an `ENV` line: it would ship to everyone who pulls it.

**`-p` is what makes it reachable**, and forgetting it produces a container that is running,
healthy, and connectable from nowhere. `EXPOSE 3000` documents the port; it does not publish it.

The HTTP server runs one worker thread per CPU the container was given, behind one listener, so
the log carries one `serving Skill MCP over http` line. Set `MCP_CLUSTER_WORKERS=1` for a
single-threaded runtime.

Set `MCP_ALLOWED_HOSTS` when it is reachable from anywhere but this machine — the allow-list is
off unless you set it:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_AUTH_TOKEN \
  -e MCP_ALLOWED_HOSTS=shared-instruction.example.com \
  lxagents-shared-instruction:6.0.6 lxagents-shared-instruction-http
```

See [Environment variables](env.md) and the [security model](../security/security-model.md).

To point an MCP client at the stdio form, give it the same command:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "lxagents-shared-instruction:6.0.6"]
    }
  }
}
```

The local-clone form in [Connect a repository](../guides/connect-a-repository.md) is the one
that works everywhere; the container is for a host without a Rust toolchain, or for running
the HTTP form as a service.

## What is in the image

| Path | Why |
|---|---|
| `/srv/content/` | The product. Copied, not generated — the only thing a repository change is expected to alter. |
| `/srv/bin/lxagents-shared-instruction` | The stdio server, and the default command. |
| `/srv/bin/lxagents-shared-instruction-http` | The HTTP server. |

The binaries find the set as `/srv/content`, the first `content/` among their own ancestors.
`.dockerignore` keeps the rest out of the build context: `target`, `tests`, `wiki`, `.agents`,
`AGENTS.md`, `README.md`, `.git`, and local noise. **The image cannot run its own test suite** —
`cargo test` needs `tests/` and the toolchain, and the suite is a gate on the repository, not on
the artifact.

## There is no compose file

A compose file encodes a deployment, and this repository has none. It ships an image that can be
deployed, not a deployment. Whoever operates the service decides how it is routed, what it is
called, and what fronts it.

## Verifying an image

```bash
docker run --rm -i lxagents-shared-instruction:6.0.6 < /dev/null
```

With stdin closed the server exits at once, so this checks that the binary runs and found its
set — a set that fails to load exits 1 with `cannot load its set`. To check the set itself, run
`cargo test` in a checkout.

For the HTTP form, run it as above and then `curl http://localhost:3000/healthz` — a `200` and
three fields.

> **This image has not been built.** The environment the Rust migration was written in has the
> Docker client but no daemon, so the `Dockerfile` is written and not verified by a build. The
> binaries it copies are the ones `cargo build --release` produces and the suite tests.

## Related pages

- [Local setup](setup.md) — running the server without a container.
- [Architecture](../information/architecture.md) — the two transports it has.
- [Environment variables](env.md) — `PORT`, `HOST`, `MCP_ALLOWED_HOSTS`, `MCP_AUTH_TOKEN`,
  `MCP_TRANSPORT`, `MCP_CLUSTER_WORKERS`.
- [Security model](../security/security-model.md) — what a container does and does not change
  about exposure.
