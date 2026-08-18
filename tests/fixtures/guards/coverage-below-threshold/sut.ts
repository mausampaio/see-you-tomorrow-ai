/**
 * Tiny test subject, only for the S0-T2 fixture. Has a branch left uncovered on purpose by the
 * test next to it, to prove the coverage threshold rejects.
 */
export function choose(one: boolean): string {
  if (one) {
    return 'a';
  }
  return 'b';
}
