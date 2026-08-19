import { describe, expect, it } from 'vitest';
import { processTerminationData } from '../../../src/core/termination.js';
import type {
  SessionWithPid,
  DiscoveredSession,
  SessionWithoutPid,
  SessionWithoutSessionId,
} from '../../../src/core/types.js';
import {
  createSessionWithPid,
  createSessionWithoutPid,
  createSessionWithoutSessionId,
} from './_fixtures.js';

/**
 * Proof of D-024 (grown by S1-T10/D-023, which adds a *second* PID-bearing shape,
 * `SessionWithoutSessionId`, that must be refused for a different reason than `SessionWithoutPid`
 * — see `core/termination.ts`'s own docstring). The compiler, not a comment, is what refuses the
 * wrong shapes — no `!`, no `as`, anywhere in these tests. `tsc -p tsconfig.json --noEmit` (part
 * of `npm run verificar`) type-checks this file: if any `@ts-expect-error` below stops finding a
 * real error, the directive becomes "unused" and the type check fails — that's what makes this
 * test "impossible to compile" in practice, as docs/PLANO-DE-ENTREGA.md S1-T1 requires.
 *
 * **A trap found while writing the S1-T10 additions, worth recording so nobody reintroduces it:**
 * `const session: DiscoveredSession = createSessionWithPid();` looks like it declares `session`
 * with the full union type, but it doesn't, for narrowing purposes — TypeScript's control-flow
 * analysis narrows a freshly-initialized `const` to the *initializer's own* type
 * (`SessionWithPid` here) from the very first line, regardless of the wider annotation. A
 * `@ts-expect-error` (or a "this needs narrowing first" positive case) built on a `const` shaped
 * that way silently stops testing what it claims to, because the union was never really in play —
 * confirmed here by direct experiment: swapping such a line back and forth changed nothing about
 * whether the following call compiled. Every test below that needs a *genuine* `DiscoveredSession`
 * — not secretly a narrower type wearing the union's name — takes it as a **function parameter**
 * instead: a parameter's flow type at function entry is exactly its declared type, with no
 * initializer to narrow from.
 */
describe('processTerminationData (D-024, D-023)', () => {
  it('accepts SessionWithPid and returns pid + procStart', () => {
    const session = createSessionWithPid({ pid: 9999, procStart: '111222333' });

    expect(processTerminationData(session)).toStrictEqual({ pid: 9999, procStart: '111222333' });
  });

  it('DiscoveredSession (the union, unnarrowed) is accepted after checking hasPid AND hasSessionId', () => {
    // A real DiscoveredSession-typed parameter (see the module docstring for why this can't be a
    // directly-initialized const): narrowing needs BOTH discriminants now that hasPid alone
    // matches two shapes (SessionWithPid and SessionWithoutSessionId, D-023) instead of one.
    function callIfTerminable(
      session: DiscoveredSession,
    ): ReturnType<typeof processTerminationData> | undefined {
      if (session.hasPid && session.hasSessionId) {
        // Compiles only because the `if` above narrowed `session` all the way to `SessionWithPid`
        // — see the `@ts-expect-error` cases below for what's still refused with only one of the
        // two conditions checked.
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

  it('refuses SessionWithoutSessionId at compile time — has a pid, but D-023 forbids it anyway', () => {
    const sessionWithoutSessionId: SessionWithoutSessionId = createSessionWithoutSessionId();

    // @ts-expect-error D-023: SessionWithoutSessionId carries a real pid, but is a different,
    // unrelated interface from SessionWithPid (no sessionId, no procStart) — never assignable,
    // by construction. Widening this function's parameter to also accept it is exactly the "fix"
    // core/termination.ts's own docstring warns against: a session known only from the .key
    // strategy has no sessionId to verify a handoff against before terminating (D-002's ordering
    // requirement), so it must stay refused even though it, too, has a pid.
    const callRefusedByTheCompiler = () => processTerminationData(sessionWithoutSessionId);

    expect(callRefusedByTheCompiler).toBeTypeOf('function');
  });

  it('refuses the unnarrowed DiscoveredSession union at compile time (D-024)', () => {
    const session: DiscoveredSession = createSessionWithoutPid();

    // @ts-expect-error D-024: without narrowing, the whole union — including both shapes that
    // aren't SessionWithPid — would need to be accepted, and it isn't. (This particular const IS
    // safe from the module docstring's trap: the initializer's own type, SessionWithoutPid, is
    // already wrong on its own merits, so the flow-narrowing quirk doesn't change the outcome.)
    const callRefusedByTheCompiler = () => processTerminationData(session);

    expect(callRefusedByTheCompiler).toBeTypeOf('function');
  });

  it(
    'narrowing on hasPid alone is not enough once SessionWithoutSessionId exists (D-023): the ' +
      'union still refuses processTerminationData without narrowing on hasSessionId too',
    () => {
      function narrowedOnlyByHasPid(session: DiscoveredSession): void {
        if (session.hasPid) {
          // @ts-expect-error D-023: `session` here is `SessionWithPid | SessionWithoutSessionId`
          // — hasPid alone doesn't get you back to SessionWithPid anymore, now that a second
          // PID-bearing shape exists. This is the regression this test exists to catch: before
          // S1-T10, `if (session.hasPid)` alone was sufficient, and a careless widening of
          // processTerminationData's parameter type could make this compile again by accident.
          processTerminationData(session);
        }
      }

      expect(narrowedOnlyByHasPid).toBeTypeOf('function');
    },
  );

  it('documented return type: exactly { pid, procStart }, nothing else', () => {
    const session: SessionWithPid = createSessionWithPid();

    const result = processTerminationData(session);

    expect(Object.keys(result).sort()).toStrictEqual(['pid', 'procStart']);
  });
});
