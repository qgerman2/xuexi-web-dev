# Handoff — Xuexi editor, Instagram and event pages

Updated: 2026-10-23. Repository: `qgerman2/xuexi-web-dev`.

This document records the final implementation and the user's preferences from this session. Read the current code before changing behavior; deployed Workers can differ from their repository copies.

## Repository state

- Development repository and Firebase project; do not confuse this with the club's production infrastructure.
- Firebase project: `xuexi-sandbox-01`. Public SDK configuration is in `assets/firebase-config.js`; the key and project also match `wrangler.toml`.
- At handoff creation, `main` was clean and aligned with `origin/main`, at `968e850`.
- The last pull merged divergent histories using `git pull --no-rebase`, without conflicts. It brought in two uploaded images and their gallery references for `estudiar-en-china`.
- `PANEL.md` remains on disk but is intentionally excluded locally using `/PANEL.md` in `.git/info/exclude`, at the user's request. Do not re-add it. It describes the earlier architecture; some details are now outdated.
- No local HTTP server was started during testing. Browser tests intercepted requests to the GitHub Pages origin and served local files.
- Do not assume temporary files under `/tmp` will exist in a later session.

## User preferences to preserve

- Call the editing application **Editor**, not “Panel del equipo” or “Panel de edición.” User-facing titles, member links and footer links were updated, along with the old OAuth login page's source label.
- Keep explanatory UI text short.
- Event banners must remain static, without sticky scrolling.
- The event layout must follow this order:
  1. Banner on the left; information card on the right.
  2. First text block below the whole top row.
  3. Image carousel.
  4. Second text block below the carousel.
- The information card contains the title, status, date/day, time, location, optional Instagram link and registration action. Avoid repeating logistics in multiple cards.
- Do not introduce a visible “how the event went” section. The second text block provides room for later writing without a separate heading.
- Preserve Xuexi's existing burgundy, cream, gold, serif typography and Chinese accents.
- Event-card descriptions in `eventos.html` are capped at **three lines**; full text remains on the event page.

## Event content and generation

Source files are `data/eventos/<id>.json`. The filename must match the `id` field.

```text
data/eventos/<id>.json
    → tools/agregar-eventos.py
data/eventos.json
    → tools/generar-paginas-evento.py + evento.html
evento/<id>/index.html
```

`data/eventos.json` and `evento/*/index.html` are generated outputs. Change source data or the template, then regenerate rather than editing outputs directly:

```sh
python3 tools/agregar-eventos.py
python3 tools/generar-paginas-evento.py
```

The Agenda workflow in `.github/workflows/agenda.yml` regenerates after source-event/template changes on `main`. Its push retries preserve concurrent edits. Generated paths are deliberately excluded from its triggering paths.

The event `id` determines its public URL and source JSON filename. It must not change after publication. Decap media is independent of the identifier and uses `assets/eventos/medios/`; the separate published-event gallery uploader still uses per-event folders.

### Event fields added or clarified

| Field | Purpose |
|---|---|
| `detalle` | First text block, before the carousel; receives the Instagram caption. |
| `detalleFinal` | Optional text block after the carousel; never overwritten by Instagram import. |
| `horaFin` | Optional finishing time, formatted as `HH:MM`. |
| `inscripcion` | Optional HTTPS registration URL. |
| `instagram` | Optional HTTPS Instagram post URL. |
| `imagen` | Cover/banner image. |
| `galeria` | Remaining carousel images; source strings or arrays are normalized by the aggregator. |
| `cupos` | Optional number, beside Lugar in Decap. The label is Capacidad in Decap and the information card. Blank or missing values display Ilimitado; an explicit 0 hides the row. The stored field remains cupos. |

Registration is offered for future events with `estado: abierto` or `online`. Full, forthcoming or completed events do not show an open-registration action. An absent registration URL retains the existing generic form fallback.

