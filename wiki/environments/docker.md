# Docker

The server runs in a container. The image supports **both transports**: its default
entrypoint is the stdio server, and the HTTP one is a command away.

An earlier revision of this page said `EXPOSE` was deliberately absent because it would be
a lie. That was true while stdio was the whole interface, and it is the reason the port is
now declared: the server has a listener, so the image says so.

## What a container is for here

A client can spawn this server as a subprocess and speak JSON-RPC over its stdin and
stdout, or reach it over HTTP. What the image buys either way:

* **A pinned toolchain.** `node:22-alpine` instead of whatever is on the host.
* **A clean dependency tree.** `npm ci --ignore-scripts --omit=dev` from the lockfile.
  `npm ci` fails rather than resolving something the lockfile does not contain.
* **A non-root process.** The image ends as `USER node`.
* **Isolation from the host**, which matters if the client is on a different machine.
* **A network boundary**, if you run it as a service — which it did not before the HTTP
  transport existed, and which is now a real option rather than a claim to avoid.

## Build

```bash
docker build -t lxagents-shared-instruction:6.0.2 .
```

Tag it with the version in `package.json` rather than `latest`. The image's job is to
be reproducible, and `latest` is the one tag that cannot be.

## Run — stdio

stdio means the container's stdin has to stay open and attached:

```bash
docker run --rm -i lxagents-shared-instruction:6.0.2
```

**`-i` is not optional.** Without it Docker does not attach stdin, the server sees
closed input, and it exits immediately — which reads as a broken image rather than a
missing flag. There is nothing to publish: this form has no port.

## Run — HTTP

Override the entrypoint to serve instead of attaching a pipe:

```bash
docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-shared-instruction:6.0.2 node src/http.js
```

**`MCP_AUTH_TOKEN` is required for this form.** `-e MCP_AUTH_TOKEN` with no value passes the
variable through from your shell; `--env-file` or your host's secret store work too. Without
it the container exits with code `1` and one line saying why — it does not start open. The
stdio form above needs no token. Never bake the value into the image with an `ENV` line: it
would ship to everyone who pulls it.

**`-p` is what makes it reachable**, and forgetting it produces a container that is
running, healthy, and connectable from nowhere. `EXPOSE 3000` documents the port; it does
not publish it, which is the part that surprises people.

**That form forks one worker per CPU the container was given.** `src/http.js` is a
`node:cluster` primary, so the container log carries one `serving over http` line per
worker rather than one line describing a port the primary never bound. Set
`MCP_CLUSTER_WORKERS=1` for a single process, which is what you want behind a proxy that
already does its own load balancing, or when you are debugging the port:

Set `MCP_ALLOWED_HOSTS` when it is reachable from anywhere but this machine — the
allow-list is off unless you set it:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_AUTH_TOKEN \
  -e MCP_ALLOWED_HOSTS=shared-instruction.example.com \
  lxagents-shared-instruction:6.0.2 node src/http.js
```

See [Environment variables](env.md) and the
[security model](../security/security-model.md).

To point an MCP client at it, give it the same command with the container attached:

```json
{
  "mcpServers": {
    "lxagents-shared-instruction": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "lxagents-shared-instruction:6.0.2"]
    }
  }
}
```

Most clients do not attach a persistent stdin to a spawned process, so the stdio form
works only where the client does. The npx and local-clone forms in
[Connect a repository](../guides/connect-a-repository.md) are the ones that work
everywhere; the container is for a host that cannot run Node 20.

**The HTTP form reverses that.** Serving over a port is the shape every client and every
host already understands, so as a Web Service the container is now the *most* portable of
the three rather than the least.

## What is in the image

| Path | Why |
|---|---|
| `content/` | The product. Copied, not generated — the only thing a repository change is expected to alter. |
| `src/` | The server. |
| `package.json`, `package-lock.json` | Dependency resolution only. |

`.dockerignore` keeps the rest out: `node_modules`, `test`, `wiki`, `.agents`,
`AGENTS.md`, `README.md`, `.git`, and local noise. **The image therefore cannot run
its own test suite** — `npm test` needs `test/`, and the suite is a gate on the
repository, not on the artifact.

## There is no compose file, still

A `compose.yaml` for a stdio server is a footgun: it invites `docker compose up` and
a healthcheck against a port that does not exist, both of which fail in ways that
look like a broken image.

**This page previously said a compose file would become worth writing once a real
transport existed** — and one now does. It is still not written, for a different reason:
a compose file encodes a deployment, and this repository has none. It ships an image that
can be deployed, not a deployment. Whoever operates the service decides how it is routed,
what it is called, and what fronts it; that is not a decision this repository can make on
their behalf.

## Verifying an image

```bash
docker run --rm -i lxagents-shared-instruction:6.0.2 < ../dev/null
```

With stdin closed the server exits at once, so this checks that the entrypoint
resolves and Node starts — not that the set is correct. To check the set, run
`npm test` in a checkout.

For the HTTP form, `docker run --rm -p 3000:3000 … node src/http.js` and then
`curl http://localhost:3000/healthz` — a `200` and three fields, which is the correct
response and a quicker check than a handshake.

> **This image has never been built.** Docker is not available in the environment these
> changes were written in, so neither the `EXPOSE` nor the entrypoint override has been
> verified by a build. Treat both as written-and-untested.

## Related pages

- [Local setup](setup.md) — running the server without a container.
- [Architecture](../information/architecture.md) — the two transports it has.
- [Environment variables](env.md) — `PORT`, `HOST`, `MCP_ALLOWED_HOSTS`, `MCP_AUTH_TOKEN`,
  `MCP_TRANSPORT`, `MCP_CLUSTER_WORKERS`.
- [Security model](../security/security-model.md) — what a container does and does
  not change about exposure.
