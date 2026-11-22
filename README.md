# VIDEO GAME FOR ALL — VGFA

> **Loja e Plataforma Web Multi-Console (Atari 2600 ao PlayStation 2)** — com **Capas e Fichas Reais**, **Emuladores WebAssembly Reais**, **Celular como Controle Adaptativo (QR Code)**, **Bluetooth Gamepad API**, **Proxy CORS-Free / Streaming de Disco (`@vgfa/disc`)**, **Saves em IndexedDB** e **Multi-idioma (PT-BR / EN / ES)**.

---

## Novidades da v0.7 — "Prisma"

- **Visual Liquid Glass "Prisma"** do zero: home com destaque cinematográfico, linhas de cards, abas Início · Loja · Minha Central · Controle, tema escuro/claro, ícone e apresentação novos, modo leve automático em aparelhos fracos.
- **VGFA Link — controle do celular sem servidor:** pareamento por brokers MQTT públicos (EMQX/Mosquitto) direto do GitHub Pages; os botões funcionam pelo relé em ~2 s e sobem sozinhos para WebRTC direto. Se a rede bloquear o P2P, o controle continua pela internet.
- **Controles corrigidos:** o celular manda o **estado completo** dos botões (30x/s apertado, 3x/s parado) e o emulador recebe o estado de cada jogador e se corrige sozinho — acabou o "funcionou no começo e depois parou". Deslizar o dedo entre botões (B→A), direcional com diagonais, tela sempre acesa, solta tudo ao bloquear o celular, e o celular volta como o **mesmo jogador** ao reconectar. O código da sala sobrevive a recarregar a página.
- **VGFA-Cast sem servidor:** o erro "Falha ao conectar no servidor VGFA-Cast" no GitHub Pages foi resolvido usando o mesmo VGFA Link.
- **Minha Central:** jogos ficam guardados no aparelho de quem joga (IndexedDB em pedaços de 8 MiB), abrem de novo sem baixar, com medidor de espaço, "Proteger meus jogos", apagar jogo a jogo, "Liberar tudo" e limpeza dos discos PS2 em cache.
- **Desempenho:** telas do jogo/controle carregadas sob demanda (JS inicial ~80 kB menor), sem re-render da tela do jogo a cada pacote do controle.

## O que já está funcionando (v0.5)

- **Loja / Catálogo VGFA com 53 Títulos e Capas Reais:**
  - **44 Clássicos Lendários** do Atari 2600 ao PlayStation 2 (*Dragon Ball Z: Budokai Tenkaichi 3*, *GTA: San Andreas*, *God of War II*, *Resident Evil 4*, *Gran Turismo 4*, *Shadow of the Colossus*, *Super Mario World*, *Chrono Trigger*, *Crash Bandicoot*, *Super Mario 64*, *Sonic 2*, *Pokémon Emerald*, *River Raid* e mais) com capa real, nota, ano, desenvolvedora, sinopse, serial (`SLUS-21678`) e **Smart Find** (filtra itens bloqueados/privados, valida HTTP 200/206 em tempo real e destaca a `⭐ Melhor Opção`).
  - **9 ROMs Reais Grátis & Open-Source (1 Clique)** rodando imediatamente em emuladores WebAssembly reais (**Snes9x**, **FCEUmm**, **mGBA**, **Genesis Plus GX** e **Stella**).
- **Motor Multi-Console Unificado (Atari 2600 → PlayStation 2):**
  - **Atari 2600, NES, Mega Drive, SNES, GBA, Nintendo 64, PS1 e PSP:** motor unificado `VGFA-FastBoot` (EmulatorJS WebAssembly com cache local em IndexedDB, áudio desbloqueado no Safari/Chrome e injeção direta do controle pelo celular).
  - **PlayStation 2 — Arquitetura Dual Engine + VGFA Hyper-Stream:**
    - **⚡ VGFA-PS2 Turbo WebGPU (50–60 FPS no Chrome/Edge):** núcleo `PCSX2 WebAssembly` (EE/IOP/VU1 JIT + renderizador WebGPU HW com upscale 1x/2x/3x HD) em mesma origem (`/api/ps2-turbo/*`), alimentado direto pelo **VGFA Hyper-Stream** (sem baixar a ISO inteira!) + cofre local de BIOS em IndexedDB (1 única vez) + DualShock 2 analógico completo.
    - **🚀 VGFA-PS2 Instantâneo Sem BIOS:** núcleo `Play.wasm` em mesma origem (`/api/ps2-core/*`) acoplado ao streaming de 1 MiB × 4x prefetch + cache LRU 96 MiB para teste imediato sem BIOS.
    - **VGFA Hyper-Stream (`/api/proxy/stream`):** cache de blocos alinhados de **2 MiB em NVMe** + deduplicação in-flight + **prefetch paralelo 4x (6 MiB à frente)** para eliminar travamentos de rede em ISOs de 4 GB.
    - **Pipeline AOT (Zero-BIOS 60 FPS nativo):** [vgfa-ps2-recomp-pipeline.sh](scripts/vgfa-ps2-recomp-pipeline.sh).