The banner is excluded from the carousel when its exact path is repeated in `galeria`. Empty galleries are hidden publicly; admins can still access the upload UI.

## Shared public view and Decap preview

| File | Responsibility |
|---|---|
| `evento.html` | Public shell, gallery/lightbox controller, authentication and admin upload integration. |
| `assets/evento-vista.js` | Shared pure HTML renderer, formatters and initial-gallery path normalization. Exposes `window.XuexiEventoVista`. |
| `assets/evento.css` | Shared event layout styles. |
| `assets/site.css` | Existing site-wide visual system and base gallery/lightbox styles. |
| `admin/preview-evento.js` | Decap React preview for the `agenda` collection. Uses the shared renderer and styles. |
| `admin/index.html` | Firebase gate, Decap bootstrap, preview registration and existing-ID locking. |

Do not duplicate event layout markup or CSS in the preview. Update the shared files so both views stay consistent.

Decap remains pinned to **3.17.1**. Its DOM is used for imports, so test injection and access before upgrading.

`admin/index.html` sets `CMS_MANUAL_INIT` before loading Decap, registers the preview on script load, then calls `CMS.init()`.

The custom preview:

- Updates the banner, information card and both text blocks from draft fields.
- Immediately previews downloaded Instagram images while a new event still has a blank identifier. `window.XuexiIGVistaPrevia` provides a temporary, route-scoped overlay consumed by the React preview. The importer creates and revokes object URLs; these URLs never become saved entry fields. Completion switches back to native Decap draft assets, and cancellation removes the overlay.
- Resolves images using Decap's `getAsset`, including in-memory/blob media.
- Handles Decap's temporary `empty.svg` asset proxy: use the actual public URL while that placeholder is returned, rather than displaying the same blank SVG for every photo.
- Supports carousel arrows, thumbnails, keyboard interaction and a lightbox.
- Does not initialize Firebase or perform content writes.
- Reflects responsive breakpoints at the preview pane's actual width, so a narrow pane shows the mobile stack.

All shared `assets/` references currently use **`?v=32`**, consistently across pages. `admin/preview-evento.js` uses `?v=4`; `admin/instagram-media.js` uses `?v=5`. When changing shared assets, update cache versions together and regenerate event pages. Earlier mismatched Firebase script versions caused login/portal redirect loops.

## Editor access and navigation

- `admin.html` is the surrounding editor page: Firebase login, role check, Decap iframe and Instagram sidebar.
- `admin.html?evento=<id>` opens that exact event at `admin/#/collections/agenda/entries/<id>`.
- Public event pages show **Editar evento** only for admins.
- `miembro.html` shows an **Editor** button linking to `admin.html` only for admins.
- Decap field order starts **Identificador → Título → Estado → Fecha**.
- Existing-entry identifiers are read-only, with the warning “El identificador no se puede cambiar después de publicar.” New-entry identifiers remain editable.
- Identifier help text is “Es la dirección del evento (/evento/<id>/).”
- The identifier lock is UI behavior in `admin/index.html`, not a replacement for server authorization.

## Instagram Worker

Source: `admin/instagram-worker.js`.

Endpoint: **`https://ig.qgerman2.workers.dev/instagram/posts`**.

This is a separate Cloudflare Worker, deployed by pasting its source in the Cloudflare dashboard. Variables:

| Variable | Type |
|---|---|
| `IG_ACCESS_TOKEN` | Secret |
| `FIREBASE_API_KEY` | Text; same SDK key as the development site |
| `FIREBASE_PROYECTO` | Text; `xuexi-sandbox-01` |
| `IG_TOKEN_KV` | Private KV namespace binding dedicated to the Instagram Worker |

The browser sends its **Firebase ID token** as `Authorization: Bearer ...`. The Worker validates the session, reads `miembros/{uid}` using that token, checks `rol === 'admin'`, then fetches up to ten posts from `graph.instagram.com/v25.0/me/media`.

