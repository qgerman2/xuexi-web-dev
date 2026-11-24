# Sitio web · Xuexi Club UC

Sitio oficial del Club de Lengua, Cultura y Estudios sobre China de la Pontificia
Universidad Católica de Chile.

**Sitio en vivo:** https://xuexiclub.cl
**Contacto:** xuexiclub.uc@gmail.com · [@xuexiclub.uc](https://instagram.com/xuexiclub.uc)

> 我们一起学习，外联和信息

---

## Cómo agregar o editar una actividad

### Opción recomendada: el editor

Abre **[xuexiclub.cl/admin.html](https://xuexiclub.cl/admin.html)** con tu cuenta de administrador y usa el formulario.
No hay que escribir código ni entender JSON: eliges tipo de actividad, comisión y estado
desde listas desplegables.

1. Abre Agenda y crea o edita un evento.
2. Completa el formulario y presiona **Publicar**.
3. El editor guarda `data/eventos/<id>.json` y las fotos en el repositorio.
4. GitHub Actions construye y publica el sitio, incluida la vista previa al compartir el enlace.

El sitio se actualiza solo en 1 o 2 minutos.

> Espera a que termine la publicación antes de cerrar el editor. Una importación
> de Instagram en curso conserva sus fotos en memoria y se pierde al recargar.

Los campos siguen los **Estatutos Xuexi 2026**: los tipos de actividad del Art. 2.1
(taller, charla, congreso, almuerzo, festival, stand), las comisiones de los Art. 5 a 7,
y los ciclos de mayo–junio y octubre–noviembre del Art. 6.3.

### Opción manual

También puedes editar un archivo en **[`data/eventos/`](data/eventos/)** directamente
en GitHub. Para crear otro evento, copia uno existente: el nombre del archivo
debe coincidir con su campo `id`. `data/eventos.json` y las páginas individuales
se generan durante la publicación y no se guardan en Git.

### Campos de un evento

| Campo | Qué va | Ejemplo |
|---|---|---|
| `titulo` | Nombre de la actividad | `"Ceremonia del té 茶道"` |
| `fecha` | Año-mes-día | `"2026-05-14"` |
| `hora` | Hora de inicio | `"16:30"` |
| `lugar` | Dónde | `"Campus San Joaquín UC"` |
| `detalle` | Quién la imparte, sala, notas | `"Con Junzi Lan"` |
| `tipo` | Tipo de actividad (Art. 2.1) | `"taller"` |
| `comision` | Comisión responsable | `"wailian"` |
| `ciclo` | Ciclo del año (Art. 6.3) | `"primer-semestre"` |
| `areaEtiqueta` | Área académica, si aplica | `"Cultura y Lengua"` |
| `estado` | Estado de inscripción | `"abierto"` |
| `hanzi` | Carácter chino decorativo | `"茶"` |
| `cupos` | Cupo máximo (`0` = sin límite) | `20` |
| `imagen` | Foto en `assets/` (opcional) | `"te.jpg"` |

**`tipo`** — `taller` · `charla` · `congreso` · `almuerzo` · `festival` · `stand` ·
`jornada` · `voluntariado`

**`comision`** — `wailian` (gestiona las actividades, Art. 6.3) · `xuexi` (académicas,
Art. 5) · `xinxi` (difusión, Art. 7)

**`ciclo`** — `primer-semestre` (mayo–junio) · `segundo-semestre` (octubre–noviembre)

**`estado`** — `abierto` · `pronto` · `lleno` · `online` · `realizado`

### ⚠️ Cuidado con la puntuación

El archivo es JSON y es estricto:

- Cada valor de texto va **entre comillas dobles**: `"Taller de caligrafía"`
- Los números van **sin comillas**: `12`
- Cada línea termina en **coma**, excepto la última de cada bloque
- El último evento de la lista **no lleva coma** después de su `}`

Si algo queda mal escrito, GitHub te avisa con un ⚠️ antes de guardar.

---

## Cómo publicar un reportaje

Los reportajes de la Comisión Xuexi viven en
**[`data/reportajes.json`](data/reportajes.json)**. Copia el bloque `_ejemplo`
dentro de la lista `reportajes` y edítalo:

| Campo | Qué va |
|---|---|
| `titulo` | Nombre del reportaje |
| `autor` | Quién lo escribió |
| `area` | Una de las seis áreas del Art. 5 |
| `fecha` | Año-mes-día, ej. `"2026-05-20"` |
| `resumen` | Dos o tres líneas que inviten a leerlo |
| `enlace` | Si está publicado en otro lado (Instagram, Drive, Medium) |
| `archivo` | Si subes el PDF a `assets/reportajes/`, su nombre |

Puedes usar `enlace`, `archivo`, ambos o ninguno. Los filtros por área
aparecen solos, según las áreas que tengan reportajes.

Mientras la lista esté vacía, la sección invita a enviar trabajos en vez de
verse rota.

---

## Cómo actualizar el equipo

El equipo vive en **[`data/equipo.json`](data/equipo.json)** y se edita igual que la agenda,
con el lápiz ✏️ de GitHub. Está dividido en:

- `coordinacion.mesa` — presidencia, vicepresidencia, secretaría y tesorería
- `coordinacion.coordinadores` — coordinaciones de comisión y del Club de lectura
- `comisiones` — los equipos de trabajo de Xuexi, Wailian y Xinxi
- `fundadores` e `historia` — la memoria del club

Cuando cambie la coordinación, basta con editar este archivo: la página se arma sola.

### Fotos de las personas

1. Sube el retrato a la carpeta **`assets/equipo/`**
2. En `equipo.json`, escribe el nombre del archivo en el campo `foto` de esa persona

```json
{ "nombre": "Andrea Díaz Inzunza", "foto": "andrea.jpg" }
```

Mientras el campo esté vacío se muestra un **monograma con las iniciales**, así que la
página nunca se ve rota aunque falten fotos. Formato cuadrado, 400 × 400 px y menos de
200 KB por foto.

---

## Cómo agregar una foto a un evento

1. Entra a la carpeta **`assets/`**
2. **Add file → Upload files** y arrastra la imagen
3. Nómbrala simple, sin espacios ni tildes: `taller-te.jpg`
4. En `data/eventos/<id>.json`, escribe la ruta en el campo `imagen`

Recomendación: imágenes de menos de 500 KB para que el sitio cargue rápido.

---

## Para desarrollar localmente

```bash
git clone https://github.com/qgerman2/xuexi-web-dev.git
cd xuexi-web-dev
python3 tools/construir-sitio.py
python3 -m http.server 8000 --directory _site
```

Luego abre http://localhost:8000

> ⚠️ **No abras `index.html` con doble clic.** La agenda se carga con `fetch()`
> desde `data/eventos.json`, y los navegadores bloquean esa petición bajo el
> protocolo `file://` (política CORS). Verías el sitio sin eventos.
> Con el servidor local anda bien.

La construcción usa solo Python 3 y su biblioteca estándar. Genera la agenda y
las páginas con etiquetas Open Graph dentro de `_site/`, junto con los archivos
públicos. Vuelve a ejecutar la construcción después de editar las fuentes.

Pruebas de la construcción:

```bash
python3 -m unittest discover -s tools -p 'test_construir_sitio.py'
```

---

## Estructura del proyecto

```
├── index.html          Portada
├── evento.html         Plantilla común de los eventos
├── admin.html          Editor de contenidos
├── data/
│   ├── eventos/        ← Un JSON por evento; esto es lo que se edita.
│   ├── equipo.json     ← El equipo y la coordinación.
│   └── reportajes.json ← Los reportajes publicados.
├── assets/             Imágenes: logo, sello y fotos de actividades
│   ├── equipo/         Retratos de las personas
│   └── reportajes/     PDF de los reportajes
├── tools/              Construcción y pruebas
├── _site/              Sitio generado; ignorado por Git
├── CNAME               Dominio personalizado, si está configurado
└── .nojekyll           Config de GitHub Pages (no tocar)
```

---

## Para quien administre el sitio

### Dominio y hosting

- **Dominio:** `xuexiclub.cl`, registrado en [NIC Chile](https://www.nic.cl)
  a nombre de `xuexiclub.uc@gmail.com`
- **Hosting:** GitHub Pages mediante GitHub Actions al actualizar `main`
- **HTTPS:** certificado automático de GitHub — verificar que
  *Settings → Pages → Enforce HTTPS* esté activado

### Activar la publicación por GitHub Actions

Una sola vez, selecciona **Settings → Pages → Build and deployment → Source →
GitHub Actions**. Después de guardar estos cambios en `main`, el workflow
**Publicar sitio** construye `_site/` y lo despliega directamente. También se
puede iniciar desde **Actions → Publicar sitio → Run workflow**.

El workflow obtiene la URL pública desde la configuración de Pages para generar
las etiquetas de cada evento. No crea commits de archivos generados ni necesita
un token personal adicional. Para una construcción local con otra URL pública:

```bash
XUEXI_SITIO=https://example.com python3 tools/construir-sitio.py
```

### DNS — cómo está armado

NIC Chile **no permite crear registros `A`**, solo delegar a servidores de
nombre. Por eso el DNS lo administra **Cloudflare** (plan Free):

- **NIC Chile** → *Configuración Técnica* → *Servidores DNS*:
  `kaiser.ns.cloudflare.com` y `lina.ns.cloudflare.com`
- **Cloudflare** → *DNS → Records*:

| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| A | `@` | 185.199.108.153 | DNS only |
| A | `@` | 185.199.109.153 | DNS only |
| A | `@` | 185.199.110.153 | DNS only |
| A | `@` | 185.199.111.153 | DNS only |
| CNAME | `www` | xuexi-club-uc.github.io | DNS only |

> ⚠️ **El proxy debe quedar en "DNS only" (nube gris).** Con la nube naranja,
> GitHub no puede emitir el certificado HTTPS y el sitio entra en un bucle de
> redirección.

La cuenta de Cloudflare también debe estar a nombre de `xuexiclub.uc@gmail.com`,
por la misma razón que el dominio y la organización de GitHub.

### 🔴 Renovación del dominio — no olvidar

El dominio `.cl` **se renueva cada año** ([~$9.990, exento de IVA](https://www.nic.cl/dominios/tarifas.html)).
Si vence, el sitio se cae y el dominio queda libre para que otro lo tome.

- Verificar que el contacto en NIC Chile sea `xuexiclub.uc@gmail.com`
- **Recomendado:** pagar varios años por adelantado (5 años ≈ $50.000) para que
  no dependa del recambio de directiva
- Dejar un recordatorio en el calendario compartido del club

### Continuidad de la directiva

Este repositorio vive en una **organización** de GitHub, no en una cuenta personal.
Cuando cambia la directiva:

1. *Settings → People → Invite member* → agregar a los nuevos como **Owner**
2. Quitar a quienes egresaron
3. Confirmar que siempre haya **al menos dos Owners** activos

---

## Diseño

La identidad visual y el sistema de diseño están documentados en los PDF que
mantiene la Comisión Xinxi (信息):

- `XUEXI-CLUB-moodboard.pdf` — dirección de arte, paleta, tipografía y componentes
- `XUEXI-CLUB-propuesta-web.pdf` — todas las pantallas

**Paleta:** granate `#4E0A0A` · bermellón `#A81E1E` · oro `#C9A24B` ·
crema `#F5EFE6` · jade `#2E7D6B` (solo para botones de acción)
