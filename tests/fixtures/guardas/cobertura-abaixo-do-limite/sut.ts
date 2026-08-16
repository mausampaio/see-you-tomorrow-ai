/**
 * Sujeito de teste minúsculo, só para a fixture de S0-T2. Tem um ramo de propósito não coberto
 * pelo teste ao lado, para provar que o limite de cobertura reprova.
 */
export function escolher(um: boolean): string {
  if (um) {
    return 'a';
  }
  return 'b';
}
