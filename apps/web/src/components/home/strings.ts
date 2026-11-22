import type { SupportedLang } from '@vgfa/storage';

export interface HomeStrings {
  brandSub: string;
  tabHome: string;
  tabStore: string;
  tabLibrary: string;
  tabPad: string;
  searchPlaceholder: string;
  optimize: string;
  optimizeActive: string;
  menu: string;
  signInFull: string;
  openMyGame: string;
  saves: string;
  publicLink: string;
  padMode: string;
  theme: string;
  themeSystem: string;
  themeDark: string;
  themeLight: string;
  language: string;
  featured: string;
  play: string;
  details: string;
  continuePlaying: string;
  continueSub: string;
  freeNow: string;
  freeNowSub: string;
  topPs2: string;
  seeAll: string;
  ready: string;
  storeTitle: string;
  storeSub: string;
  allConsoles: string;
  readyGroup: string;
  classicsGroup: string;
  noResults: string;
  webSearch: string;
  webSearching: string;
  webResults: string;
  bestOption: string;
  clear: string;
  libraryTitle: string;
  padTitle: string;
  padLead: string;
  padStep1: string;
  padStep1d: string;
  padStep2: string;
  padStep2d: string;
  padStep3: string;
  padStep3d: string;
  padTest: string;
  padTip: string;
  nexusBanner: string;
  nexusBannerCta: string;
  resume: string;
  scrollLeft: string;
  scrollRight: string;
  dismiss: string;
}

