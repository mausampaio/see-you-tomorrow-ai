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
 * not a comment, is what refuses the other shape — no `!`, no `as`, anywhere in these tests.
 * `tsc -p tsconfig.json --noEmit` (part of `npm run verificar`) type-checks this file: if any
 * `@ts-expect-error` below stops finding a real error, the directive becomes "unused" and the
 * type check fails — that's what makes this test "impossible to compile" in practice, as
 * docs/PLANO-DE-ENTREGA.md S1-T1 requires.
 *
 * **This file briefly (S1-T10 to S1-T11) proved refusal of a second PID-bearing shape,
 * `SessionWithoutSessionId` (D-023), which needed narrowing on two discriminants
 * (`hasPid && hasSessionId`) instead of one. D-029 (S1-T11) removed that shape, and this file
 * shrank back to proving the single discriminant — see docs/DECISOES.md D-029.**
 *
 * A `DiscoveredSession`-typed value used for a genuine union proof is taken as a **function
 * parameter**, not a directly-initialized `const`: TypeScript's control-flow analysis narrows a
 * freshly-initialized `const` to the *initializer's own* type from the very first line, ignoring
 * a wider annotation, so `const session: DiscoveredSession = createSessionWithPid()` doesn't
 * actually carry the union for narrowing purposes. A parameter's flow type at function entry is
 * exactly its declared type, with no initializer to narrow from. See docs/TESTES.md § "Teste de
 * tipo: cuidado com `const` anotado pela união" — that rule was found while working on this file
 * during S1-T10 and doesn't depend on the strategy that motivated it; it still applies here.
 */
describe('processTerminationData (D-024)', () => {
  it('accepts SessionWithPid and returns pid + procStart', () => {
    const session = createSessionWithPid({ pid: 9999, procStart: '111222333' });

    expect(processTerminationData(session)).toStrictEqual({ pid: 9999, procStart: '111222333' });
  });

  it('DiscoveredSession (the union, unnarrowed) is accepted after checking session.hasPid', () => {
    function callIfTerminable(
      session: DiscoveredSession,
    ): ReturnType<typeof processTerminationData> | undefined {
      if (session.hasPid) {
        // Compiles only because the `if` above narrowed `session` to `SessionWithPid` — see the
        // `@ts-expect-error` cases below for what's refused without that narrowing.
        return processTerminationData(session);
      }
      return undefined;
    }

    const result = callIfTerminable(createSessionWithPid({ pid: 9999, procStart: '111222333' }));

    expect(result).toStrictEqual({ pid: 9999, procStart: '111222333' });
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
    function callWithoutNarrowing(session: DiscoveredSession) {
      // @ts-expect-error D-024: without `if (session.hasPid)`, TypeScript doesn't know `session`
      // is the PID-bearing shape — the whole union, including the PID-less side, would need to
      // be accepted, and it isn't.
      return () => processTerminationData(session);
    }

    expect(callWithoutNarrowing(createSessionWithoutPid())).toBeTypeOf('function');
  });

  it('documented return type: exactly { pid, procStart }, nothing else', () => {
    const session: SessionWithPid = createSessionWithPid();

    const result = processTerminationData(session);

    expect(Object.keys(result).sort()).toStrictEqual(['pid', 'procStart']);
  });
});
