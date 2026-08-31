/**
 * One notification backend in Spike B's fallback chain (docs/spikes/B-notificacoes.md), and the
 * `CommandRunner` seam every real backend spawns its external command through.
 */
import { spawn } from 'node:child_process';
import type { Notice } from '../../core/ports.js';

/**
 * Declares its own availability instead of `ChainNotifier` (`chain.ts`) asking the OS directly —
 * the seam docs/PLANO-DE-ENTREGA.md S4-T1 asks for ("injete o detector de disponibilidade em vez
 * de perguntar ao SO no meio da lógica"), so the chain's own selection logic
 * (`ChainNotifier#notify`) is testable with fakes, on any OS the CI runs on — the S2-T1 lesson
 * applied here: a test that only passes on one OS hides a defect on the other two.
 */
export interface NotificationBackend {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /**
   * Always `false` today — no backend implements action buttons (docs/ESPECIFICACAO.md §
   * "Notificações": "ações vêm depois, se a validação [manual] se provar", S4-T1's contract is
   * title + body only). Reserved so a future backend that DOES support one can flip it without
   * changing this interface's shape (D-024: a bare boolean is honest while every implementation
   * agrees on the value; the day one doesn't, this needs to become a discriminated union instead).
   */
  supportsActions(): boolean;
  send(notice: Notice): Promise<void>;
}

export interface SpawnResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A backend's own hook to run its external command — injected so a test can verify exactly what
 * WOULD have been spawned (docs/TESTES.md § `notification/`: "verificar os argumentos montados,
 * não o toast aparecendo") without ever starting a real `powershell.exe`/`notify-send`/`osascript`.
 * Spike B is explicit that a test runner may not even have a notification session to receive one
 * ("em servidor sem sessão gráfica, nada disso existe") — and even where there is one, `npm test`
 * must never pop a real notification on the screen of whoever runs it. Defaults to `spawnCommand`
 * below in every real backend; only a test overrides it.
 */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<SpawnResult>;

/**
 * `shell: false`, array of arguments (AGENTS.md § "Processos") — the real implementation every
 * concrete backend uses by default. Not itself covered by a dedicated test: it is a thin,
 * structurally identical wrapper to `adapters/process/console-signal.ts#runPowerShellScript`,
 * which the process integration suite already exercises against a real `powershell.exe` — writing
 * a second real-process test here would prove the same generic spawn plumbing twice, not anything
 * specific to notification.
 */
export const spawnCommand: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
