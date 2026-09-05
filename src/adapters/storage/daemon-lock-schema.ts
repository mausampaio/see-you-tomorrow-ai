/**
 * `~/.seeya/daemon.lock`'s shape and its resolution into `DaemonLockInfo` (`core/daemon-lock.ts`,
 * D-005's own text names this exact file). S4-T3.
 *
 * Same corruption policy as every other document under `~/.seeya/`: a missing file means "no
 * daemon has ever run here" (D-025); a present-but-malformed file rejects loudly. Not validated
 * item-by-item (D-022 doesn't apply): the whole document is one small, project-written record, the
 * same reasoning `state-schema.ts`/`early-warning-schema.ts` already give for their own fields.
 */
import { z } from 'zod';
import type { DaemonLockInfo } from '../../core/daemon-lock.js';

/** Current `schemaVersion` for `daemon.lock`. Passed to `resolveSchemaVersion` by the adapter
 * (`index.ts`) before this module ever sees the document. */
export const DAEMON_LOCK_SCHEMA_VERSION = 1;

/** Validates everything BUT `schemaVersion` — see `state-schema.ts`'s sibling comment for why no
 * `.strict()` and no per-item validation. */
const daemonLockDocumentSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
});

/** Parses `raw` (the document, already past `resolveSchemaVersion`) into `DaemonLockInfo`. */
export function parseDaemonLockDocument(raw: unknown): DaemonLockInfo {
  const result = daemonLockDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`daemon.lock is malformed: ${z.prettifyError(result.error)}`);
  }
  return { pid: result.data.pid, startedAt: new Date(result.data.startedAt) };
}

/** The inverse of `parseDaemonLockDocument` — what `StorageAdapter#writeDaemonLock` writes. */
export function serializeDaemonLock(lock: DaemonLockInfo): Record<string, unknown> {
  return {
    schemaVersion: DAEMON_LOCK_SCHEMA_VERSION,
    pid: lock.pid,
    startedAt: lock.startedAt.toISOString(),
  };
}
