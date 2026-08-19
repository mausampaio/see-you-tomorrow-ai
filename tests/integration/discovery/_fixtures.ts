/**
 * Builds a fake `~/.claude` + `~/.seeya` in `tmpdir` (docs/TESTES.md § Integração: "um
 * `~/.claude` falso montado em `tmpdir`"). Every discovery integration test gets its own root via
 * `mkdtemp`, never touches the real home directory, and is responsible for calling
 * `removeDiscoveryFixture` in its own `afterEach` (same pattern as
 * tests/integration/process/termination.test.ts).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface DiscoveryFixture {
  readonly root: string;
  readonly claudeHome: string;
  readonly seeyaHome: string;
  readonly sessionsDir: string;
  readonly projectsDir: string;
}

export async function createDiscoveryFixture(): Promise<DiscoveryFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'seeya-discovery-'));
  const claudeHome = path.join(root, '.claude');
  const seeyaHome = path.join(root, '.seeya');
  const sessionsDir = path.join(claudeHome, 'sessions');
  const projectsDir = path.join(claudeHome, 'projects');
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });
  await mkdir(seeyaHome, { recursive: true });
  return { root, claudeHome, seeyaHome, sessionsDir, projectsDir };
}

export async function removeDiscoveryFixture(fixture: DiscoveryFixture): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}

/** Writes `<sessionsDir>/<fileName>.json` with `record` serialized as JSON. */
export async function writeSessionRecord(
  fixture: DiscoveryFixture,
  fileName: string,
  record: unknown,
): Promise<void> {
  await writeFile(
    path.join(fixture.sessionsDir, `${fileName}.json`),
    JSON.stringify(record),
    'utf8',
  );
}

/** Writes a session-directory file with arbitrary raw text — for corrupted-JSON and `.key`
 * fixtures, where a JS object wouldn't produce the exact broken bytes being tested. */
export async function writeRawSessionFile(
  fixture: DiscoveryFixture,
  fileName: string,
  content: string,
): Promise<void> {
  await writeFile(path.join(fixture.sessionsDir, fileName), content, 'utf8');
}

/** Writes a well-formed `forks.json` — `{ schemaVersion: 1, forks }` (Q-008, docs/QUESTOES.md) —
 * from just the `forks` array, since every well-formed-file test only varies that part. */
export async function writeForksJson(fixture: DiscoveryFixture, forks: unknown[]): Promise<void> {
  await writeForksJsonRaw(fixture, { schemaVersion: 1, forks });
}

/** Writes `forks.json` with whatever root value `content` serializes to, no wrapping — for tests
 * of a malformed root itself (wrong/missing `schemaVersion`, missing/non-array `forks`, a root
 * that isn't even an object), where `writeForksJson`'s automatic wrapper would get in the way. */
export async function writeForksJsonRaw(
  fixture: DiscoveryFixture,
  content: unknown,
): Promise<void> {
  await writeFile(path.join(fixture.seeyaHome, 'forks.json'), JSON.stringify(content), 'utf8');
}

/** `~/.claude/projects/<slug>/<sessionId>.jsonl` — content is irrelevant to discovery (S1-T3
 * only `stat`s it), so a minimal placeholder line is enough. */
export async function writeTranscript(
  fixture: DiscoveryFixture,
  slug: string,
  sessionId: string,
): Promise<void> {
  const dir = path.join(fixture.projectsDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sessionId}.jsonl`), '{"type":"user"}\n', 'utf8');
}
