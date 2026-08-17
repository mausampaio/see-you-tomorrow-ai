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

function lerTermos() {
  if (!existsSync(ARQUIVO_DE_TERMOS)) {
    return [];
  }
  return readFileSync(ARQUIVO_DE_TERMOS, 'utf8')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0 && !linha.startsWith('#'));
}

/** Conteúdo que está em stage, incluindo os nomes dos arquivos (um caminho pode vazar tanto quanto o texto). */
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
  return `${diff.stdout}\n${nomes.stdout}`;
}

function main() {
  const termos = lerTermos();
  if (termos.length === 0) {
    return;
  }

  const conteudo = conteudoEmStage();
  if (conteudo === null) {
    return;
  }

  const conteudoMinusculo = conteudo.toLowerCase();
  const encontrados = termos.filter((termo) => conteudoMinusculo.includes(termo.toLowerCase()));

  if (encontrados.length === 0) {
    return;
  }

  console.error('');
  console.error('Commit recusado: o conteúdo em stage contém termo listado em .termos-locais.');
  console.error('');
  for (const termo of encontrados) {
    console.error(`  - ${termo}`);
  }
  console.error('');
  console.error('Reescreva o trecho de forma genérica antes de commitar. Se o termo é legítimo');
  console.error('aqui, remova-o de .termos-locais — mas remova por decisão, nunca por pressa.');
  console.error('');
  process.exitCode = 1;
}

main();