- **📡 VGFA-Cast — Cloud Gaming P2P em 60 FPS (`/watch/:castCode`):**
  - Transforme seu PC/Mac em um servidor pessoal de Cloud Gaming: clique em **Transmitir 60 FPS** dentro de qualquer jogo para gerar um link/QR WebRTC. Qualquer amigo (mesmo em um celular simples ou iPhone Safari) abre o link, baixa **0 MB**, vê vídeo em 60 FPS e joga pelo controle virtual enviando comandos binários de 16 bytes de volta!
- **🌐 Link Público Mundial + Deploy 24/7 em Porta Única:**
  - Botão **🌐 Link Público** na barra superior gera um link **HTTPS seguro** instantâneo (Cloudflare Quick Tunnel) com WebSocket unificado em `/ws` — funciona pelo 4G/5G em qualquer lugar do mundo.
  - Pronto para hospedagem 24h em **Render**, **Fly.io**, **Railway** ou VPS usando o [Dockerfile](Dockerfile) ou `pnpm build && pnpm start:prod` (porta única com headers `COOP: same-origin` e `COEP: require-corp`).
- **Controle Adaptativo Inteligente (Desktop + Mobile Nativo):**
  - **No PC / TV:** tela pré-jogo para parear **Bluetooth / USB** (Gamepad API) ou ler **QR Code** no celular (`/pad/:roomCode`) com protocolo binário de 16 bytes e 9 skins automáticas (Atari CX40 → DualShock 2).
  - **No Celular:** detecção automática de smartphone com controle virtual ergonômico dedicado (sem sobrepor o jogo em retrato; laterais translúcidas em paisagem).

---

## Arquitetura do Monorepo

Veja o relatório técnico da Fase 0 em [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md) e a especificação dos protocolos em [docs/VGFA_PROTOCOL.md](docs/VGFA_PROTOCOL.md).

```
video-game-for-all/
├── docs/                      # Análise de engenharia reversa + especificações VGFA-Disc & VGFA-Pad
├── packages/
│   ├── vgfa-disc/             # Streaming VirtualChunkedDisc (HTTP Range + WebTorrent P2P + OPFS Sharded + ISO9660 + SAB 64-bit)
│   ├── vgfa-pad/              # Codec binário 16-byte + 9 layouts adaptativos + Gamepad API + WebRTC/WS Host & Client
│   ├── vgfa-storage/          # IndexedDB Save States + Memory Cards PS1 (.mcr) e PS2 8 MB (.ps2) + Contas/Perfis
│   └── vgfa-runtime/          # Loja (52 títulos) + Emuladores WASM (RetroArch + EmulatorJS) + Ponte PS2 WebGPU
├── apps/
│   ├── signaling-server/      # Salas WebSocket/WebRTC + IP LAN automático + Proxy CORS-Free + API Internet Archive
│   └── web/                   # Portal Loja VGFA (React + Vite + COOP/COEP + rota mobile /pad/:roomCode)
└── scripts/
    ├── dev.mjs
    └── vgfa-ps2-recomp-pipeline.sh
```

---

## Como Rodar Localmente

Requisitos: **Node.js >= 20** e **pnpm >= 9**.

```bash
pnpm install
pnpm test
pnpm dev
```

- **Loja & Player:** abra `http://localhost:5173`
- **Celular como Controle:** clique em **Celular como Controle** dentro de qualquer jogo e escaneie o QR Code na mesma rede Wi-Fi.

---

## Política Legal & Repositório Limpo

Este repositório contém **100% código próprio (MIT)** e metadados/capas de repositórios abertos. **Nenhuma ROM ou ISO comercial protegida por direitos autorais é hospedada ou distribuída neste repositório.** Para jogos comerciais, use suas cópias pessoais (BYOD) ou fontes próprias configuradas localmente.
