/**
 * Comparação pura de "assinatura da evidência" — o que a anti-duplicidade da elegibilidade usa
 * (D-026, `nucleo/elegibilidade.ts`).
 */

/**
 * Um token comparável por fonte de evidência (D-013: git, transcript, registro). `null` quando
 * aquela fonte não respondeu naquele momento. O formato de cada token (data ISO, sha de commit,
 * hash de estado) é decidido por quem monta a assinatura — fora do núcleo, porque depende de
 * fontes que ainda não existem aqui (git só chega em S2-T1) ou de I/O (mtime do transcript). Este
 * tipo só declara a forma que a comparação pura precisa: um mapa de nome de fonte para token.
 */
export type AssinaturaDeEvidencia = Readonly<Record<string, string | null>>;

/**
 * Duas assinaturas representam a mesma evidência? Usada pela anti-duplicidade (D-026): uma
 * sessão só é "duplicada" quando **nenhuma** fonte mudou desde a última captura de hoje.
 *
 * Regra por fonte, chave a chave, unindo as chaves presentes nas duas assinaturas:
 * - As duas ausentes (`null` nos dois lados) — essa fonte não decide nada; o julgamento passa às
 *   demais (mesmo princípio de D-025: ausência de dado não vira afirmação positiva — aqui
 *   aplicado por fonte, não à assinatura inteira).
 * - Um valor presente e o outro ausente, ou os dois presentes mas diferentes — a fonte mudou:
 *   a assinatura inteira já não é a mesma, sem precisar olhar as chaves restantes.
 * - As duas presentes e iguais — essa fonte confirma que não mudou.
 *
 * **Resultado só é `true` com pelo menos uma fonte confirmando positivamente.** Se toda fonte
 * comparável está ausente nos dois lados (nada para comparar), o resultado é `false` — mesma
 * razão de D-025: nenhuma regra do domínio converte "não sei" em "sim, é igual".
 */
export function mesmaEvidencia(
  anterior: AssinaturaDeEvidencia,
  atual: AssinaturaDeEvidencia,
): boolean {
  const fontes = new Set([...Object.keys(anterior), ...Object.keys(atual)]);
  let houveFonteQueConfirmou = false;

  for (const fonte of fontes) {
    const valorAnterior = anterior[fonte] ?? null;
    const valorAtual = atual[fonte] ?? null;

    if (valorAnterior === null && valorAtual === null) {
      continue;
    }

    if (valorAnterior !== valorAtual) {
      return false;
    }

    houveFonteQueConfirmou = true;
  }

  return houveFonteQueConfirmou;
}
