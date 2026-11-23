/**
 * Helpers de URL de capas servidas por repositórios abertos do GitHub.
 * Nenhum arquivo de jogo é armazenado no VGFA — apenas imagens de capa.
 */

/** Capas do PlayStation 2 (xlenore/ps2-covers) pelo serial NTSC-U, ex.: SLUS-21678. */
export const PS2_COVER = (serial: string): string =>
  `https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default/${serial}.jpg`;

/** Capas do PlayStation 1 (xlenore/psx-covers) pelo serial NTSC-U, ex.: SCUS-94163. */
export const PS1_COVER = (serial: string): string =>
  `https://raw.githubusercontent.com/xlenore/psx-covers/main/covers/default/${serial}.jpg`;
