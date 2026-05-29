# ASI Cayman Theme — netAdventist

A clean, modern, warm theme for **ASI Cayman** — the Cayman Islands chapter of
Adventist-Laymen's Services & Industries. It supports the public site (Home,
About, Membership, Business Directory, Contact, News, Events) and the **ASI
Cayman Business & Career Expo 2026** campaign (Expo 2026 + Expo Registration).

- **Style:** navy, blue, white, gold, and subtle Caribbean teal/aqua; large
  readable type; strong call-to-action buttons; mobile responsive; accessible
  contrast; print-friendly.
- **Voice:** mission-focused, trustworthy, community-centered — professional
  without feeling cold or corporate.

---

## Folder structure

```text
asi-cayman-theme/
  about.yml                      # Theme metadata (title, version, extensions)
  containers.yml                 # Named content regions
  layouts.yml                    # Page layouts + grids + preloaded widgets
  liquid_layouts.yml             # Maps layout slugs -> Liquid template files
  liquid_layouts/
    home.html.liquid             # Homepage (hero, impact, Expo, audience, widgets)
    page.html.liquid             # Standard content page (page_show)
    news_entry_show.html.liquid  # Single news article
    news_entry_index.html.liquid # News listing
    events_widget.html.liquid    # Events widget render template
    news_entry_widget.html.liquid# News widget render template
    common/
      _header.html.liquid        # Partial: logo + nav + mobile toggle
      _footer.html.liquid        # Partial: contact, links, copyright
      _cta.html.liquid           # Partial: reusable call-to-action band
  assets/
    css/
      asi-cayman.css             # All theme styles
    js/
      asi-cayman.js              # Mobile menu + a11y enhancements (no deps)
    images/
      README.md                  # Where to drop the logo/hero images
  README.md                      # This file
  UPLOAD_CHECKLIST.md            # Step-by-step go-live checklist
```

---

## Upload instructions

1. **Zip the theme** (see *How to zip the package correctly* below). The zip
   must contain the files **at its top level** (or inside a single
   `asi-cayman-theme/` folder — confirm which your instance expects; top-level
   is the safest default).
2. In netAdventist, go to **Site Content → Settings → Theme and Templates →
   Themes for Designers**.
3. Choose **Upload / Import theme** and select your `.zip`.
4. After it imports, **apply/activate** the *ASI Cayman Theme*.

---

## Setup instructions after upload

1. **Enable required extensions** (see *Extension notes*): News, Events,
   Slideshow, Document Groups.
2. **Create the pages** and match their URLs/slugs to the navigation in
   `common/_header.html.liquid`:
   - `/` (Home), `/about`, `/expo-2026`, `/membership`, `/directory`,
     `/contact`, `/expo-registration`, `/news`, `/events`.
   - If your slugs differ, update the `href`s in `_header.html.liquid` and
     `_footer.html.liquid`.
3. **Assign Liquid layouts** to the right page types (Home → `home`, content
   pages → `page_show`, news → `news_entry_show` / `news_entry_index`).
4. **Confirm preloaded widgets** appear (News in the content area, Events in the
   sidebar). If they don't auto-render, see *Liquid testing notes*.
5. **Replace placeholder images/logo** (see `assets/images/README.md`).
6. **Verify Expo CTAs and contact details** (email, WhatsApp, venue, pricing).

---

## Extension notes

`about.yml` declares these required extensions:

```yaml
required_extensions:
  - news
  - events
  - slideshow
  - document_groups
```

- **news** — powers News/Updates pages and the News widget
  (`news_entry_show`, `news_entry_index`, `news_entry_widget`).
- **events** — powers the Events widget and `/events`.
- **slideshow** — reserved for an optional hero/gallery slideshow (the theme
  works without it; included so designers can add one).
- **document_groups** — reserved for the Business Directory / membership
  documents and downloadable resources.

> **Compatibility caveat:** extension **slugs vary between netAdventist
> builds.** The names above are the conventional ones, but your instance may
> use e.g. `news_entries`, `event`/`calendar`, `slideshows`, or
> `document_group` (singular). If an extension fails to resolve on import:
> 1. Check the exact slug under your site's **Extensions** list.
> 2. Update the matching entry in `about.yml` **and** the `extension:` value in
>    `layouts.yml` `preloaded_widgets` so they agree.
> 3. Re-zip and re-upload. Mismatched slugs are the #1 cause of "widget not
>    rendering" after upload.

