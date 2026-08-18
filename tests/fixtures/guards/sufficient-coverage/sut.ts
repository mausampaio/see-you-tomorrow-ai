/** Identical to ../coverage-below-threshold/sut.ts — only the test next to it changes. */
export function choose(one: boolean): string {
  if (one) {
    return 'a';
  }
  return 'b';
}
