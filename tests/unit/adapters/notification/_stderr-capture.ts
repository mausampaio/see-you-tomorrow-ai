/**
 * Captures every `process.stderr.write` call without `vi.spyOn` — that mock's return type resists
 * this project's strict `no-unsafe-*` lint rules on a Node stream's overloaded `write` signature.
 * Manual save/restore instead, shared by `chain.test.ts` and `stderr-backend.test.ts` (AGENTS.md §
 * "Nada de duplicação").
 */
export class StderrCapture {
  readonly writes: string[] = [];
  private readonly original = process.stderr.write.bind(process.stderr);

  install(): void {
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      this.writes.push(String(chunk));
      return true;
    };
  }

  restore(): void {
    process.stderr.write = this.original;
  }
}
