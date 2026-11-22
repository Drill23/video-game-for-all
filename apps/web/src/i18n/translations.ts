import type { SupportedLang } from '@vgfa/storage';

export interface Dictionary {
  appSubtitle: string;
  heroKicker: string;
  heroTitle: string;
  heroDesc: string;
  playNow: string;
  openPs2Lab: string;
  connectPhone: string;
  phonePadMode: string;
  saves: string;
  signIn: string;
  signOut: string;
  allConsoles: string;
  builtinTitle: string;
  builtinSub: string;
  byodTitle: string;
  byodSub: string;
  archiveTitle: string;
  archiveSub: string;
  searchPlaceholder: string;
  searchBtn: string;
  dropRomLabel: string;
  streamUrlPlaceholder: string;
  mountStreamBtn: string;
  playGame: string;
  backHome: string;
  saveState: string;
  loadState: string;
  bluetoothReady: string;
  noBluetoothYet: string;
  qrTitle: string;
  qrHint: string;
  openPadTab: string;
  roomCode: string;
  connectedPads: string;
  ps2DiagTitle: string;
  footerCredit: string;
}

export const TRANSLATIONS: Record<SupportedLang, Dictionary> = {
  'pt-BR': {
    appSubtitle: 'Atari ao PlayStation 2 no Navegador',
    heroKicker: 'VGFA Engine • WebGPU + WASM + P2P Streaming',
    heroTitle: 'Videogame para todos, direto no navegador — com seu celular virando o controle.',
    heroDesc:
      'Jogue clássicos do Atari 2600 ao PlayStation 2 sem instalar nada. Conecte seu controle Bluetooth ou escaneie o QR Code para transformar o celular no controle exato de cada console, com streaming de disco sob demanda e saves locais persistentes.',
    playNow: 'Jogar Agora',
    openPs2Lab: 'Abrir Motor PS2 WebGPU',
    connectPhone: 'Celular como Controle',
    phonePadMode: 'Modo Controle',
    saves: 'Saves & Memory Cards',
    signIn: 'Entrar / Conta',
    signOut: 'Sair',
    allConsoles: 'Todos os Consoles',
    builtinTitle: 'Clássicos Leves Embutidos (1 Clique)',
    builtinSub: 'Rodam instantaneamente a 60 FPS e aceitam Teclado, Bluetooth e Celular QR Code',
    byodTitle: 'Carregar Sua ROM / ISO ou Streaming Remoto',
    byodSub: 'Arquivo local (zero upload) ou URL com HTTP Range / WebSeed — suporta Atari → PS2',
    archiveTitle: 'Pesquisa Ao Vivo no Internet Archive',
    archiveSub: 'Pesquise acervos públicos e homebrews direto pelo navegador, sem armazenar no servidor',
    searchPlaceholder: 'Ex.: space invaders, homebrew, nes, atari...',
    searchBtn: 'Pesquisar',
    dropRomLabel: 'Escolher ROM / ISO (.a26, .nes, .sfc, .md, .gba, .z64, .iso, .chd)',
    streamUrlPlaceholder: 'https://servidor/jogo.iso (HTTP Range / WebSeed)',
    mountStreamBtn: 'Montar Streaming',
    playGame: 'Jogar',
    backHome: 'Voltar ao Catálogo',
    saveState: 'Salvar Estado',
    loadState: 'Carregar Estado',
    bluetoothReady: 'Controle Bluetooth Conectado',
    noBluetoothYet: 'Aperte qualquer botão no seu controle Bluetooth para parear',
    qrTitle: 'Transforme seu Celular em Controle',
    qrHint:
      'Aponte a câmera do celular para o QR Code (na mesma rede Wi-Fi) ou digite o código da sala. O controle se adapta automaticamente do Atari ao DualShock 2 do PS2.',
    openPadTab: 'Testar Controle nesta Máquina (Nova Aba)',
    roomCode: 'Código da Sala',
    connectedPads: 'Controles Conectados',
    ps2DiagTitle: 'Diagnóstico do Motor VGFA-PS2 (WebGPU + WASM + Disc Streaming)',
    footerCredit: 'VIDEO GAME FOR ALL (VGFA) • Código Aberto MIT • Sem ROMs proprietárias no repositório',
  },
  en: {
    appSubtitle: 'Atari to PlayStation 2 in the Browser',
    heroKicker: 'VGFA Engine • WebGPU + WASM + P2P Streaming',
    heroTitle: 'Video games for everyone in the browser — turn your phone into the controller.',
    heroDesc:
      'Play classics from Atari 2600 to PlayStation 2 with zero installation. Pair any Bluetooth gamepad or scan the QR Code to morph your smartphone into the exact console controller, powered by chunked disc streaming and local persistent saves.',
    playNow: 'Play Now',
    openPs2Lab: 'Open PS2 WebGPU Engine',
    connectPhone: 'Phone as Controller',
    phonePadMode: 'Controller Mode',
    saves: 'Saves & Memory Cards',
    signIn: 'Sign In',
    signOut: 'Sign Out',
    allConsoles: 'All Consoles',
    builtinTitle: 'Built-in Lightweight Classics (1-Click)',
    builtinSub: 'Instant 60 FPS play with Keyboard, Bluetooth Gamepad, and QR Smartphone Controller',
    byodTitle: 'Load Your ROM / ISO or Remote Stream',
    byodSub: 'Local file (zero upload) or HTTP Range / WebSeed URL — supports Atari → PS2',
    archiveTitle: 'Live Internet Archive Search',
    archiveSub: 'Search public software & homebrew collections directly in your browser',
    searchPlaceholder: 'e.g. space invaders, homebrew, nes, atari...',
    searchBtn: 'Search',
    dropRomLabel: 'Pick ROM / ISO (.a26, .nes, .sfc, .md, .gba, .z64, .iso, .chd)',
    streamUrlPlaceholder: 'https://server/game.iso (HTTP Range / WebSeed)',
    mountStreamBtn: 'Mount Stream',
    playGame: 'Play',
    backHome: 'Back to Library',
    saveState: 'Save State',
    loadState: 'Load State',
    bluetoothReady: 'Bluetooth Gamepad Connected',
    noBluetoothYet: 'Press any button on your Bluetooth controller to pair',
    qrTitle: 'Turn Your Phone into a Gamepad',
    qrHint:
      'Scan the QR Code with your phone camera (on the same Wi-Fi) or enter the room code. The layout adapts automatically from Atari to PS2 DualShock 2.',
    openPadTab: 'Test Controller Locally (New Tab)',
    roomCode: 'Room Code',
    connectedPads: 'Connected Controllers',
    ps2DiagTitle: 'VGFA-PS2 Engine Diagnostics (WebGPU + WASM + Disc Streaming)',
    footerCredit: 'VIDEO GAME FOR ALL (VGFA) • MIT Open Source • Zero copyrighted ROMs in repo',
  },
  es: {
    appSubtitle: 'De Atari a PlayStation 2 en el Navegador',
    heroKicker: 'VGFA Engine • WebGPU + WASM + Streaming P2P',
    heroTitle: 'Videojuegos para todos en el navegador — convierte tu móvil en el control.',
    heroDesc:
      'Juega clásicos desde Atari 2600 hasta PlayStation 2 sin instalar nada. Conecta tu mando Bluetooth o escanea el código QR para adaptar tu celular al control exacto de cada consola, con streaming por bloques y guardado local persistente.',
    playNow: 'Jugar Ahora',
    openPs2Lab: 'Abrir Motor PS2 WebGPU',
    connectPhone: 'Móvil como Control',
    phonePadMode: 'Modo Control',
    saves: 'Partidas y Memory Cards',
    signIn: 'Iniciar Sesión',
    signOut: 'Salir',
    allConsoles: 'Todas las Consolas',
    builtinTitle: 'Clásicos Ligeros Integrados (1 Clic)',
    builtinSub: '60 FPS instantáneos con Teclado, Mando Bluetooth y Móvil por QR',
    byodTitle: 'Cargar tu ROM / ISO o Streaming Remoto',
    byodSub: 'Archivo local (sin subidas) o URL HTTP Range / WebSeed — Atari → PS2',
    archiveTitle: 'Búsqueda en Vivo en Internet Archive',
    archiveSub: 'Explora colecciones públicas y homebrews directamente desde el navegador',
    searchPlaceholder: 'Ej.: space invaders, homebrew, nes, atari...',
    searchBtn: 'Buscar',
    dropRomLabel: 'Elegir ROM / ISO (.a26, .nes, .sfc, .md, .gba, .z64, .iso, .chd)',
    streamUrlPlaceholder: 'https://servidor/juego.iso (HTTP Range / WebSeed)',
    mountStreamBtn: 'Montar Stream',
    playGame: 'Jugar',
    backHome: 'Volver al Catálogo',
    saveState: 'Guardar Estado',
    loadState: 'Cargar Estado',
    bluetoothReady: 'Mando Bluetooth Conectado',
    noBluetoothYet: 'Pulsa cualquier botón en tu mando Bluetooth para vincularlo',
    qrTitle: 'Convierte tu Móvil en Control',
    qrHint:
      'Escanea el código QR con tu móvil (en la misma red Wi-Fi) o introduce el código de sala. El control se adapta automáticamente de Atari a PS2 DualShock 2.',
    openPadTab: 'Probar Control Aquí (Nueva Pestaña)',
    roomCode: 'Código de Sala',
    connectedPads: 'Controles Conectados',
    ps2DiagTitle: 'Diagnóstico del Motor VGFA-PS2 (WebGPU + WASM + Streaming)',
    footerCredit: 'VIDEO GAME FOR ALL (VGFA) • Código Abierto MIT • Sin ROMs propietarias',
  },
};