- Role is checked on every Instagram request.
- The Instagram secret never reaches the browser.
- Responses include selected post/media fields and carousel children.
- Pagination URLs are intentionally omitted because they can contain credentials.
- Responses use `Cache-Control: no-store`.
- CORS allows the site/GitHub Pages origins recorded in the source. The Instagram Worker does not currently allow localhost.
- This endpoint accepts Firebase ID tokens, **not** the other Worker's `xs1.…` sessions.

Live tests returned: admin `200`, non-admin `403`, no/invalid token `401`, valid browser preflight `204`.

Latest live follow-up after the user configured Cloudflare: admin `/instagram/posts` returned `200` with two posts; member requests to posts and images returned `403`; anonymous requests returned `401`; unknown image IDs returned `404`; blocked origins returned `403`; image preflight returned `204`. Image downloads initially returned `502`. The problem was `redirect: 'error'`, accepted by Node's fetch but rejected by the real Cloudflare workerd runtime. Both image downloads and token refresh now use `redirect: 'manual'` and reject non-success responses, including redirects. The user redeployed the corrected source. Live retest passed: both image downloads returned `200 image/jpeg` with valid JPEG signatures (76,064 and 60,505 bytes), allowed-origin CORS worked, and all authorization, unknown-image, blocked-origin and preflight checks passed again.

### Automatic token refresh (deployed; live scheduled run unverified)

The Worker now exports a scheduled handler. Configure the daily Cron Trigger `0 9 * * *` (09:00 UTC). It normally refreshes every seven days, or earlier when seven days or less remain before expiry, and never attempts another refresh within 24 hours of the last successful refresh. A failed attempt throws so Cloudflare records a failed invocation and the next daily trigger retries.

Refresh calls `https://graph.instagram.com/refresh_access_token` with `grant_type=ig_refresh_token`. The returned token, refresh timestamp and expiry are stored privately under `instagram:token` in `IG_TOKEN_KV`, without a TTL. Admin post requests read this persisted token. The initial `IG_ACCESS_TOKEN` must be a valid long-lived token; Meta requires it to be at least 24 hours old for refresh. An expired or revoked token requires operator recovery with a new valid long-lived secret.

Deployment steps in the Cloudflare dashboard:

1. Create a dedicated private KV namespace and bind it to the **ig** Worker as `IG_TOKEN_KV`.
2. Deploy the updated `admin/instagram-worker.js`, retaining the existing variables and bootstrap secret.
3. Add Cron Trigger `0 9 * * *` to **ig**, then check scheduled invocation logs after it runs. The code alone does not configure a trigger.

Do not deploy the root `wrangler.toml` for this task: it targets the separate GitHub/editor Worker. The user reported deploying and configuring KV/cron in the dashboard. The user also redeployed the redirect compatibility fix, and live image downloads now pass. No live scheduled refresh has been verified; there is no connected Cloudflare management tool to inspect its logs or trigger it.

The stored record includes a SHA-256 fingerprint of the bootstrap secret. Replacing `IG_ACCESS_TOKEN` makes requests ignore the old stored record and lets the next successful scheduled run establish a new lifecycle. Tokens and credential-bearing upstream errors are never logged or returned. Missing KV still allows the old HTTP bootstrap flow during rollout, but scheduled refresh explicitly fails until KV is bound.

