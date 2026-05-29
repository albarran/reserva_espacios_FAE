# Reserva de Espacios — FAE

Sistema de reserva de despachos y salas de reunión del Departamento de Fundamentos del Análisis Económico (UA).
Desarrollado inicialmente con Claude en claude.ai, continuable con Claude Code CLI.

---

## Arquitectura

### Stack
- **Frontend**: HTML/CSS/JS puro. Un único fichero `index.html`. Sin frameworks, sin build step.
- **Backend**: Google Apps Script desplegado como Web App (API REST).
- **Base de datos**: Google Sheets (3 pestañas: `users`, `bookings`, `allowlist`).
- **Hosting**: GitHub Pages, dos espejos sirviendo el mismo código y mismo backend:
  - `https://albarran.github.io/FAE_Room_Booking/` (cuenta `albarran`, origen)
  - `https://dfae-ua.github.io/FAE_Room_Booking/` (cuenta `dfae-ua`, mirror)

### Ficheros del repo
```
FAE_Room_Booking/
├── index.html              # Frontend (UI y lógica)
├── config.js               # CONFIG frontend: API, Client ID, ROOMS, SEMINARS
├── apps_script/
│   ├── Code.gs             # Backend Apps Script
│   ├── Config.gs           # CONFIG backend: SHEET_ID, ADMIN_EMAILS, Client ID...
│   └── appsscript.json     # Manifiesto Apps Script
├── .gitignore              # Excluye .clasp.json (script ID local)
├── CLAUDE.md               # Este fichero — contexto para Claude Code
├── SETUP.md                # Guía paso a paso para reproducir en otro repo
└── README.md               # Manual de usuario (no técnico)
```

**Toda configuración editable está en `config.js` y `apps_script/Config.gs`.**
Para reproducir en otro contexto: ver `SETUP.md`.

