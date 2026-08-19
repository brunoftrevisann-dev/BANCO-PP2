/* tuo-i18n.js — Language, font-size and vibration system */
(function () {
  'use strict';

  // ── TRANSLATIONS ────────────────────────────────────────────────────────────
  var DICT = {
    es: {
      // Common
      'common.back': 'Volver',
      'common.home': 'Inicio',
      'common.save': 'Guardar',
      'common.cancel': 'Cancelar',
      'common.edit': 'Editar',
      'common.copy': 'Copiar',
      'common.copied': '¡Copiado!',
      'common.loading': 'Cargando...',
      'common.open_account': 'Abrir Cuenta',
      'common.send': 'Enviar',
      'common.confirm': 'Confirmar',
      'common.close': 'Cerrar',
      'common.version': 'Versión 1.0.0',

      // Nav / Header
      'nav.home': 'Inicio',
      'nav.products': 'Productos',
      'nav.security': 'Seguridad',
      'nav.login': 'Log in',
      'nav.open_account': 'Abrir Cuenta',

      // Settings page
      'settings.title': 'Ajustes',
      'settings.appearance': 'Apariencia',
      'settings.theme': 'Tema',
      'settings.theme.sub': 'Claro, oscuro o según el sistema',
      'settings.theme.light': 'Claro',
      'settings.theme.dark': 'Oscuro',
      'settings.theme.auto': 'Auto',
      'settings.nightmode': 'Modo nocturno por horario',
      'settings.nightmode.sub': 'Activar automáticamente entre dos horas',
      'settings.nightmode.schedule': 'Horario del modo oscuro',
      'settings.nightmode.from': 'Desde',
      'settings.nightmode.to': 'Hasta',
      'settings.security_section': 'Seguridad',
      'settings.autologout': 'Cierre automático de sesión',
      'settings.autologout.sub': 'Cierra sesión tras 3 minutos de inactividad',
      'settings.sound': 'Sonido y notificaciones',
      'settings.sounds': 'Sonidos de transacciones',
      'settings.sounds.sub': 'Sonido al enviar o recibir dinero',
      'settings.privacy': 'Privacidad',
      'settings.hidesaldo': 'Ocultar saldo al inicio',
      'settings.hidesaldo.sub': 'El saldo arranca oculto hasta que lo mostrás',
      'settings.clearcache': 'Limpiar cache local',
      'settings.clearcache.sub': 'Borra datos guardados en este dispositivo',
      'settings.clearcache.btn': 'Limpiar',
      'settings.about': 'Sobre tuo',
      'settings.about.name': 'tuo — Tu banco',
      'settings.about.version': 'Versión 1.0.0',
      'settings.general': 'General',
      'settings.language': 'Idioma',
      'settings.language.sub': 'Idioma de la aplicación',
      'settings.lang.es': 'Español',
      'settings.lang.en': 'English',
      'settings.fontsize': 'Tamaño de texto',
      'settings.fontsize.sub': 'Ajustá el tamaño de la letra',
      'settings.fontsize.sm': 'S',
      'settings.fontsize.md': 'M',
      'settings.fontsize.lg': 'L',
      'settings.fontsize.xl': 'XL',
      'settings.vibration': 'Vibración',
      'settings.vibration.sub': 'Vibración al confirmar acciones',

      // Settings toasts
      'toast.theme_updated': 'Tema actualizado',
      'toast.schedule_saved': 'Horario guardado',
      'toast.autologout_on': 'Cierre automático activado',
      'toast.autologout_off': 'Cierre automático desactivado',
      'toast.sounds_on': 'Sonidos activados',
      'toast.sounds_off': 'Sonidos desactivados',
      'toast.saldo_hidden': 'Saldo se ocultará al inicio',
      'toast.saldo_visible': 'Saldo visible al inicio',
      'toast.cache_cleared': 'Caché limpiado correctamente',
      'toast.lang_updated': 'Idioma actualizado',
      'toast.fontsize_updated': 'Tamaño de texto actualizado',
      'toast.vibration_on': 'Vibración activada',
      'toast.vibration_off': 'Vibración desactivada',
      'settings.cache.confirm': 'Se borrarán los datos en caché de este dispositivo. No afecta tu cuenta ni tus movimientos.',

      // Dashboard
      'dashboard.available': 'Saldo disponible',
      'dashboard.savings': 'Caja de Ahorro',
      'dashboard.actions': 'Acciones rápidas',
      'dashboard.transfer': 'Transferir',
      'dashboard.deposit': 'Depositar',
      'dashboard.usd': 'Dólares',
      'dashboard.history': 'Historial',
      'dashboard.recent': 'Últimos movimientos',
      'dashboard.viewall': 'Ver todos →',
      'dashboard.menu.personal': 'Datos personales',
      'dashboard.menu.deposit': 'Depositar',
      'dashboard.menu.usd': 'Dólares',
      'dashboard.menu.contacts': 'Contactos',
      'dashboard.menu.stats': 'Estadísticas',
      'dashboard.menu.settings': 'Ajustes',
      'dashboard.menu.logout': 'Cerrar sesión',
      'dashboard.historial.title': 'Historial de movimientos',
      'dashboard.historial.search': 'Buscar por nombre o CBU...',
      'dashboard.historial.all': 'Todos',
      'dashboard.historial.sent': 'Enviados',
      'dashboard.historial.received': 'Recibidos',
      'dashboard.historial.all_time': 'Todo',
      'dashboard.historial.24h': '24hs',
      'dashboard.historial.7d': '7 días',
      'dashboard.historial.15d': '15 días',
      'dashboard.historial.month': 'Este mes',
      'dashboard.historial.custom': 'Fecha personalizada',
      'dashboard.historial.from': 'Desde',
      'dashboard.historial.to': 'Hasta',
      'dashboard.historial.empty': 'No tenés movimientos aún.',
      'dashboard.historial.no_results': 'Sin movimientos para este filtro.',
      'dashboard.historial.no_transactions': 'No tenés movimientos aún.',
      'dashboard.historial.unavailable': 'Sin movimientos disponibles.',
      'dashboard.tx.approved': 'Aprobada',
      'dashboard.tx.rejected': 'Rechazada',
      'dashboard.tx.deposit': 'Depósito en efectivo',
      'dashboard.tx.sent': 'Enviado a',
      'dashboard.tx.received': 'Recibido de',
      'dashboard.tx.deposito': 'Depósito',
      'dashboard.tx.recipient': 'Destinatario',
      'dashboard.tx.sender_role': 'Emisor',
      'dashboard.tx.sent_to': 'Enviaste a',
      'dashboard.tx.received_from': 'Recibiste de',
      'dashboard.tx.download_receipt': 'Descargar comprobante',
      'dashboard.tx.datetime': 'Fecha y hora',
      'dashboard.tx.amount': 'Monto',
      'dashboard.tx.amount_label': 'Importe',
      'dashboard.tx.status': 'Estado',
      'dashboard.tx.message': 'Mensaje',
      'dashboard.tx.unknown': 'Desconocido',
      'dashboard.tx.name': 'Nombre',
      'dashboard.tx.date': 'Fecha',
      'dashboard.tx.type': 'Tipo',
      'dashboard.tx.transaction': 'Transacción',
      'dashboard.tx.id': 'ID',
      'dashboard.tx.alias': 'Alias',
      'dashboard.tx.bank': 'Banco',

      // Login
      'login.title': 'Bienvenido a tuo',
      'login.subtitle': 'Ingresá a tu cuenta',
      'login.email': 'Email',
      'login.password': 'Contraseña',
      'login.enter': 'Ingresar',
      'login.forgot': '¿Olvidaste tu contraseña?',
      'login.no_account': '¿No tenés cuenta?',
      'login.register': 'Registrate',
      'login.biometric': 'Acceso biométrico',

      // Registro
      'register.title': 'Crear cuenta',
      'register.subtitle': 'Abrí tu cuenta en minutos',
      'register.name': 'Nombre',
      'register.lastname': 'Apellido',
      'register.email': 'Email',
      'register.password': 'Contraseña',
      'register.confirm_pwd': 'Confirmar contraseña',
      'register.phone': 'Teléfono',
      'register.dni': 'DNI',
      'register.create': 'Crear cuenta',
      'register.have_account': '¿Ya tenés cuenta?',
      'register.login': 'Iniciá sesión',

      // Perfil
      'profile.title': 'Mi perfil',
      'profile.personal': 'Datos personales',
      'profile.name': 'Nombre',
      'profile.dni': 'DNI',
      'profile.email': 'Email',
      'profile.phone': 'Teléfono',
      'profile.cbu': 'CBU',
      'profile.alias': 'Alias',
      'profile.password': 'Cambiar contraseña',
      'profile.activity': 'Accesos recientes',
      'profile.current': 'Actual',
      'profile.login_event': 'Inicio de sesión',
      'profile.view_map': 'Ver en mapa',
      'profile.activity_empty': 'Sin registros disponibles.',

      // Seguridad page
      'security.page.badge': 'Tu seguridad',
      'security.page.hero_title_html': 'Tu dinero protegido,<br>siempre y en todo <span>lugar</span>.',
      'security.page.hero_sub': 'La seguridad en tuo no es un extra, es el núcleo de todo lo que hacemos. Cada transacción, cada dato, cada acceso está protegido.',
      'security.page.protocols_label': 'Protocolos de seguridad',
      'security.page.protocols_title': 'Qué hacemos ante cada situación.',
      'security.page.pillar1_title': 'Verificación de identidad',
      'security.page.pillar1_desc': 'Para crear tu cuenta validamos tu identidad con DNI y datos personales. Nadie más puede abrirse una cuenta con tu información sin saberlo.',
      'security.page.pillar2_title': 'Verificación por email',
      'security.page.pillar2_desc': 'Cada registro y cada cambio de contraseña requiere confirmación por código enviado a tu email. Sin ese código, nadie puede entrar.',
      'security.page.pillar3_title': 'Protección de contraseña',
      'security.page.pillar3_desc': 'Podés cambiar tu contraseña en cualquier momento desde tu perfil. El proceso exige verificar la contraseña actual y confirmar por email.',
      'security.page.pillar4_title': 'Registro de accesos',
      'security.page.pillar4_desc': 'Cada inicio de sesión queda registrado con fecha y hora. Podés revisar el historial de accesos a tu cuenta en cualquier momento desde tu perfil.',
      'security.page.step1_title': 'Intento de acceso no autorizado',
      'security.page.step1_desc': 'Si detectamos múltiples intentos fallidos de login, el acceso se bloquea temporalmente. Recibirás una notificación en tu email para que puedas actuar de inmediato.',
      'security.page.step2_title': 'Cambio de contraseña',
      'security.page.step2_desc': 'Para cambiar tu contraseña necesitás ingresar la contraseña actual y verificar un código de 6 dígitos enviado a tu email registrado. El código vence en 5 minutos.',
      'security.page.step3_title': 'Transferencia de dinero',
      'security.page.step3_desc': 'Cada transferencia pasa por el sistema del Banco Central antes de acreditarse. Si la transacción no cumple los controles, se rechaza automáticamente y se te informa el motivo.',
      'security.page.step4_title': 'Cambio de alias',
      'security.page.step4_desc': 'Modificar tu alias requiere autenticación en la sesión activa y se propaga inmediatamente al sistema interbancario. El alias anterior deja de funcionar al instante.',
      'security.page.legal_title': 'Regulación y respaldo',
      'security.page.legal_desc': 'tuo opera dentro del sistema financiero argentino, conectado al Banco Central de la República Argentina (BCRA) a través de su API oficial. Todas las transacciones cumplen con la normativa vigente del sistema de pagos inmediatos (SPI).',
      'security.page.cta_title': 'Operá con tranquilidad.',
      'security.page.cta_sub': 'Abrí tu cuenta y experimentá una banca que pone tu seguridad primero.',
      'security.page.cta_btn': 'Abrir cuenta gratis',
      'security.page.stat1_label': 'Cifrado AES para todos los datos en tránsito y en reposo',
      'security.page.stat2_label': 'Monitoreo continuo de actividad sospechosa y fraude',
      'security.page.stat3_label': 'Costo por activar todas las capas de seguridad disponibles',

      // Footer
      'footer.rights': '© 2025 tuo · Todos los derechos reservados',

      // Depositar
      'deposit.title': 'Depositar',
      'deposit.back': 'Volver',

      // Contactos
      'contacts.title': 'Contactos',

      // Estadísticas
      'stats.title': 'Estadísticas',
    },

    en: {
      // Common
      'common.back': 'Back',
      'common.home': 'Home',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.edit': 'Edit',
      'common.copy': 'Copy',
      'common.copied': 'Copied!',
      'common.loading': 'Loading...',
      'common.open_account': 'Open Account',
      'common.send': 'Send',
      'common.confirm': 'Confirm',
      'common.close': 'Close',
      'common.version': 'Version 1.0.0',

      // Nav / Header
      'nav.home': 'Home',
      'nav.products': 'Products',
      'nav.security': 'Security',
      'nav.login': 'Log in',
      'nav.open_account': 'Open Account',

      // Settings page
      'settings.title': 'Settings',
      'settings.appearance': 'Appearance',
      'settings.theme': 'Theme',
      'settings.theme.sub': 'Light, dark or system default',
      'settings.theme.light': 'Light',
      'settings.theme.dark': 'Dark',
      'settings.theme.auto': 'Auto',
      'settings.nightmode': 'Scheduled night mode',
      'settings.nightmode.sub': 'Automatically activate between two times',
      'settings.nightmode.schedule': 'Dark mode schedule',
      'settings.nightmode.from': 'From',
      'settings.nightmode.to': 'To',
      'settings.security_section': 'Security',
      'settings.autologout': 'Auto session close',
      'settings.autologout.sub': 'Log out after 3 minutes of inactivity',
      'settings.sound': 'Sound & notifications',
      'settings.sounds': 'Transaction sounds',
      'settings.sounds.sub': 'Sound when sending or receiving money',
      'settings.privacy': 'Privacy',
      'settings.hidesaldo': 'Hide balance on start',
      'settings.hidesaldo.sub': 'Balance starts hidden until you reveal it',
      'settings.clearcache': 'Clear local cache',
      'settings.clearcache.sub': 'Delete data stored on this device',
      'settings.clearcache.btn': 'Clear',
      'settings.about': 'About tuo',
      'settings.about.name': 'tuo — Your bank',
      'settings.about.version': 'Version 1.0.0',
      'settings.general': 'General',
      'settings.language': 'Language',
      'settings.language.sub': 'App language',
      'settings.lang.es': 'Español',
      'settings.lang.en': 'English',
      'settings.fontsize': 'Text size',
      'settings.fontsize.sub': 'Adjust the text size',
      'settings.fontsize.sm': 'S',
      'settings.fontsize.md': 'M',
      'settings.fontsize.lg': 'L',
      'settings.fontsize.xl': 'XL',
      'settings.vibration': 'Vibration',
      'settings.vibration.sub': 'Vibrate on action confirmation',

      // Settings toasts
      'toast.theme_updated': 'Theme updated',
      'toast.schedule_saved': 'Schedule saved',
      'toast.autologout_on': 'Auto close enabled',
      'toast.autologout_off': 'Auto close disabled',
      'toast.sounds_on': 'Sounds enabled',
      'toast.sounds_off': 'Sounds disabled',
      'toast.saldo_hidden': 'Balance will be hidden on start',
      'toast.saldo_visible': 'Balance visible on start',
      'toast.cache_cleared': 'Cache cleared successfully',
      'toast.lang_updated': 'Language updated',
      'toast.fontsize_updated': 'Text size updated',
      'toast.vibration_on': 'Vibration enabled',
      'toast.vibration_off': 'Vibration disabled',
      'settings.cache.confirm': 'Cached data on this device will be deleted. Your account and transactions are not affected.',

      // Dashboard
      'dashboard.available': 'Available balance',
      'dashboard.savings': 'Savings Account',
      'dashboard.actions': 'Quick actions',
      'dashboard.transfer': 'Transfer',
      'dashboard.deposit': 'Deposit',
      'dashboard.usd': 'US Dollars',
      'dashboard.history': 'History',
      'dashboard.recent': 'Recent transactions',
      'dashboard.viewall': 'View all →',
      'dashboard.menu.personal': 'Personal info',
      'dashboard.menu.deposit': 'Deposit',
      'dashboard.menu.usd': 'US Dollars',
      'dashboard.menu.contacts': 'Contacts',
      'dashboard.menu.stats': 'Statistics',
      'dashboard.menu.settings': 'Settings',
      'dashboard.menu.logout': 'Log out',
      'dashboard.historial.title': 'Transaction history',
      'dashboard.historial.search': 'Search by name or CBU...',
      'dashboard.historial.all': 'All',
      'dashboard.historial.sent': 'Sent',
      'dashboard.historial.received': 'Received',
      'dashboard.historial.all_time': 'All',
      'dashboard.historial.24h': '24hrs',
      'dashboard.historial.7d': '7 days',
      'dashboard.historial.15d': '15 days',
      'dashboard.historial.month': 'This month',
      'dashboard.historial.custom': 'Custom date',
      'dashboard.historial.from': 'From',
      'dashboard.historial.to': 'To',
      'dashboard.historial.empty': 'No transactions yet.',
      'dashboard.historial.no_results': 'No transactions for this filter.',
      'dashboard.historial.no_transactions': 'No transactions yet.',
      'dashboard.historial.unavailable': 'No transactions available.',
      'dashboard.tx.approved': 'Approved',
      'dashboard.tx.rejected': 'Rejected',
      'dashboard.tx.deposit': 'Cash deposit',
      'dashboard.tx.sent': 'Sent to',
      'dashboard.tx.received': 'Received from',
      'dashboard.tx.deposito': 'Deposit',
      'dashboard.tx.recipient': 'Recipient',
      'dashboard.tx.sender_role': 'Sender',
      'dashboard.tx.sent_to': 'You sent to',
      'dashboard.tx.received_from': 'You received from',
      'dashboard.tx.download_receipt': 'Download receipt',
      'dashboard.tx.datetime': 'Date and time',
      'dashboard.tx.amount': 'Amount',
      'dashboard.tx.amount_label': 'Amount',
      'dashboard.tx.status': 'Status',
      'dashboard.tx.message': 'Message',
      'dashboard.tx.unknown': 'Unknown',
      'dashboard.tx.name': 'Name',
      'dashboard.tx.date': 'Date',
      'dashboard.tx.type': 'Type',
      'dashboard.tx.transaction': 'Transaction',
      'dashboard.tx.id': 'ID',
      'dashboard.tx.alias': 'Alias',
      'dashboard.tx.bank': 'Bank',

      // Login
      'login.title': 'Welcome to tuo',
      'login.subtitle': 'Sign in to your account',
      'login.email': 'Email',
      'login.password': 'Password',
      'login.enter': 'Sign in',
      'login.forgot': 'Forgot your password?',
      'login.no_account': "Don't have an account?",
      'login.register': 'Sign up',
      'login.biometric': 'Biometric access',

      // Registro
      'register.title': 'Create account',
      'register.subtitle': 'Open your account in minutes',
      'register.name': 'First name',
      'register.lastname': 'Last name',
      'register.email': 'Email',
      'register.password': 'Password',
      'register.confirm_pwd': 'Confirm password',
      'register.phone': 'Phone',
      'register.dni': 'ID number',
      'register.create': 'Create account',
      'register.have_account': 'Already have an account?',
      'register.login': 'Sign in',

      // Perfil
      'profile.title': 'My profile',
      'profile.personal': 'Personal information',
      'profile.name': 'Name',
      'profile.dni': 'ID',
      'profile.email': 'Email',
      'profile.phone': 'Phone',
      'profile.cbu': 'CBU',
      'profile.alias': 'Alias',
      'profile.password': 'Change password',
      'profile.activity': 'Recent access',
      'profile.current': 'Current',
      'profile.login_event': 'Login',
      'profile.view_map': 'View on map',
      'profile.activity_empty': 'No records available.',

      // Seguridad page
      'security.page.badge': 'Your security',
      'security.page.hero_title_html': 'Your money protected,<br>always and <span>everywhere</span>.',
      'security.page.hero_sub': 'Security at tuo is not an add-on — it is the core of everything we do. Every transaction, every piece of data, every access is protected.',
      'security.page.protocols_label': 'Security protocols',
      'security.page.protocols_title': 'What we do in each situation.',
      'security.page.pillar1_title': 'Identity verification',
      'security.page.pillar1_desc': 'To create your account we validate your identity with your ID and personal data. No one else can open an account with your information without your knowledge.',
      'security.page.pillar2_title': 'Email verification',
      'security.page.pillar2_desc': 'Every registration and password change requires confirmation via a code sent to your email. Without that code, no one can get in.',
      'security.page.pillar3_title': 'Password protection',
      'security.page.pillar3_desc': 'You can change your password at any time from your profile. The process requires verifying your current password and confirming via email.',
      'security.page.pillar4_title': 'Access log',
      'security.page.pillar4_desc': 'Every login is recorded with date and time. You can review your account access history at any time from your profile.',
      'security.page.step1_title': 'Unauthorized access attempt',
      'security.page.step1_desc': 'If we detect multiple failed login attempts, access is temporarily blocked. You will receive a notification by email so you can act immediately.',
      'security.page.step2_title': 'Password change',
      'security.page.step2_desc': 'To change your password you need to enter your current password and verify a 6-digit code sent to your registered email. The code expires in 5 minutes.',
      'security.page.step3_title': 'Money transfer',
      'security.page.step3_desc': 'Every transfer goes through the Central Bank system before being credited. If the transaction does not pass the checks, it is automatically rejected and you are informed of the reason.',
      'security.page.step4_title': 'Alias change',
      'security.page.step4_desc': 'Changing your alias requires authentication in the active session and propagates immediately to the interbank system. The previous alias stops working instantly.',
      'security.page.legal_title': 'Regulation & backing',
      'security.page.legal_desc': 'tuo operates within the Argentine financial system, connected to the Central Bank of Argentina (BCRA) through its official API. All transactions comply with the current regulations of the immediate payments system (SPI).',
      'security.page.cta_title': 'Operate with peace of mind.',
      'security.page.cta_sub': 'Open your account and experience banking that puts your security first.',
      'security.page.cta_btn': 'Open free account',
      'security.page.stat1_label': 'AES encryption for all data in transit and at rest',
      'security.page.stat2_label': 'Continuous monitoring of suspicious activity and fraud',
      'security.page.stat3_label': 'Cost to activate all available security layers',

      // Footer
      'footer.rights': '© 2025 tuo · All rights reserved',

      // Depositar
      'deposit.title': 'Deposit',
      'deposit.back': 'Back',

      // Contactos
      'contacts.title': 'Contacts',

      // Estadísticas
      'stats.title': 'Statistics',
    }
  };

  // ── CORE FUNCTIONS ──────────────────────────────────────────────────────────

  function getLang() {
    return localStorage.getItem('tuo_lang') || 'es';
  }

  function t(key) {
    var lang = getLang();
    var dict = DICT[lang] || DICT.es;
    return dict[key] !== undefined ? dict[key] : (DICT.es[key] !== undefined ? DICT.es[key] : key);
  }

  function applyI18n() {
    var lang = getLang();
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n'));
      if (val) el.textContent = val;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-placeholder'));
      if (val) el.placeholder = val;
    });

    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-title'));
      if (val) el.title = val;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var val = t(el.getAttribute('data-i18n-html'));
      if (val) el.innerHTML = val;
    });
  }

  // ── FONT SIZE ────────────────────────────────────────────────────────────────

  function applyFontSize() {
    var size = localStorage.getItem('tuo_font_size') || 'md';
    var scaleMap = { sm: '88%', md: '100%', lg: '112%', xl: '125%' };
    document.documentElement.style.fontSize = scaleMap[size] || '100%';
  }

  // ── VIBRATION ────────────────────────────────────────────────────────────────

  function vibrate(pattern) {
    if (localStorage.getItem('tuo_vibration') === '0') return;
    if (!('vibrate' in navigator)) return;
    try { navigator.vibrate(pattern || [15, 8, 15]); } catch (e) { /* ignore */ }
  }

  function vibrateLight() { vibrate([10]); }
  function vibrateMedium() { vibrate([15, 8, 15]); }
  function vibrateSuccess() { vibrate([10, 5, 10, 5, 30]); }
  function vibrateError() { vibrate([50, 10, 50]); }

  // ── INIT ─────────────────────────────────────────────────────────────────────

  // Apply font size immediately — document.documentElement is always available
  applyFontSize();

  // Apply translations once DOM is parsed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyI18n);
  } else {
    applyI18n();
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────────

  window.tuoI18n = {
    t: t,
    getLang: getLang,
    applyI18n: applyI18n,
    applyFontSize: applyFontSize,
    vibrate: vibrate,
    vibrateLight: vibrateLight,
    vibrateMedium: vibrateMedium,
    vibrateSuccess: vibrateSuccess,
    vibrateError: vibrateError
  };

  // Expose t() globally as shorthand
  window.t = t;

})();