---

## Image replacement notes

The theme ships with a **text logo** ("ASI") and CSS gradients instead of photos
so it works immediately with no assets. To brand it:

- Drop your logo at `assets/images/asi-cayman-logo.png` and swap the text mark in
  `common/_header.html.liquid` for an `<img>` (snippet in
  `assets/images/README.md`).
- Optional: add a `hero.jpg` and reference it from `.asi-hero` in the CSS.
- Keep filenames lowercase with hyphens, and compress before uploading.

---

## Liquid testing notes

These files target standard netAdventist Liquid objects, but **some objects vary
by instance**. Test inside the netAdventist Liquid editor and adjust as needed:

- **Safe/standard:** `{{ site.name }}`, `{{ site.description }}`,
  `{{ page.title }}`, `{{ page.content }}`, `{{ news_entry.title }}`,
  `{{ news_entry.body }}`, `{{ news_entry.published_at }}`,
  `{{ site.widget_preferences.title }}`.
- **May need adjustment (commented in the files):**
  - Collection names: `news_entries`, `events`. Some builds use different
    variable names or require a tag to fetch them.
  - Item fields: `event.start_at`, `event.location`, `event.url`,
    `news_entry.url`, `news_entry.author`.
  - **Container output for preloaded widgets.** `home.html.liquid` includes a
    *guarded inline fallback* (loops over `news_entries`/`events`) so the page
    is never empty, plus commented markers (e.g. `{{ content_for_sidebar }}` /
    `{% widget_container 'sidebar' %}`) for builds that inject preloaded widgets
    into containers. Keep whichever your instance honors; delete the other to
    avoid duplicate output.
  - `asset_url` filter for images and `date` filter formatting.
  - Pagination on `news_entry_index.html.liquid` (`paginate.previous/next`).
- **Includes** use relative paths and underscore-prefixed partials, e.g.
  `{% include 'common/header' %}` → `liquid_layouts/common/_header.html.liquid`.

---

## Known assumptions

1. **Container/layout schema.** netAdventist's exact YAML schema for
   `containers.yml` / `layouts.yml` differs slightly across builds. This package
   uses a clean, conventional structure and keeps **container slugs identical**
   across `containers.yml`, `layouts.yml`, and the Liquid templates
   (`header, hero, content, feature, sidebar, footer`). If a key is rejected on
   import, remove the extra key — the slugs are the load-bearing part.
2. **`liquid_layouts.yml` value format.** Each mapping uses `template: <basename>`
   (the file without `.html.liquid`). If your build expects a `file:` key or a
   full path, change only the value format; keep the slugs.
3. **`home` mapping.** A `home` layout/slug is included in addition to the five
   requested mappings so the homepage template is wired up end-to-end.
4. **Navigation URLs** assume the slugs listed above; adjust if your pages
   differ.
5. **Extension slugs** are the conventional names; see *Extension notes*.
6. **Booth pricing, dates, venue, and contact info** are hard-coded from the
   ASI Cayman brief (Expo: Sun, June 28, 2026, 2:00 PM, The Lion Center; ASI
   members $100; early-bird $100 on/before May 31, 2026; regular $150 after).
   Update in the templates if details change.

---

## How to zip the package correctly

Zip the **contents** so the YAML files sit at the top of the archive (no extra
nested wrapper, no OS junk files).

**macOS / Linux (recommended — from *inside* the theme folder):**

```bash
cd asi-cayman-theme
zip -r ../asi-cayman-theme.zip . -x ".*" -x "__MACOSX" -x "*/.DS_Store"
```

This produces `asi-cayman-theme.zip` with `about.yml`, `containers.yml`, …,
`assets/` at the root of the zip.

> If your netAdventist instance instead expects the files **inside** a single
> `asi-cayman-theme/` folder within the zip, run from the parent directory:
> `zip -r asi-cayman-theme.zip asi-cayman-theme -x "*/.DS_Store"`. Try
> top-level first; switch only if the importer complains.

**Windows:** open the `asi-cayman-theme` folder, select **all** items
(`Ctrl+A`), right-click → **Send to → Compressed (zipped) folder**. Do **not**
zip the parent folder unless your instance requires the wrapper folder.

**Do not include:** `.DS_Store`, `__MACOSX`, `.git`, or editor temp files.

---

*Built for ASI Cayman — "Connecting Adventist Business, Ministry & Community Impact."*
