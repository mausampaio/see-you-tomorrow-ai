#!/usr/bin/env node
// Guard de pre-commit: recusa o commit se o conteúdo em stage contiver algum termo listado
// em `.termos-locais`.
//
// Por que existe: parte do contexto que motiva as decisões deste projeto vem de ambientes que
// não são este repositório — nomes de ferramentas de terceiros, caminhos, identificadores. Esse
// material é útil para decidir e não deve ser publicado. Documentar bem e publicar são decisões
// separadas, e é fácil tratar como uma só quando se está escrevendo rápido.
//
// Como usar: crie `.termos-locais` na raiz, um termo por linha. O arquivo é ignorado pelo git —
// os termos nunca saem da máquina. Linhas vazias e começadas com `#` são ignoradas. Se o arquivo
// não existir, este guard não faz nada, então clones de outras pessoas não são afetados.
//
// A comparação é case-insensitive e por substring, de propósito: é melhor barrar um commit
// legítimo de vez em quando do que deixar passar um termo por diferença de caixa.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO_DE_TERMOS = path.join(raizDoRepo, '.termos-locais');

/** @returns {string[]} */
function lerTermos() {
  if (!existsSync(ARQUIVO_DE_TERMOS)) {
    return [];
  }
  return readFileSync(ARQUIVO_DE_TERMOS, 'utf8')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0 && !linha.startsWith('#'));
}

/**
 * Conteúdo que está sendo ADICIONADO em stage, mais os nomes dos arquivos (um caminho pode vazar
 * tanto quanto o texto).
 *
 * Só as linhas `+` do diff, nunca as `-`. Ao remover um dado que não deveria estar publicado, o
 * diff necessariamente contém o valor antigo na linha removida — checar o diff inteiro faria o
 * guard impedir a própria limpeza. Isso aconteceu de verdade na primeira versão deste script.
 */
function conteudoEmStage() {
  const diff = spawnSync('git', ['diff', '--cached', '--unified=0'], {
    cwd: raizDoRepo,
    encoding: 'utf8',
    shell: false,
  });
  const nomes = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: raizDoRepo,
    encoding: 'utf8',
    shell: false,
  });
  if (diff.status !== 0 || nomes.status !== 0) {
    // Não dá para verificar: falha fechada. Um guard que se rende em silêncio não é guard.
    console.error('Não foi possível ler o conteúdo em stage para verificar os termos locais.');
    process.exitCode = 1;
    return null;
  }
  const linhasAdicionadas = diff.stdout
    .split(/\r?\n/)
    .filter((linha) => linha.startsWith('+') && !linha.startsWith('+++'))
    .join('\n');
  return `${linhasAdicionadas}\n${nomes.stdout}`;
}

/**
 * Padrões que têm forma de vazamento, independente de qualquer lista. A lista de termos só
 * conhece o que já vazou uma vez; estes padrões pegam o próximo, que ninguém previu.
 *
 * Este projeto é de código aberto: tudo aqui é lido por qualquer pessoa, para sempre. Caminho
 * de home, endereço de e-mail e identificador de sessão real não acrescentam nada a quem lê e
 * não têm como ser retirados depois que saem.
 */
const PADROES_SUSPEITOS = [
  {
    nome: 'caminho de home com usuário real',
    // Aceita placeholder entre <> ou ~, recusa nome de usuário literal.
    regex: /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)(?!<)[A-Za-z0-9._%+-]{2,}/g,
  },
  {
    nome: 'endereço de e-mail',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    nome: 'UUID de aparência real',
    // Um UUID de exemplo deve ser obviamente falso: só dígitos repetidos e letras em sequência.
    // Este padrão casa qualquer UUID e a filtragem de falsos positivos vem depois.
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
];

/**
 * UUIDs que são constantes públicas conhecidas, não identificadores de ninguém. Cada entrada
 * precisa de um comentário dizendo de onde vem — sem isso, esta lista vira um lugar para
 * silenciar avisos.
 */
const UUIDS_PUBLICOS = new Set([
  // AppUserModelID do PowerShell, usado como remetente de toast no Windows (Spike B).
  '1ac14e77-02e7-4e5d-b744-2eb1ae5198b7',
]);

/**
 * Um UUID de exemplo é aceitável se for obviamente sintético: no máximo 4 símbolos distintos.
 * Ex.: `11111111-1111-4111-8111-111111111111` tem 3 (`1`, `4`, `8`).
 * @param {string} uuid
 * @returns {boolean}
 */
function pareceSintetico(uuid) {
  const distintos = new Set(uuid.toLowerCase().replace(/-/g, ''));
  return distintos.size <= 4;
}

/**
 * @param {string} conteudo
 * @returns {{ nome: string, valor: string }[]}
 */
function acharPadroesSuspeitos(conteudo) {
  /** @type {{ nome: string, valor: string }[]} */
  const achados = [];
  for (const { nome, regex } of PADROES_SUSPEITOS) {
    for (const ocorrencia of conteudo.matchAll(regex)) {
      const valor = ocorrencia[0];
      if (nome === 'UUID de aparência real') {
        if (UUIDS_PUBLICOS.has(valor.toLowerCase()) || pareceSintetico(valor)) {
          continue;
        }
      }
      achados.push({ nome, valor });
    }
  }
  return achados;
}

/**
 * @param {string} titulo
 * @param {string[]} itens
 * @param {string} orientacao
 */
function reportar(titulo, itens, orientacao) {
  console.error('');
  console.error(`Commit recusado: ${titulo}`);
  console.error('');
  for (const item of itens) {
    console.error(`  - ${item}`);
  }
  console.error('');
  console.error(orientacao);
  console.error('');
}

function main() {
  const conteudo = conteudoEmStage();
  if (conteudo === null) {
    return;
  }

  const termos = lerTermos();
  const conteudoMinusculo = conteudo.toLowerCase();
  const termosEncontrados = termos.filter((termo) =>
    conteudoMinusculo.includes(termo.toLowerCase()),
  );

  if (termosEncontrados.length > 0) {
    reportar(
      'o conteúdo em stage contém termo listado em .termos-locais.',
      termosEncontrados,
      'Reescreva o trecho de forma genérica antes de commitar. Se o termo é legítimo aqui,\n' +
        'remova-o de .termos-locais — mas remova por decisão, nunca por pressa.',
    );
    process.exitCode = 1;
    return;
  }

  const suspeitos = acharPadroesSuspeitos(conteudo);
  if (suspeitos.length > 0) {
    reportar(
      'o conteúdo em stage tem forma de dado que não deveria ser publicado.',
      [...new Set(suspeitos.map(({ nome, valor }) => `${nome}: ${valor}`))],
      'Troque por um placeholder — `<usuario>`, `~`, ou um UUID obviamente sintético.\n' +
        'Se for constante pública, acrescente a UUIDS_PUBLICOS neste script, com um comentário\n' +
        'dizendo de onde ela vem.',
    );
    process.exitCode = 1;
  }
}

main();
