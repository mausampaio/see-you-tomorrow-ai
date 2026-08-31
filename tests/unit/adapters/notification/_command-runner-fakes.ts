/**
 * A named `CommandRunner` double (docs/TESTES.md: "duplo de I/O é classe/objeto nomeado
 * implementando a porta, não stub inline") — records every `(command, args)` call it received
 * instead of ever spawning a real process. This is the seam docs/PLANO-DE-ENTREGA.md S4-T1 asks
 * for: verifying "os argumentos montados, não o toast aparecendo" (docs/TESTES.md § `notification/`)
 * without ever starting a real `powershell.exe`/`notify-send`/`osascript` — none of which `npm
 * test` may show on the screen of whoever runs it.
 */
import type { CommandRunner, SpawnResult } from '../../../../src/adapters/notification/backend.js';

export interface RecordedCommandCall {
  readonly command: string;
  readonly args: readonly string[];
}

export class RecordingCommandRunner {
  readonly calls: RecordedCommandCall[] = [];

  constructor(private readonly result: SpawnResult = { exitCode: 0, stdout: '', stderr: '' }) {}

  run: CommandRunner = (command, args) => {
    this.calls.push({ command, args: [...args] });
    return Promise.resolve(this.result);
  };
}
