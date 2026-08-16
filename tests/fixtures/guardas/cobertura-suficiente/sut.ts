/** Idêntico a ../cobertura-abaixo-do-limite/sut.ts — só o teste ao lado muda. */
export function escolher(um: boolean): string {
  if (um) {
    return 'a';
  }
  return 'b';
}
