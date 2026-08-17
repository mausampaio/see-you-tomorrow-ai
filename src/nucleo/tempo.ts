/**
 * Comparações puras entre instantes. Não confundir com a porta `Relogio` (`nucleo/portas.ts`):
 * `Relogio` responde "que horas são" (a única pergunta não-determinística permitida, D-019) — as
 * funções daqui só comparam valores de `Date` que o chamador já tem, o que é transformação
 * determinística de dado, sempre permitida fora de `adaptadores/relogio/` (D-019).
 */

/**
 * Dois instantes são o mesmo ponto no tempo? `null` só é igual a `null` (os dois representam
 * "sem transcript" / "sem valor conhecido" — D-013) — nunca igual a um `Date`, mesmo que esse
 * `Date` viesse a coincidir numericamente com época zero ou outro valor especial.
 */
export function mesmoInstante(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}
