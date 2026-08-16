/**
 * Apoio compartilhado da suíte de contrato (docs/TESTES.md § "Contrato"). Roda contra o
 * `~/.claude` REAL da máquina e o binário `claude` REAL do PATH — por isso só esta pasta pode
 * tocar essas coisas; nenhum outro teste do projeto pode (unidade/integração usam duplos e
 * `tmpdir`).
 *
 * Regra de ouro de CLAUDE.md: se algo aqui divergir da realidade, a resposta é registrar em
 * docs/QUESTOES.md com a saída bruta observada — nunca afrouxar a asserção para o teste passar.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Raiz real de `~/.claude` desta máquina. Só usada dentro de tests/contrato/. */
export function raizDoClaudeReal(): string {
  return join(homedir(), '.claude');
}

/**
 * Executa `claude` com um array de argumentos, `shell: false` (mesma regra de processo que vale
 * para o produto — CLAUDE.md § Processos). Só usar aqui com subcomandos locais e baratos
 * (`--help`, `--version`, `agents --json`): nenhum teste deste projeto pode chamar a API de
 * verdade.
 */
export function executarClaude(argumentos: readonly string[]): {
  codigoDeSaida: number | null;
  saida: string;
  erro: string;
} {
  const resultado = spawnSync('claude', argumentos, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  });

  if (resultado.error) {
    throw new Error(
      `Não foi possível executar \`claude ${argumentos.join(' ')}\`. A suíte de contrato ` +
        `exige o binário \`claude\` no PATH desta máquina. Erro original: ${resultado.error.message}`,
    );
  }

  return {
    codigoDeSaida: resultado.status,
    saida: resultado.stdout ?? '',
    erro: resultado.stderr ?? '',
  };
}

/**
 * Versão do Claude Code contra a qual a suíte de contrato está rodando agora. docs/TESTES.md
 * exige registrar isso na saída de toda execução — o Spike D provou que 2.1.201 e 2.1.233
 * coexistem na mesma máquina (CLI do PATH × extensão do VS Code) e se comportam diferente, então
 * "contrato verde" sem a versão anotada não prova nada.
 *
 * Chamada por cada arquivo de teste e embutida no nome do `describe` — útil para saber de qual
 * versão veio uma falha específica, ou ao rodar com `--reporter=verbose`. **Isso sozinho não
 * garante visibilidade no caminho feliz**: o reporter padrão do vitest não imprime nome de teste
 * quando tudo passa (medido pelo review de S0-T5 — era o que este comentário afirmava antes,
 * errado). A garantia de verdade vem de `tests/contrato/_versao-global-setup.ts`, que escreve a
 * versão direto no stdout antes da suíte rodar, fora do controle de qualquer reporter.
 */
export function obterVersaoDoClaudeCode(): string {
  const resultado = executarClaude(['--version']);

  if (resultado.codigoDeSaida !== 0) {
    throw new Error(
      `\`claude --version\` saiu com código ${String(resultado.codigoDeSaida)}. ` +
        `stdout: ${resultado.saida} stderr: ${resultado.erro}`,
    );
  }

  const versao = resultado.saida.trim();
  if (versao.length === 0) {
    throw new Error('`claude --version` não devolveu nada em stdout.');
  }

  return versao;
}

/**
 * Caminho do binário `claude` resolvido pelo PATH desta máquina, usado só pelo teste que precisa
 * inspecionar o binário diretamente (a existência de `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` não
 * é exposta por nenhum comando local — nem `--help` nem `doctor` a documentam de propósito, é
 * mecanismo interno achado no Spike D por inspeção do binário).
 */
export function localizarBinarioClaude(): string {
  const comando = process.platform === 'win32' ? 'where' : 'which';
  const resultado = spawnSync(comando, ['claude'], { encoding: 'utf8', shell: false });

  if (resultado.status !== 0 || resultado.stdout.trim().length === 0) {
    throw new Error(
      `Não foi possível localizar o binário \`claude\` no PATH via \`${comando} claude\`. ` +
        `stdout: ${resultado.stdout} stderr: ${resultado.stderr}`,
    );
  }

  // `where` no Windows pode listar mais de um caminho, um por linha; o primeiro é o que o shell
  // de fato resolve e executa.
  const primeiraLinha = resultado.stdout.trim().split(/\r?\n/)[0];
  if (primeiraLinha === undefined) {
    throw new Error('`where`/`which claude` devolveu saída vazia após split.');
  }

  return primeiraLinha;
}

/**
 * Lê o binário `claude` do disco como bytes crus e verifica se um marcador de texto aparece
 * literalmente nele. É uma técnica frágil — funciona para o executável nativo empacotado
 * (`claude install`), que é o que esta máquina tem (confirmado: PE de ~320 MB), mas pode não
 * encontrar nada se a instalação for um shim fino (ex. `.cmd` do npm apontando para um `.js`
 * separado) cujo bundle real fique em outro arquivo. Por isso o teste que usa isto reporta a
 * saída bruta em vez de decidir sozinho o que fazer quando não encontra — ver
 * tests/contrato/variavel-de-persistencia.teste.ts.
 */
export function binarioContemTexto(caminhoDoBinario: string, textoProcurado: string): boolean {
  const bytes = readFileSync(caminhoDoBinario);
  return bytes.includes(textoProcurado);
}
