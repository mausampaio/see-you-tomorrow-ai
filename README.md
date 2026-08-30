# See You Tomorrow AI

The day ends with several AI sessions in progress, across different projects. The next day, the
expensive part isn't resuming the work — it's rebuilding the context for each one.

**See You Tomorrow AI** discovers the Claude Code sessions on your machine, captures the state of
each one at the end of the day, generates a plan for tomorrow, and resumes right where you left
off the next day.

The command is called **`seeya`**.

```bash
seeya sessions    # what's open right now
seeya end-day     # captures everything and plans tomorrow
seeya start-day   # resumes where you left off
```

> **Status: early development (Sprint 3 done).** `sessions`, `status`, `end-day` and
> `start-day` work. The daemon, notifications and `snooze`/`skip-today` are Sprint 4 and don't
> exist yet, so today the two day commands are run by hand. Nothing has been published to npm —
> see Install below. Follow along in [`docs/PLANO-DE-ENTREGA.md`](docs/PLANO-DE-ENTREGA.md).

## How it works

Claude Code registers live sessions in `~/.claude/sessions/` and keeps each one's transcript in
`~/.claude/projects/`. `seeya` reads both sources — plus each project's git state, worktrees
included — to assemble a handoff per session: what was being worked on, what's left pending, and
what to do tomorrow.

It **never talks to the live session**. There's no channel to inject a command into a running
interactive session, so the capture happens from the outside, in a headless process that sees the
whole conversation. This works even for sessions that have already died, and it doesn't spend the
open session's context. The reasoning is in [`docs/DECISOES.md`](docs/DECISOES.md), D-001.

Everything `seeya` writes lives in `~/.seeya/`. It never writes inside your repositories nor
inside `~/.claude/`.

## Requirements

- Node.js >= 22
- Claude Code installed and authenticated

## Install

**Not published to npm yet.** Until it is, install from a clone:

```bash
git clone https://github.com/<owner>/see-you-tomorrow-ai.git
cd see-you-tomorrow-ai
npm ci
npm run build
npm link
```

`npm link` puts a global `seeya` on your PATH pointing at this checkout, so a later
`npm run build` takes effect without linking again. Check it:

```bash
seeya --version
seeya sessions
```

To remove it: `npm unlink -g see-you-tomorrow-ai`.

If you'd rather install nothing, run the compiled entry point directly — `node dist/cli/index.js
sessions` does the same thing.

**On PATH.** `npm link` writes into npm's global prefix (`npm config get prefix`). If `seeya`
isn't found afterwards, that directory isn't on your PATH — add it, or use the `node dist/...`
form above.

## Development

```bash
npm install
npm run verificar   # the gate: types + lint + layers + build + coverage
```

The other commands:

```bash
npm run build          # compiles TypeScript to dist/
npm test               # unit + integration
npm run test:e2e       # end-to-end
npm run test:contrato  # against the real ~/.claude; doesn't run in standard CI
npm run lint           # eslint
npm run dependencias   # dependency-cruiser: validates layer boundaries
npm run cobertura      # tests with coverage and per-directory thresholds
npm run verificar:linux  # the gate inside a Linux container (node:22-bookworm)
```

### Linux pre-flight via Docker

CI runs on three OSes (ubuntu, windows, macos). A real Linux bug once escaped until after the
push because there was no way to reproduce the Linux job locally on a Windows machine. Run:

```bash
npm run verificar:linux
```

This runs `npm ci && npm run verificar` inside `node:22-bookworm`, reproducing CI's Linux job.
The host's `node_modules` is **never** mounted into the container — `vitest`, `esbuild` and
`rollup` ship platform-native binaries, and a `node_modules` installed on Windows breaks
instantly inside Linux. Instead, the script uses a named Docker volume, isolated from the host,
populated by `npm ci` running inside the container. The first run reinstalls everything;
subsequent ones reuse the volume and are fast.

The volume name is `seeya-node-modules-<hash>`, where `<hash>` derives from the repository's
absolute path — **one volume per repository/worktree, never a single global one**. It was proven
that a single volume breaks under concurrency: two simultaneous `npm ci` runs (two worktrees
running the pre-flight at the same time — a common scenario here) writing to the same volume make
one of them lose the race with `ENOENT: Cannot cd into '/app/node_modules/...'`. It's a
false-negative, not a false-positive, and the volume doesn't get corrupted — but it's a failure
unrelated to the dev's code. The path-based hash eliminates the race without needing a lock: each
worktree has its own volume, and the main repository keeps reusing the same one across runs (same
path every time), preserving the cache gain.

Cost: an orphaned volume is left behind when a worktree is removed. To clean up:

```bash
docker volume ls --filter name=seeya-node-modules-   # lists the project's volumes
docker volume rm seeya-node-modules-<hash>            # removes a specific worktree's
```

Requires Docker Desktop installed and running; the script detects when the daemon doesn't
respond and warns instead of failing with a cryptic error.

**Honest limit: there's no macOS coverage here.** There's no macOS container — the XNU kernel and
Apple's license require Apple hardware. This command only covers CI's Linux job; CI on all 3 OSes
and the manual S5-T4 pass remain mandatory.

### Before writing code

Read [`AGENTS.md`](AGENTS.md). It's the project's work contract: layer boundaries, code style,
what never to do, and when to stop and ask instead of deciding alone. It applies to agents and
humans alike. `CLAUDE.md` just points to it.

## Documentation

| File                                                   | What it is                                         |
| ------------------------------------------------------ | -------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                               | Work contract, non-negotiable rules and code style |
| [`docs/DECISOES.md`](docs/DECISOES.md)                 | Locked decisions, numbered and with the reasoning  |
| [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)       | Behavior of each command                           |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)           | Layers and the allowed-dependency matrix           |
| [`docs/TESTES.md`](docs/TESTES.md)                     | The test pyramid and the contract track            |
| [`docs/PLANO-DE-ENTREGA.md`](docs/PLANO-DE-ENTREGA.md) | Sprint-by-sprint, task-by-task roadmap             |
| [`docs/FORA-DE-ESCOPO.md`](docs/FORA-DE-ESCOPO.md)     | What v1 deliberately doesn't do                    |
| [`docs/spikes/`](docs/spikes/)                         | Experiments, with raw output and the verdict       |

This project depends on internal, undocumented Claude Code structures. When they change, the
contract suite is what will warn us — see [`docs/TESTES.md`](docs/TESTES.md).

## License

MIT
