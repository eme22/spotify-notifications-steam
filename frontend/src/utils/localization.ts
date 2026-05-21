export interface Translations {
    pluginTitle: string;
    nowPlaying: string;
    connectionMode: string;
    connectionModeDesc: string;
    modeLocalServer: string;
    modeWebApi: string;
    modeWinMedia: string;
    selectConnectionMode: string;
    serverHost: string;
    serverHostDesc: string;
    serverPort: string;
    serverPortDesc: string;
    clientId: string;
    clientIdDesc: string;
    clientSecret: string;
    clientSecretDesc: string;
    authInstruction: string;
    authBtn1: string;
    authCodeUrl: string;
    authCodeUrlDesc: string;
    authBtn2: string;
    winMediaHeader: string;
    winMediaDesc: string;
    syncNative: string;
    syncNativeDesc: string;
    syncVolume: string;
    syncVolumeDesc: string;
    playSound: string;
    playSoundDesc: string;
    pollingInterval: string;
    pollingIntervalDesc: string;
    minInterval: string;
    minIntervalDesc: string;
    saveSettings: string;
    testNotification: string;
    toastSavedTitle: string;
    toastSavedBody: string;
    toastErrorTitle: string;
    toastErrorClientIdRequired: string;
    toastAuthTitle: string;
    toastAuthOpening: string;
    toastErrorCredentialsRequired: string;
    toastAuthLinked: string;
    toastAuthErrorTitle: string;
    toastAuthExchangeFailed: string;
    testNotifBody: string;
    testNotifArtist: string;
    testNotifAlbum: string;
    miniPlayerOpen: string;
    miniPlayerMinimize: string;
    shuffleOn: string;
    shuffleOff: string;
    prevTrack: string;
    play: string;
    pause: string;
    nextTrack: string;
    repeatOne: string;
    repeatAll: string;
    repeatOff: string;
}

const english: Translations = {
    pluginTitle: "Spotify Notifications",
    nowPlaying: "Now Playing",
    connectionMode: "Connection Mode",
    connectionModeDesc: "Select how the plugin connects to Spotify",
    modeLocalServer: "Local Playback Server (Socket)",
    modeWebApi: "Spotify Web API (Remote Auth)",
    modeWinMedia: "Windows Media Playback API (GSMTC)",
    selectConnectionMode: "Select Connection Mode",
    serverHost: "Server Host",
    serverHostDesc: "IP address of the local Spotify Playback server",
    serverPort: "Server Port",
    serverPortDesc: "Port of the local Spotify Playback server",
    clientId: "Spotify Client ID",
    clientIdDesc: "Client ID from your Spotify Developer Dashboard",
    clientSecret: "Spotify Client Secret",
    clientSecretDesc: "Client Secret from your Spotify Developer Dashboard",
    authInstruction: "Authenticate with Spotify to get your authorization code:",
    authBtn1: "1. Authenticate Spotify Account",
    authCodeUrl: "Authorization Code / URL",
    authCodeUrlDesc: "Paste the redirect code or the complete URL here",
    authBtn2: "2. Exchange Code & Save",
    winMediaHeader: "Windows Media Playback Mode",
    winMediaDesc: "No additional setup is required. The plugin will monitor and control media from Windows APIs directly, supporting Spotify and any other media players.",
    syncNative: "Sync with Steam Native Player",
    syncNativeDesc: "Synchronize playback commands, progress bar seek, and media controls in real-time",
    syncVolume: "Sync Volume Control",
    syncVolumeDesc: "Synchronize Steam's native music volume slider with Spotify player volume",
    playSound: "Play Notification Sound",
    playSoundDesc: "Play a subtle alert tone when displaying notifications",
    pollingInterval: "Web API Polling Interval",
    pollingIntervalDesc: "Interval in seconds to check for new tracks",
    minInterval: "Web API Minimum Notification Interval",
    minIntervalDesc: "Minimum time in seconds between subsequent notifications",
    saveSettings: "Save Settings",
    testNotification: "Test Notification",
    toastSavedTitle: "Spotify Settings",
    toastSavedBody: "Native settings successfully saved!",
    toastErrorTitle: "Spotify Settings Error",
    toastErrorClientIdRequired: "Spotify Client ID is required for authentication.",
    toastAuthTitle: "Spotify Auth",
    toastAuthOpening: "Opening authorization URL in browser...",
    toastErrorCredentialsRequired: "Client ID, Client Secret, and Auth Code/URL are required.",
    toastAuthLinked: "Successfully linked Spotify account!",
    toastAuthErrorTitle: "Spotify Auth Error",
    toastAuthExchangeFailed: "Failed to exchange authorization code.",
    testNotifBody: "Get Ready for Premium Tunes!",
    testNotifArtist: "Antigravity AI",
    testNotifAlbum: "Steam Integration",
    miniPlayerOpen: "Open Spotify Controller",
    miniPlayerMinimize: "Minimize Player",
    shuffleOn: "Shuffle: On",
    shuffleOff: "Shuffle: Off",
    prevTrack: "Previous Track",
    play: "Play",
    pause: "Pause",
    nextTrack: "Next Track",
    repeatOne: "Repeat: One",
    repeatAll: "Repeat: All",
    repeatOff: "Repeat: Off"
};

