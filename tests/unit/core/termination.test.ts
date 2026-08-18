import { describe, expect, it } from 'vitest';
import { processTerminationData } from '../../../src/core/termination.js';
import type {
  SessionWithPid,
  DiscoveredSession,
  SessionWithoutPid,
} from '../../../src/core/types.js';
import { createSessionWithPid, createSessionWithoutPid } from './_fixtures.js';

/**
 * Proof of D-024: `processTerminationData` accepts exclusively `SessionWithPid`. The compiler,
 * not a comment, is what refuses the other shapes — no `!`, no `as`, anywhere in these tests.
 * `tsc -p tsconfig.json --noEmit` (part of `npm run verificar`) type-checks this file: if any
 * `@ts-expect-error` below stops finding a real error, the directive becomes "unused" and the
 * type check fails — that's what makes this test "impossible to compile" in practice, as
 * docs/PLANO-DE-ENTREGA.md S1-T1 requires.
 */
describe('processTerminationData (D-024)', () => {
  it('accepts SessionWithPid and returns pid + procStart', () => {
    const session = createSessionWithPid({ pid: 9999, procStart: '111222333' });

    expect(processTerminationData(session)).toStrictEqual({ pid: 9999, procStart: '111222333' });
  });

  it('DiscoveredSession (the union, unnarrowed) is accepted after checking session.hasPid', () => {
    const session: DiscoveredSession = createSessionWithPid();

    if (session.hasPid) {
      // Compiles only because the `if` above narrowed `session` to `SessionWithPid` — without
      // the `if`, the line below wouldn't compile (see the two `@ts-expect-error` cases next).
      expect(processTerminationData(session)).toStrictEqual({
        pid: session.pid,
        procStart: session.procStart,
      });
    } else {
      expect.unreachable('the fixture used here always has a PID');
    }
  });

  it('refuses SessionWithoutPid at compile time — no "!", no "as" (D-024)', () => {
    const sessionWithoutPid: SessionWithoutPid = createSessionWithoutPid();

    // @ts-expect-error D-024: SessionWithoutPid has no `pid`. If this line compiles without
    // error, the type protection D-024 requires broke — processTerminationData started
    // accepting a shape the termination policy (D-002) can't accept.
    const callRefusedByTheCompiler = () => processTerminationData(sessionWithoutPid);

    expect(callRefusedByTheCompiler).toBeTypeOf('function');
  });

  it('refuses the unnarrowed DiscoveredSession union at compile time (D-024)', () => {
    const session: DiscoveredSession = createSessionWithoutPid();

    // @ts-expect-error D-024: without `if (session.hasPid)`, TypeScript doesn't know `session`
    // is the PID-bearing shape — the whole union, including the PID-less side, would need to be
    // accepted, and it isn't.
    const callRefusedByTheCompiler = () => processTerminationData(session);

    expect(callRefusedByTheCompiler).toBeTypeOf('function');
  });

  it('documented return type: exactly { pid, procStart }, nothing else', () => {
    const session: SessionWithPid = createSessionWithPid();

    const result = processTerminationData(session);

    expect(Object.keys(result).sort()).toStrictEqual(['pid', 'procStart']);
  });
});