El backend (`apps_script/`) vive simultáneamente en este repo y en Google Drive.
Se sincronizan con [`clasp`](https://github.com/google/clasp).

---

## Google Sheet (base de datos)

**ID**: `15un5CC9Qboc3OsAoe1yhXkdC9mwLeNcQhkb7Jr_DGJw`
**URL**: https://docs.google.com/spreadsheets/d/15un5CC9Qboc3OsAoe1yhXkdC9mwLeNcQhkb7Jr_DGJw/edit
**Propietario**: pedro.albarran@gmail.com

⚠️ **IMPORTANTE — Seguridad**: la Sheet tiene acceso **Restringido** (solo el propietario).
Nunca cambiar a "Cualquiera con el enlace". El ID de la Sheet solo debe aparecer
en el Apps Script (que corre en servidores de Google) y en este CLAUDE.md (privado).
Nunca incluir el ID en el README ni en ningún fichero público del repo.

### Schema

**users**: `email | name | pass | session_token | session_expires | auth_type`
**bookings**: `room | date | start | end | email | note`
**allowlist**: `email`

- `auth_type` ∈ {`google`, `password`}. Usuarios Google tienen `pass` vacío.
- `session_token`/`session_expires` se rellenan al login con contraseña;
  se valida en cada request protegido.
- Migración del schema antiguo (3 cols): ejecutar `migrateUsers()` una vez
  desde el editor de Apps Script.

⚠️ Las contraseñas (usuarios `@ua.es` y similares) siguen en texto plano.
Mitigado por session tokens (no hace falta enviar contraseña en cada request),
pero migrar a hash SHA-256 cliente sigue siendo deseable.

---

## Google Apps Script (backend)

**URL del Web App**:
```
https://script.google.com/macros/s/AKfycby1-bZ0plQbpW6gTfgT0mdrYmf__zGfHNvQVMGhnZcT8iJ79MhUOBtrqNR6AxxkEZnC/exec
```

El código completo vive en `apps_script/Code.gs`. Para editarlo:

**Vía clasp (recomendado)** — edición local + git + push automático:
1. Editar `apps_script/Code.gs` en local.
2. `clasp push` → sube a Drive.
3. `clasp deploy --deploymentId <ID>` → publica en la URL `/exec`.
   (Ver "Despliegue con clasp" más abajo.)

**Vía editor web** (fallback):
1. Abrir la Sheet → Extensiones → Apps Script.
2. Pegar el contenido de `Code.gs`.
3. Guardar → Implementar → Administrar implementaciones → Nueva versión.
4. Si cambia la URL `/exec`, actualizar la constante `API` en `index.html`.

### Constantes a configurar en el Apps Script

```javascript
const SHEET_ID         = '15un5CC9Qboc3OsAoe1yhXkdC9mwLeNcQhkb7Jr_DGJw';
const ADMIN_EMAILS     = ['pedro.albarran@gmail.com'];
const GOOGLE_CLIENT_ID = '<...>.apps.googleusercontent.com';  // OAuth Client ID
const GOOGLE_AUTH_DOMAINS = ['gcloud.ua.es', 'gmail.com'];
const PASSWORD_DOMAINS    = ['ua.es'];
```

### Endpoints

Todas las llamadas son POST con body JSON. Endpoints protegidos requieren
`idToken` (auth Google) **o** `sessionToken` (auth password) en el body —
el backend los verifica server-side; no se acepta ya un `requester` desde el cliente.

| Action | Params | Auth | Descripción |
|--------|--------|------|-------------|
| `googleAuth` | `idToken` | público | Valida ID token Google, registra al usuario si es nuevo |
| `login` | `email, pass` | público | Login con contraseña, devuelve `sessionToken` |
| `logout` | `sessionToken` | público | Invalida la sesión actual |
| `register` | `email, name, pass` | público | Crea cuenta (solo dominios no-Google + allowlist) |
| `getBookings` | `room?` | público | Lista reservas (o filtradas por espacio) |
| `addBooking` | `room, date, start, end, note` | token | Reserva a nombre del caller verificado |
| `deleteBooking` | `room, date, start, end, email` | token | Borra (caller debe ser dueño o admin) |
| `getUsers` | — | token + admin | Lista usuarios |
| `deleteUser` | `email` | token + admin | Borra usuario y sus reservas |
| `getAllowlist` | — | token + admin | Lista emails autorizados |
| `addAllowlist` | `email` | token + admin | Añade email |
| `removeAllowlist` | `email` | token + admin | Quita email |

---

## Autenticación y permisos

- **Dos vías de auth**:
  - **Google Sign-In** (`@gcloud.ua.es`, `@gmail.com`): GSI client-side → ID token →
    backend valida en `https://oauth2.googleapis.com/tokeninfo` y comprueba `aud === GOOGLE_CLIENT_ID`.
    No se almacena contraseña.
  - **Email + contraseña** (`@ua.es` y otros sin Google Workspace): backend valida contra
    columna `pass` y devuelve `sessionToken` (UUID v4, TTL 7 días, guardado en `users.session_token`).
  - El frontend persiste el token en `localStorage['fae_session']`.
- **Allowlist**: solo emails en la pestaña `allowlist` pueden registrarse / autenticarse
  con Google. Comprobada en ambos flujos.
- **Admin**: array `ADMIN_EMAILS` en `Code.gs`. Admin actual: `pedro.albarran@gmail.com`.
  Para añadir admins: modificar array + `clasp push` + `clasp deploy`.
- **Modelo de confianza**: el backend extrae el email del caller del token verificado,
  nunca del body. `addBooking` reserva siempre a nombre del caller verificado
  (el campo `email` del body se ignora).

### OAuth Client ID (Google Cloud Console)

1. https://console.cloud.google.com/ → proyecto (o crear uno).
2. APIs & Services → OAuth consent screen → External → rellenar nombre, soporte, etc.
   Añadir scope `email`, `profile`, `openid`. Add test users si está en modo Testing.
3. APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Application type: **Web application**.
4. **Authorized JavaScript origins**:
   - `https://albarran.github.io` (producción)
   - `http://localhost:8000` (si pruebas en local)
5. Copiar el Client ID `<...>.apps.googleusercontent.com` y pegarlo en:
   - `apps_script/Code.gs` → constante `GOOGLE_CLIENT_ID`
   - `index.html` → constante `GOOGLE_CLIENT_ID`

---

## Despliegue con clasp

Setup inicial (una vez):
```bash
npm install -g @google/clasp     # requiere node ≥ 14
clasp login                       # abre OAuth Google
cd ~/Github/FAE_Room_Booking/apps_script
clasp clone <SCRIPT_ID>           # script ID está en la URL del editor Apps Script
# clasp crea .clasp.json (ignorado por git) con el script ID local
```

Editar y desplegar:
```bash
cd ~/Github/FAE_Room_Booking/apps_script
# editar Code.gs
clasp push                                # sube a Drive (sobrescribe el editor web)
clasp deployments                          # lista deployments existentes
clasp deploy --deploymentId <ID> -d "v2"  # actualiza el URL /exec con la versión nueva
```

El `<ID>` del deployment es estable: lo eligen la primera vez en
Apps Script editor → Deploy → New deployment → "Web app". Después
`clasp deploy --deploymentId <ID>` lo actualiza sin cambiar la URL.

---

## Espacios configurados

Definidos en el array `ROOMS` dentro de `index.html`:

| ID | Código | Nombre | Notas |
|----|--------|--------|-------|
| r1 | 0034PS066 | Ciencias Sociales 066 | Para visitantes de seminarios hasta octubre. |
| r2 | 0034P2015 | Sala del café | Movimiento a las 9h y 13h. |
| r3 | 0036PS067 | Germán Bernacer 067 | Principal para seminarios oct/nov. |
| r4 | 0034PS105 | Zulo | Solo emergencias. Sin ventanas. |

## Seminarios bloqueados

Definidos en el array `SEMINARS` dentro de `index.html` (hardcoded, no en la Sheet).
Para añadir seminarios: editar el array `SEMINARS` en `index.html`.

| ID | Espacio | Fecha | Horario | Ponente |
|----|---------|-------|---------|---------|
| — | r1 | 2026-06-03 | 14:30–16:00 | Gunes Gokmen |
| — | r1 | 2026-06-04 | 14:30–16:00 | Lukas Hack |
| — | r1 | 2026-06-11 | 14:30–16:00 | Marta Morazzoni |
| — | r1 | 2026-09-23 | 14:30–16:00 | Juan Vargas |
| — | r3 | 2026-10-14 | 14:30–16:00 | Olivier Marie |
| — | r3 | 2026-11-17 | 14:30–16:00 | Oskar Skans |

---

## Estado del frontend

### Pantallas
- `screen-login` — Login con email y contraseña
- `screen-register` — Registro de cuenta nueva
- `screen-overview` — Vista principal: Espacios (tarjetas) / Mes (4 espacios) / Semana (4 espacios)
- `screen-room` — Detalle de un espacio con vistas Día / Semana / Mes
- `screen-admin` — Panel admin: Usuarios / Reservas / Emails permitidos

### Estado global (`S`)
```js
S = {
  user: null,           // { email, name, isAdmin, authType }
  idToken: null,        // Google ID token (auth = 'google')
  sessionToken: null,   // session token (auth = 'password')
  bookings: [],         // reservas de usuarios cargadas desde la Sheet
  userNames: {},        // cache email → nombre
  ovView: 'rooms',      // vista overview: 'rooms' | 'month' | 'week'
  ovMonth, ovYear,      // mes actual en overview
  ovWeekStart,          // Date del lunes de la semana en overview
  room: null,           // id del espacio activo ('r1'–'r4')
  roomView: 'month',    // vista room: 'day' | 'week' | 'month'
  roomMonth, roomYear,
  roomWeekStart,
  roomDay,              // string 'YYYY-MM-DD' para vista diaria
  selectedDate,         // fecha seleccionada (panel de reservas)
}
```

---

## Pendiente / Roadmap

- [x] Login con Google OAuth para `@gcloud.ua.es` y `@gmail.com`
- [x] Session tokens para auth con contraseña (sustituye el `requester` falsificable)
- [ ] Mostrar nombre en lugar de email en slots para usuarios no-admin
- [ ] Mover seminarios a la Sheet para gestión sin editar código
- [ ] Notificaciones por email al reservar/cancelar (Apps Script MailApp)
- [ ] Migrar contraseñas a hash SHA-256 en cliente
- [ ] Auto-logout en cliente si el backend responde `No autenticado`
- [ ] Soporte para reservas recurrentes
- [ ] Exportar a .ics / Google Calendar

---

## Cómo desplegar cambios

```bash
cd ~/Github/FAE_Room_Booking
git add .
git commit -m "descripción del cambio"
git push origin main
# GitHub Pages actualiza en ~1 minuto (en ambos espejos)
```

---

## Mirror dfae-ua + push doble

El repo se publica simultáneamente en dos cuentas GitHub para que la URL
visible sea `dfae-ua.github.io` (cuenta departamental) y siga existiendo
`albarran.github.io` (cuenta personal del responsable).

- Cuentas:
  - `albarran` → repo `albarran/FAE_Room_Booking` → Pages `https://albarran.github.io/FAE_Room_Booking/`
  - `dfae-ua` (email `pedro.albarran.ua@gmail.com`) → repo `dfae-ua/FAE_Room_Booking` → Pages `https://dfae-ua.github.io/FAE_Room_Booking/`
- Backend único: ambos frontales llaman al mismo Apps Script (`API` en `config.js`).
- OAuth: el Client ID tiene como Authorized JavaScript origins
  `https://albarran.github.io` **y** `https://dfae-ua.github.io`.

### Cómo se configura el push doble

`gh auth status` debe listar las dos cuentas autenticadas (`albarran` por
SSH, `dfae-ua` por HTTPS+token — la misma SSH key no se puede registrar en
dos cuentas, por eso `dfae-ua` va por HTTPS con el helper de `gh`).

```bash
gh auth setup-git --hostname github.com   # registra gh como credential helper
```

El remote `origin` apunta a `albarran` para `fetch`, y a **ambos** repos
para `push` gracias a `pushurl` múltiple en `.git/config`:

```bash
git remote set-url --add --push origin git@github.com:albarran/FAE_Room_Booking.git
git remote set-url --add --push origin https://github.com/dfae-ua/FAE_Room_Booking.git
```

Tras esto, `git push origin main` actualiza los dos repos a la vez.

### Reproducir el setup en otra máquina (p.ej. `hpfae19`)

⚠️ La configuración de remotes vive en `.git/config` y **no se clona**.
Hay que repetir el setup en cada máquina:

```bash
gh auth login --hostname github.com --git-protocol ssh --web    # cuenta albarran (SSH ya añadida)
gh auth login --hostname github.com --git-protocol https --web  # cuenta dfae-ua (HTTPS+token)
gh auth setup-git --hostname github.com
cd ~/Github
git clone git@github.com:albarran/FAE_Room_Booking.git
cd FAE_Room_Booking
git remote set-url --add --push origin git@github.com:albarran/FAE_Room_Booking.git
git remote set-url --add --push origin https://github.com/dfae-ua/FAE_Room_Booking.git
git remote -v   # verifica los dos pushurl
```

## Cómo continuar con Claude Code

```bash
cd ~/Github/FAE_Room_Booking
claude
# Claude Code leerá CLAUDE.md automáticamente y tendrá todo el contexto
```