Verification: `node --test tools/test-instagram-worker.cjs` passes ten mocked tests covering persistence, scheduling thresholds, secret rotation, failures, expired credentials, admin authorization, download ownership, allowed destinations, file types and size limits. These do not verify a live Meta refresh. References: [Meta refresh endpoint](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Also run `tools/test-instagram-runtime.cjs` with Miniflare. This executes the actual Worker in workerd with mocked upstreams, verifies scheduled refresh persists into a KV binding, verifies HTTP reads the renewed token and serves image bytes, and verifies redirects are rejected. It caught the runtime incompatibility that the Node tests missed. Example:

```sh
npm install --prefix /tmp/xuexi-worker-runtime miniflare --no-save --no-package-lock
NODE_PATH=/tmp/xuexi-worker-runtime/node_modules node --test tools/test-instagram-runtime.cjs
```

## Instagram sidebar and DOM import

Implemented in `admin.html`, using `window.PanelXuexi` helpers to access Decap's same-origin iframe.

Clicking a post:

- Opens a new Agenda event if no event form is open; avoids overwriting another collection's editor.
- Imports the full caption into **Detalle**, the text block before the carousel.
- Leaves **Identificador** and **Título** untouched. New events therefore keep them blank; manually entered/published values are preserved.
- Downloads images through the authenticated Worker and queues them in Decap's native media library. The first becomes the cover and the others the gallery, preserving order and skipping videos.
- Fills the Instagram permalink.
- Preserves `detalleFinal`, event date and other unrelated fields.
- Does not publish the entry.

Native value setters and events must come from the iframe's own window. Using the parent's constructors breaks cross-frame textarea/input detection.

Image-widget injection clicks Decap's URL action and temporarily overrides its synchronous `window.prompt`. In the pinned version the result is passed directly to `onChange`, which accepts an array for the gallery. Always restore the original prompt in `finally`.

### Instagram image downloads and repository imports (Worker deployed and tested)

`admin/instagram-media.js` now downloads images into in-memory blobs, creates `File` objects, and supplies them through Decap 3.17.1's native media dialog file input. It waits for each file to appear in the draft library before continuing. This registers actual media assets with Decap rather than just changing image URLs. Decap uploads the assets and the event JSON together when the editor publishes; a browser test verified one Git tree and commit containing both photos and the event JSON.

**Latest user requirement: importing photos is completely independent of the identifier.** For new events, the identifier and title start blank. Imports immediately download and stage photos through Decap, including when the identifier is empty or invalid. There is no identifier wait, blur/debounce handler, temporary ID lock or ID-dependent image-path rewrite at publish time. The identifier is required only by the ordinary event form validation when publishing.

Agenda's `media_folder` and `public_folder` in `admin/config.yml` now point to the fixed **`assets/eventos/medios/`** folder. Both imported images and future manual Decap uploads use it. The importer uses the same fixed folder and unique filenames containing Instagram media IDs plus random suffixes. Changing an event ID never moves these photos or changes their paths. Existing photos in `assets/eventos/<old-id>/` are not moved or rewritten; the image widget wrapper and preview resolve those legacy references through their existing public paths, relative to the site's deployment base. The separate uploader on already published event pages still uses per-event folders.

The first image becomes the cover and the remaining ones become the gallery. Files stay in Decap's in-memory draft queue until publishing saves the photos and event JSON together in one commit. There is no added localStorage/IndexedDB draft store. Reloading during a download loses that unfinished import. Repeated imports use unique names; Decap deduplicates its draft queue by content SHA.

`PanelXuexi.validarImportacion` is now only a preSave guard against publishing during an active import; it returns no replacement data. All image-path migration logic, retained parent media metadata and ID observers were removed. The user explicitly rejected automatic photo updates on ID changes as disorienting. Keep editing quiet: no media dialogs, progress churn, focus stealing, photo restaging or extra downloads when the identifier changes. Published identifiers remain read-only.

`admin/preview-evento.js` retains a per-route cache of in-memory AssetProxy objects, shared by the preview and a thin wrapper around the native image control. The wrapper preserves validation and media-picker behavior and handles legacy public paths outside the new shared folder. Draft fields retain repository paths, never temporary blob URLs.

Cancellation is available during initial downloads and disabled briefly while native queue uploads run. Session changes and navigation abort the import. Download failures show an error without falling back to Instagram URLs. A staging error can leave unused files in Decap's draft queue; discard the draft if those assets should not be committed.

New Worker route: **GET `/instagram/media/<numeric-media-id>`**. It performs the same Firebase session and current-admin checks as `/instagram/posts`, finds the image in the authenticated IG account's latest ten posts (including carousel children), and fetches its current URL. It accepts no caller-supplied URL, restricts HTTPS destinations to `fbcdn.net`/`cdninstagram.com`, rejects redirects, never forwards credentials to the CDN, and accepts only JPG/PNG/WEBP up to 20 MB. The browser caps the complete import at 80 MB. The updated Worker is deployed to **ig**, and live image downloads have passed. The editor changes still need to be published with the website before users can use this flow there.

The browser regression test `tools/test-instagram-import.cjs` uses the real pinned Decap bundle with mocked Firebase, IG and GitHub endpoints, including all writes. It checks blank initial fields, caption import, loaded cover/gallery images in the actual preview iframe before an identifier exists, cancellation cleanup, download failure, native draft previews, Capacidad updates, hiding the row at 0 and Ilimitado when cleared. It also checks repeated quiet identifier edits: no media dialogs, status churn, focus stealing or additional downloads; both widget thumbnails and preview photos remain loaded. Imports finish with blank and invalid identifiers; legacy photos retain their original public paths. Publishing preserves a swapped cover/gallery and creates one commit containing two photos under `assets/eventos/medios/` plus the JSON named after the final event identifier. Identifiers lock after publishing. It needs Playwright and Chromium. Example, using dependencies installed outside the repository:

```sh
npm install --prefix /tmp/xuexi-ig-browser playwright --no-save --no-package-lock
curl -L https://unpkg.com/decap-cms@3.17.1/dist/decap-cms.js -o /tmp/xuexi-ig-browser/decap.js
NODE_PATH=/tmp/xuexi-ig-browser/node_modules CHROME_BIN=/opt/google/chrome/chrome DECAP_BUNDLE=/tmp/xuexi-ig-browser/decap.js node --test tools/test-instagram-import.cjs
```

The gallery uploader described next remains a separate flow for local files on an already published event. Existing events with Instagram CDN URLs are not migrated automatically; reimport and save to copy those photos.

## Photo uploads now use the repository

`assets/auth.js` is the existing shared Firebase/member module, exposed through `window.XuexiAuth`. It now also provides:

```js
XuexiAuth.subirFotosEvento(eventoId, files, caption, onProgreso)
XuexiAuth.subirFotoEvento(eventoId, file, caption, onProgreso) // compatibility wrapper
```

New uploads from both `evento.html` and `galeria.html` use the **same authenticated GitHub backend as Decap**, not Firebase Storage or new Firestore image documents.

- Backend `api_root`, `repo` and `branch` are read from `admin/config.yml`.
- Current backend: `https://panel.qgerman2.workers.dev/github`, repository `qgerman2/xuexi-web-dev`, branch `main`.
- Requires a signed-in admin and an existing source event with a matching ID.
- Accepts JPEG, PNG and WEBP, nonempty and at most 20 MiB per image.
- Files go under `assets/eventos/<id>/`, with unique names.
- **All selected photos and the updated event JSON are published in one commit.**
- Uses Git blobs, a tree based on the current commit's tree, a commit with the current parent, and a reference update with `force: false`.
- Retries conflicting reference updates up to three attempts, rereading the latest event data and preserving another editor's changes. Existing image blobs are reused during retry.
- A failure while preparing a batch does not publish a partial gallery update.
- Local blob previews show successful uploads immediately while the Action/Pages build catches up.
- Failed batches retain selected files for retry and do not falsely report success.

Legacy Firestore/Storage photo reads and deletion remain for old photos. New repo-backed photos do not use the legacy delete button; manage repository media through the editor.

Before this switch, a live tiny-image test showed Storage returning `404` and the old code falling back to a Data URL in Firestore. That test document was removed. Do not reintroduce the unbounded Data URL fallback.

### GitHub Worker behavior

Source: `admin/oauth-worker.js`; configuration reference: `wrangler.toml`.

The Worker keeps `GITHUB_BOT_TOKEN` server-side, accepts Firebase sessions or signed editor sessions, proxies GitHub requests, and records the editing member as commit author. Cloudflare deployments are manual; `wrangler.toml` is a development reference and must not accidentally overwrite production.

**Documentation discrepancy to remember:** `PANEL.md` says roles are rechecked on every request. In the current GitHub Worker, Firebase validation is cached for 60 seconds, and `xs1.…` sessions are verified by signature/expiry without another Firestore role lookup. Those signed sessions last eight hours; rotating `SESION_SECRETO` invalidates them. The separate Instagram Worker does perform a fresh role check per request.

## Example event and share previews

The baseline event is `data/eventos/estudiar-en-china.json`, published at `/evento/estudiar-en-china/`.

- Source post: `https://www.instagram.com/p/DezrO6pEXE9/`.
- Title: “¿Cómo es estudiar en China?”
- October 29, 2026, 10:00–11:30, online.
- Registration: `https://forms.gle/VZZRjGNvZ7uY1GEk8`.
- `portada.jpg` and `galeria-01.jpg` are local copies of the post's two slides.
- The longer sample description was split between the text before and after the carousel. It is an expanded invitation, not an invented account of an event that already happened.
- The latest pull added two more images to its gallery. Preserve those additions.

`tools/generar-paginas-evento.py` generates event-specific title, description, canonical URL, Open Graph and Twitter metadata. Sharing uses the cover image, event title and a shortened description; no social screenshot of the page is generated. Image and page URLs are absolute, based on `XUEXI_SITIO`.

Actual LinkedIn and Instagram-chat card rendering/cropping was **not** verified in the apps. Portrait posters may be cropped by a wide card. No dedicated landscape share-art system was implemented, and no definitive ToS compliance assessment was completed.

## Verification performed

Historical checks from this session, not a claim of a permanent test suite:

- Public page: desktop/mobile layout, static portrait banner, exact content order, registration state/URL, optional Instagram link, both text blocks, gallery controls, lightbox and keyboard focus.
- Agenda descriptions: measured maximum three visible lines at desktop and mobile widths.
- Real Decap 3.17.1: Firebase access, existing-entry deep link, ID lock, field order, styled preview, image decoding, live field changes, gallery navigation, thumbnails, lightbox, status-dependent registration and caption import preserving the final text.
- Admin/non-admin visibility for event editing, uploads and the member-page Editor button.
- Repo upload: two real images uploaded to a temporary branch; verified **one commit**, exactly two image files plus one event JSON, correct gallery references and byte-for-byte image contents. The temporary branch was deleted. `main` was not used for this test.
- Batch logic: conflict retry preserving concurrent edits, no partial publication on failure, invalid-file rejection and non-admin rejection.
- JavaScript syntax, Decap YAML/field order, consistent asset cache versions and `git diff --check`.

Browser tests used Playwright from a temporary installation and the installed Chrome binary, with local responses served under the real GitHub Pages origin. No test entry was published through Decap. Development account credentials were supplied in conversation; passwords/tokens are intentionally not recorded here.

`tools/test-subida-fotos.cjs` existed earlier but is no longer present in the repository. Do not assume a package-based test command exists. Temporary browser scripts are not a maintained test suite.

## Quick checks for future changes

```sh
git status --short
git diff --check
node --check assets/evento-vista.js
node --check admin/preview-evento.js
node --check assets/auth.js
```

For HTML inline scripts, extract their contents and pipe them to `node --check`; checking the HTML itself as JavaScript is not valid. The module Workers can be syntax-checked with `node --input-type=module --check < admin/instagram-worker.js`.

Regenerate event outputs when changing `evento.html` or event data. Check shared view changes in both the public page and actual Decap. Never expose IG/GitHub secrets, silently re-add `PANEL.md`, or replace the agreed layout with an older sticky/duplicate-card design.
