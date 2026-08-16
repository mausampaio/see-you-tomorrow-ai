import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  esquemaEntradaAssistant,
  esquemaEntradaUser,
} from '../../src/adaptadores/transcricao/esquemas.js';
import { obterVersaoDoClaudeCode, raizDoClaudeReal } from './_apoio.js';

const versao = obterVersaoDoClaudeCode();

/** Varre `~/.claude/projects/**​/*.jsonl` recursivamente, sem depender de nenhum parser do projeto. */
function listarTranscriptsReais(): string[] {
  const raizDeProjetos = join(raizDoClaudeReal(), 'projects');
  const resultado: string[] = [];

  const visitar = (pasta: string): void => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome);
      const info = statSync(caminho);
      if (info.isDirectory()) {
        visitar(caminho);
      } else if (nome.endsWith('.jsonl')) {
        resultado.push(caminho);
      }
    }
  };

  visitar(raizDeProjetos);
  return resultado;
}

/**
 * docs/TESTES.md § Contrato, item 2: "O `.jsonl` real tem entradas `user` e `assistant` com os
 * campos que o parser usa." Não roda no CI padrão — só via `npm run test:contrato`.
 */
describe(`contrato: transcript .jsonl real (claude ${versao})`, () => {
  it('encontra e valida entradas user e assistant reais em pelo menos um transcript', () => {
    const transcripts = listarTranscriptsReais();

    expect(
      transcripts.length,
      `Nenhum .jsonl em ${join(raizDoClaudeReal(), 'projects')}. A suíte de contrato precisa de ` +
        'pelo menos um transcript real para confirmar o schema — use o Claude Code normalmente ' +
        'antes de rodar `npm run test:contrato`.',
    ).toBeGreaterThan(0);

    let totalUser = 0;
    let totalAssistant = 0;

    for (const caminho of transcripts) {
      const linhas = readFileSync(caminho, 'utf8').split('\n');

      for (const linha of linhas) {
        const linhaAparada = linha.trim();
        if (linhaAparada.length === 0) {
          continue;
        }

        let entrada: unknown;
        try {
          entrada = JSON.parse(linhaAparada);
        } catch {
          // Linha truncada (o Claude Code pode estar escrevendo). O contrato só valida os tipos
          // que conhece; linha ilegível é assunto do parser de verdade (S1-T4), não deste teste.
          continue;
        }

        if (typeof entrada !== 'object' || entrada === null || !('type' in entrada)) {
          continue;
        }

        const tipo = entrada.type;

        if (tipo === 'user') {
          const resultado = esquemaEntradaUser.safeParse(entrada);
          if (!resultado.success) {
            throw new Error(
              `esquemaEntradaUser rejeitou uma entrada "user" real em ${caminho}. A realidade ` +
                'mudou — registre em docs/QUESTOES.md com esta saída bruta, não afrouxe o schema.' +
                `\n\nConteúdo observado: ${linhaAparada}\n\n` +
                `Erros do zod: ${JSON.stringify(resultado.error.issues, null, 2)}`,
            );
          }
          totalUser += 1;
        } else if (tipo === 'assistant') {
          const resultado = esquemaEntradaAssistant.safeParse(entrada);
          if (!resultado.success) {
            throw new Error(
              `esquemaEntradaAssistant rejeitou uma entrada "assistant" real em ${caminho}. A ` +
                'realidade mudou — registre em docs/QUESTOES.md com esta saída bruta, não ' +
                `afrouxe o schema.\n\nConteúdo observado: ${linhaAparada}\n\n` +
                `Erros do zod: ${JSON.stringify(resultado.error.issues, null, 2)}`,
            );
          }
          totalAssistant += 1;
        }
        // Tipo fora de "user"/"assistant": ignorado de propósito, é exatamente o comportamento
        // tolerante que se quer (docs/ARQUITETURA.md § transcricao/).
      }
    }

    expect(
      totalUser,
      'Nenhuma entrada "user" real encontrada em nenhum transcript — não dá para confirmar o ' +
        'schema contra a realidade.',
    ).toBeGreaterThan(0);
    expect(
      totalAssistant,
      'Nenhuma entrada "assistant" real encontrada em nenhum transcript — não dá para confirmar ' +
        'o schema contra a realidade.',
    ).toBeGreaterThan(0);
  });
});