const spanish: Translations = {
    pluginTitle: "Notificaciones de Spotify",
    nowPlaying: "Reproduciendo ahora",
    connectionMode: "Modo de Conexión",
    connectionModeDesc: "Selecciona cómo se conecta el plugin a Spotify",
    modeLocalServer: "Servidor de reproducción local (Socket)",
    modeWebApi: "Spotify Web API (Autenticación remota)",
    modeWinMedia: "Windows Media Playback API (GSMTC)",
    selectConnectionMode: "Seleccionar modo de conexión",
    serverHost: "Servidor Host",
    serverHostDesc: "Dirección IP del servidor local de reproducción de Spotify",
    serverPort: "Puerto del servidor",
    serverPortDesc: "Puerto del servidor local de reproducción de Spotify",
    clientId: "ID de cliente de Spotify",
    clientIdDesc: "ID de cliente desde tu panel de desarrollador de Spotify",
    clientSecret: "Secreto de cliente de Spotify",
    clientSecretDesc: "Secreto de cliente desde tu panel de desarrollador de Spotify",
    authInstruction: "Autentícate con Spotify para obtener tu código de autorización:",
    authBtn1: "1. Autenticar cuenta de Spotify",
    authCodeUrl: "Código de autorización / URL",
    authCodeUrlDesc: "Pega el código de redirección o la URL completa aquí",
    authBtn2: "2. Canjear código y guardar",
    winMediaHeader: "Modo de reproducción de Windows Media",
    winMediaDesc: "No se requiere configuración adicional. El plugin monitoreará y controlará el contenido multimedia directamente desde las APIs de Windows, compatible con Spotify y cualquier otro reproductor.",
    syncNative: "Sincronizar con el reproductor nativo de Steam",
    syncNativeDesc: "Sincroniza comandos de reproducción, búsqueda en la barra de progreso y controles multimedia en tiempo real",
    syncVolume: "Sincronizar control de volumen",
    syncVolumeDesc: "Sincroniza el control deslizante de volumen de música nativo de Steam con el volumen del reproductor de Spotify",
    playSound: "Reproducir sonido de notificación",
    playSoundDesc: "Reproduce un tono de alerta sutil al mostrar notificaciones",
    pollingInterval: "Intervalo de consulta de Web API",
    pollingIntervalDesc: "Intervalo en segundos para comprobar si hay nuevas canciones",
    minInterval: "Intervalo mínimo de notificación de Web API",
    minIntervalDesc: "Tiempo mínimo en segundos entre notificaciones consecutivas",
    saveSettings: "Guardar ajustes",
    testNotification: "Probar notificación",
    toastSavedTitle: "Ajustes de Spotify",
    toastSavedBody: "¡Ajustes nativos guardados con éxito!",
    toastErrorTitle: "Error en los ajustes de Spotify",
    toastErrorClientIdRequired: "Se requiere el ID de cliente de Spotify para la autenticación.",
    toastAuthTitle: "Autenticación de Spotify",
    toastAuthOpening: "Abriendo URL de autorización en el navegador...",
    toastErrorCredentialsRequired: "Se requieren el ID de cliente, el Secreto de cliente y el Código/URL de autorización.",
    toastAuthLinked: "¡Cuenta de Spotify vinculada con éxito!",
    toastAuthErrorTitle: "Error de autenticación de Spotify",
    toastAuthExchangeFailed: "Error al canjear el código de autorización.",
    testNotifBody: "¡Prepárate para la mejor música!",
    testNotifArtist: "Antigravity AI",
    testNotifAlbum: "Integración con Steam",
    miniPlayerOpen: "Abrir controlador de Spotify",
    miniPlayerMinimize: "Minimizar reproductor",
    shuffleOn: "Aleatorio: Sí",
    shuffleOff: "Aleatorio: No",
    prevTrack: "Canción anterior",
    play: "Reproducir",
    pause: "Pausar",
    nextTrack: "Siguiente canción",
    repeatOne: "Repetir: Una",
    repeatAll: "Repetir: Todo",
    repeatOff: "Repetir: No"
};