export const HOME_STRINGS: Record<SupportedLang, HomeStrings> = {
  'pt-BR': {
    brandSub: 'Central de Jogos',
    tabHome: 'Início',
    tabStore: 'Loja',
    tabLibrary: 'Minha Central',
    tabPad: 'Controle',
    searchPlaceholder: 'Buscar jogos',
    optimize: 'Otimizar o navegador',
    optimizeActive: 'Nexus ativo',
    menu: 'Menu da conta',
    signInFull: 'Entrar / Criar conta',
    openMyGame: 'Abrir meu jogo',
    saves: 'Saves e Memory Cards',
    publicLink: 'Link público',
    padMode: 'Modo controle',
    theme: 'Tema',
    themeSystem: 'Sistema',
    themeDark: 'Escuro',
    themeLight: 'Claro',
    language: 'Idioma',
    featured: 'Em destaque',
    play: 'Jogar',
    details: 'Detalhes',
    continuePlaying: 'Continuar jogando',
    continueSub: 'Seus jogos baixados neste aparelho',
    freeNow: 'Jogue agora grátis',
    freeNowSub: 'Um clique, sem baixar nada',
    topPs2: 'Top PS2',
    seeAll: 'Ver tudo',
    ready: 'Pronto',
    storeTitle: 'Loja',
    storeSub: 'Clássicos do Atari ao PlayStation 2',
    allConsoles: 'Todos',
    readyGroup: 'Prontos para jogar',
    classicsGroup: 'Clássicos',
    noResults: 'Nenhum jogo do catálogo bate com a busca.',
    webSearch: 'Buscar na internet',
    webSearching: 'Buscando...',
    webResults: 'Resultados abertos verificados',
    bestOption: 'Melhor opção',
    clear: 'Limpar',
    libraryTitle: 'Minha Central',
    padTitle: 'Seu celular vira o controle',
    padLead: 'Sem cabo, sem app. O controle se adapta ao console do jogo, do Atari ao DualShock do PS2.',
    padStep1: 'Abra um jogo',
    padStep1d: 'Escolha qualquer título e toque em Jogar no computador ou na TV.',
    padStep2: 'Escaneie o QR Code',
    padStep2d: 'Na tela de conexão, aponte a câmera do celular (mesma rede Wi-Fi).',
    padStep3: 'Jogue',
    padStep3d: 'O celular vira o controle certo do console. Aceita até 4 jogadores.',
    padTest: 'Testar o controle agora',
    padTip: 'Também funciona com controle Bluetooth: aperte qualquer botão para parear.',
    nexusBanner: 'Destrave o Modo Ultra no navegador: otimizadores leves e disco virtual para jogos de PS2.',
    nexusBannerCta: 'Otimizar agora',
    resume: 'Retomar',
    scrollLeft: 'Rolar para a esquerda',
    scrollRight: 'Rolar para a direita',
    dismiss: 'Dispensar',
  },
  en: {
    brandSub: 'Game Hub',
    tabHome: 'Home',
    tabStore: 'Store',
    tabLibrary: 'My Hub',
    tabPad: 'Controller',
    searchPlaceholder: 'Search games',
    optimize: 'Optimize browser',
    optimizeActive: 'Nexus on',
    menu: 'Account menu',
    signInFull: 'Sign in / Create account',
    openMyGame: 'Open my game',
    saves: 'Saves & Memory Cards',
    publicLink: 'Public link',
    padMode: 'Controller mode',
    theme: 'Theme',
    themeSystem: 'System',
    themeDark: 'Dark',
    themeLight: 'Light',
    language: 'Language',
    featured: 'Featured',
    play: 'Play',
    details: 'Details',
    continuePlaying: 'Continue playing',
    continueSub: 'Games downloaded on this device',
    freeNow: 'Play free now',
    freeNowSub: 'One click, nothing to download',
    topPs2: 'Top PS2',
    seeAll: 'See all',
    ready: 'Ready',
    storeTitle: 'Store',
    storeSub: 'Classics from Atari to PlayStation 2',
    allConsoles: 'All',
    readyGroup: 'Ready to play',
    classicsGroup: 'Classics',
    noResults: 'No catalog game matches your search.',
    webSearch: 'Search the web',
    webSearching: 'Searching...',
    webResults: 'Verified open results',
    bestOption: 'Best option',
    clear: 'Clear',
    libraryTitle: 'My Hub',
    padTitle: 'Your phone becomes the controller',
    padLead: 'No cable, no app. The pad adapts to each console, from Atari to the PS2 DualShock.',
    padStep1: 'Open a game',
    padStep1d: 'Pick any title and tap Play on your computer or TV.',
    padStep2: 'Scan the QR code',
    padStep2d: 'On the connect screen, point your phone camera at it (same Wi-Fi).',
    padStep3: 'Play',
    padStep3d: 'Your phone turns into the right pad for the console. Up to 4 players.',
    padTest: 'Test the controller now',
    padTip: 'Bluetooth controllers work too: press any button to pair.',
    nexusBanner: 'Unlock Ultra Mode in your browser: light optimizers and a virtual disk for PS2 games.',
    nexusBannerCta: 'Optimize now',
    resume: 'Resume',
    scrollLeft: 'Scroll left',
    scrollRight: 'Scroll right',
    dismiss: 'Dismiss',
  },
  es: {
    brandSub: 'Central de Juegos',
    tabHome: 'Inicio',
    tabStore: 'Tienda',
    tabLibrary: 'Mi Central',
    tabPad: 'Control',
    searchPlaceholder: 'Buscar juegos',
    optimize: 'Optimizar navegador',
    optimizeActive: 'Nexus activo',
    menu: 'Menú de cuenta',
    signInFull: 'Entrar / Crear cuenta',
    openMyGame: 'Abrir mi juego',
    saves: 'Saves y Memory Cards',
    publicLink: 'Enlace público',
    padMode: 'Modo control',
    theme: 'Tema',
    themeSystem: 'Sistema',
    themeDark: 'Oscuro',
    themeLight: 'Claro',
    language: 'Idioma',
    featured: 'Destacado',
    play: 'Jugar',
    details: 'Detalles',
    continuePlaying: 'Seguir jugando',
    continueSub: 'Tus juegos descargados en este dispositivo',
    freeNow: 'Juega gratis ahora',
    freeNowSub: 'Un clic, sin descargar nada',
    topPs2: 'Top PS2',
    seeAll: 'Ver todo',
    ready: 'Listo',
    storeTitle: 'Tienda',
    storeSub: 'Clásicos de Atari a PlayStation 2',
    allConsoles: 'Todos',
    readyGroup: 'Listos para jugar',
    classicsGroup: 'Clásicos',
    noResults: 'Ningún juego del catálogo coincide con la búsqueda.',
    webSearch: 'Buscar en internet',
    webSearching: 'Buscando...',
    webResults: 'Resultados abiertos verificados',
    bestOption: 'Mejor opción',
    clear: 'Limpiar',
    libraryTitle: 'Mi Central',
    padTitle: 'Tu celular se vuelve el control',
    padLead: 'Sin cable, sin app. El control se adapta a cada consola, del Atari al DualShock de PS2.',
    padStep1: 'Abre un juego',
    padStep1d: 'Elige cualquier título y toca Jugar en el computador o la TV.',
    padStep2: 'Escanea el código QR',
    padStep2d: 'En la pantalla de conexión, apunta la cámara del celular (misma red Wi-Fi).',
    padStep3: 'Juega',
    padStep3d: 'El celular se vuelve el control correcto de la consola. Hasta 4 jugadores.',
    padTest: 'Probar el control ahora',
    padTip: 'También funciona con control Bluetooth: pulsa cualquier botón para emparejar.',
    nexusBanner: 'Activa el Modo Ultra en el navegador: optimizadores ligeros y disco virtual para juegos de PS2.',
    nexusBannerCta: 'Optimizar ahora',
    resume: 'Continuar',
    scrollLeft: 'Desplazar a la izquierda',
    scrollRight: 'Desplazar a la derecha',
    dismiss: 'Descartar',
  },
};
