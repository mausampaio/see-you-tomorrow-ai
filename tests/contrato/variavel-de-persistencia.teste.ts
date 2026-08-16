import { describe, expect, it } from 'vitest';
import { binarioContemTexto, localizarBinarioClaude, obterVersaoDoClaudeCode } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/**
 * docs/TESTES.md § Contrato, item 5: "`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` ainda é reconhecida
 * pela versão instalada." D-017 e D-018 dependem dessa variável para corrigir a supressão de
 * transcript (Spike D). Não existe comando local que documente a variável — nem `--help` nem
 * `doctor` a expõem de propósito, é mecanismo interno. A única forma sem tocar rede é a mesma
 * usada no Spike D: procurar o texto literal no binário instalado. Não roda no CI padrão — só
 * via `npm run test:contrato`.
 */
describe(`contrato: CLAUDE_CODE_FORCE_SESSION_PERSISTENCE (claude ${versao})`, () => {
  it('o binário claude do PATH reconhece a variável de ambiente', () => {
    const caminhoDoBinario = localizarBinarioClaude();
    const encontrado = binarioContemTexto(
      caminhoDoBinario,
      'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
    );

    expect(
      encontrado,
      `O binário em ${caminhoDoBinario} (claude ${versao}) não contém o texto literal ` +
        '"CLAUDE_CODE_FORCE_SESSION_PERSISTENCE". Ou a variável mudou de nome/mecanismo entre ' +
        'versões, ou este binário é um shim fino que não contém o bundle real (ver comentário ' +
        'em tests/contrato/_apoio.ts). Registre em docs/QUESTOES.md com o caminho e o resultado ' +
        'observados antes de mudar D-017/D-018.',
    ).toBe(true);
  });
});