const portuguese: Translations = {
    pluginTitle: "Notificações do Spotify",
    nowPlaying: "Reproduzindo agora",
    connectionMode: "Modo de Conexão",
    connectionModeDesc: "Selecione como o plugin se conecta ao Spotify",
    modeLocalServer: "Servidor de Reprodução Local (Socket)",
    modeWebApi: "Spotify Web API (Autenticação Remota)",
    modeWinMedia: "Windows Media Playback API (GSMTC)",
    selectConnectionMode: "Selecionar Modo de Conexão",
    serverHost: "Servidor Host",
    serverHostDesc: "Endereço IP do servidor de reprodução local do Spotify",
    serverPort: "Porta do Servidor",
    serverPortDesc: "Porta do servidor de reprodução local do Spotify",
    clientId: "ID de Cliente do Spotify",
    clientIdDesc: "ID de cliente do seu Painel de Desenvolvedor do Spotify",
    clientSecret: "Segredo do Cliente do Spotify",
    clientSecretDesc: "Segredo do cliente do seu Painel de Desenvolvedor do Spotify",
    authInstruction: "Autentique-se com o Spotify para obter o seu código de autorização:",
    authBtn1: "1. Autenticar Conta do Spotify",
    authCodeUrl: "Código de Autorização / URL",
    authCodeUrlDesc: "Cole o código de redirecionamento ou a URL completa aqui",
    authBtn2: "2. Resgatar Código e Salvar",
    winMediaHeader: "Modo de Reprodução do Windows Media",
    winMediaDesc: "Nenhuma configuração adicional é necessária. O plugin monitorará e controlará a mídia diretamente das APIs do Windows, suportando o Spotify e qualquer outro reprodutor de mídia.",
    syncNative: "Sincronizar com o Reprodutor Nativo do Steam",
    syncNativeDesc: "Sincroniza comandos de reprodução, busca na barra de progresso e controles de mídia em tempo real",
    syncVolume: "Sincronizar Controle de Volume",
    syncVolumeDesc: "Sincroniza o controle deslizante de volume de música nativo do Steam com o volume do reprodutor do Spotify",
    playSound: "Reproduzir Som de Notificação",
    playSoundDesc: "Reproduz um tom de alerta sutil ao exibir notificações",
    pollingInterval: "Intervalo de Consulta da Web API",
    pollingIntervalDesc: "Intervalo em segundos para verificar se há novas faixas",
    minInterval: "Intervalo Mínimo de Notificação da Web API",
    minIntervalDesc: "Tempo mínimo em segundos entre notificações subsequentes",
    saveSettings: "Salvar Configurações",
    testNotification: "Testar Notificação",
    toastSavedTitle: "Configurações do Spotify",
    toastSavedBody: "Configurações nativas salvas com sucesso!",
    toastErrorTitle: "Erro nas Configurações do Spotify",
    toastErrorClientIdRequired: "O ID de Cliente do Spotify é obrigatório para autenticação.",
    toastAuthTitle: "Autenticação do Spotify",
    toastAuthOpening: "Abrindo URL de autorização no navegador...",
    toastErrorCredentialsRequired: "O ID de Cliente, Segredo do Cliente e Código/URL de Autorização são obrigatórios.",
    toastAuthLinked: "Conta do Spotify vinculada com sucesso!",
    toastAuthErrorTitle: "Erro de Autenticação do Spotify",
    toastAuthExchangeFailed: "Falha ao resgatar o código de autorização.",
    testNotifBody: "Prepare-se para Músicas Incríveis!",
    testNotifArtist: "Antigravity AI",
    testNotifAlbum: "Integração com o Steam",
    miniPlayerOpen: "Abrir Controlador do Spotify",
    miniPlayerMinimize: "Minimizar Reprodutor",
    shuffleOn: "Aleatório: Ativado",
    shuffleOff: "Aleatório: Desativado",
    prevTrack: "Faixa Anterior",
    play: "Reproduzir",
    pause: "Pausar",
    nextTrack: "Próxima Faixa",
    repeatOne: "Repetir: Uma",
    repeatAll: "Repetir: Todas",
    repeatOff: "Repetir: Desativado"
};

const LOCALES: Record<string, Translations> = {
    english,
    spanish,
    latam: spanish,
    portuguese,
    brazilian: portuguese
};

let currentLanguage = "english";

export function initializeLocalization(lang: string) {
    const normalizedLang = lang ? lang.toLowerCase().trim() : "english";
    if (LOCALES[normalizedLang]) {
        currentLanguage = normalizedLang;
    } else {
        currentLanguage = "english";
    }
}

export function t(key: keyof Translations): string {
    const translationSet = LOCALES[currentLanguage] || LOCALES.english;
    return translationSet[key] || LOCALES.english[key];
}
