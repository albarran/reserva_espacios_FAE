// ╭──────────────────────────────────────────────────────────╮
// │ Reserva Espacios FAE — Configuración del backend         │
// │ EDITAR TODO LO DE ESTE FICHERO al hacer fork.            │
// ╰──────────────────────────────────────────────────────────╯

// ID de la Google Sheet (URL: .../d/<SHEET_ID>/edit).
const SHEET_ID = '15un5CC9Qboc3OsAoe1yhXkdC9mwLeNcQhkb7Jr_DGJw';

// Emails con permisos de administrador.
const ADMIN_EMAILS = ['pedro.albarran@gmail.com'];

// OAuth Client ID creado en Google Cloud Console (Web application).
const GOOGLE_CLIENT_ID = '626032110486-21n999lfth0jf48373g4ttb97jrt5eq1.apps.googleusercontent.com';

// Dominios que se autentican con Google (sin contraseña).
const GOOGLE_AUTH_DOMAINS = ['gcloud.ua.es', 'gmail.com'];

// Dominios sin Google Workspace → contraseña en la app.
const PASSWORD_DOMAINS = ['ua.es'];

// Dominios auto-permitidos (no requieren estar en `allowlist`).
// Cualquier email de estos dominios puede registrarse / autenticarse.
const AUTO_ALLOWED_DOMAINS = ['gcloud.ua.es', 'ua.es', 'gmail.com'];

// Duración de la sesión password (en ms).
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
