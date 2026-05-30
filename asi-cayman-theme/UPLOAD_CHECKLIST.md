# Upload Checklist — ASI Cayman Theme

Work top to bottom. Don't zip until everything in **A** and **B** is checked.

## A. Validate before zipping

- [ ] **Validate YAML.** `about.yml`, `containers.yml`, `layouts.yml`, and
      `liquid_layouts.yml` parse cleanly (spaces only, no tabs; quotes around
      `version: "1.0"` and URLs). Tip: paste each into a YAML linter, or run
      `python -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('*.yml')]"`.
- [ ] **Confirm folder structure** matches the tree in `README.md`
      (`liquid_layouts/`, `liquid_layouts/common/`, `assets/css`, `assets/js`,
      `assets/images`).
- [ ] **Confirm Liquid filenames** exist and are spelled exactly:
      `home.html.liquid`, `page.html.liquid`, `news_entry_show.html.liquid`,
      `news_entry_index.html.liquid`, `events_widget.html.liquid`,
      `news_entry_widget.html.liquid`.
- [ ] **Confirm partial paths.** Partials are underscore-prefixed
      (`common/_header.html.liquid`, `common/_footer.html.liquid`,
      `common/_cta.html.liquid`, `common/_slideshow.html.liquid`) and are
      included as `{% include 'common/header' %}`, `'common/footer'`,
      `'common/cta'`, `'common/slideshow'`.
- [ ] **Confirm CSS/JS paths.** `assets/css/asi-cayman.css` and
      `assets/js/asi-cayman.js` exist and are referenced wherever the theme
      loads assets.
- [ ] **Confirm required extensions** in `about.yml` (`news`, `events`,
      `slideshow`, `document_groups`) match your instance's actual extension
      slugs (see README → *Extension notes*). The `extension:` values in
      `layouts.yml` preloaded widgets must match too.
- [ ] **Confirm container names** are identical across `containers.yml`,
      `layouts.yml`, and the templates: `header, hero, content, feature,
      sidebar, footer`.
- [ ] **Confirm `liquid_layouts.yml` mappings** each point to a real file:
      `home→home`, `page_show→page`, `news_entry_show→news_entry_show`,
      `news_entry_index→news_entry_index`, `events_widget→events_widget`,
      `news_entry_widget→news_entry_widget`.

## B. Package

- [ ] **Remove junk** (`.DS_Store`, `__MACOSX`, `.git`, editor temp files).
- [ ] **Zip from inside the correct folder** so YAML sits at the zip root
      (see README → *How to zip the package correctly*).

## C. Upload & apply

- [ ] **Upload to netAdventist:** Site Content → Settings → Theme and
      Templates → **Themes for Designers** → upload the `.zip`.
- [ ] **Apply/activate** the *ASI Cayman Theme*.
- [ ] **Enable extensions** (News, Events, Slideshow, Document Groups).

## D. Test

- [ ] **Test homepage** — hero, impact intro, Expo feature + pricing, audience
      cards, and the News/Events widget area all render.
- [ ] **Test the hero slideshow (optional)** — with the Slideshow extension
      enabled and slides added, the hero shows cross-fading images behind the
      headline; with no slides it shows the gradient hero.
- [ ] **Test a standard page** (`page_show`) — About or Membership shows
      `{{ page.title }}` and `{{ page.content }}` correctly.
- [ ] **Test a news page** — `news_entry_index` lists entries;
      `news_entry_show` renders title, date, and body.
- [ ] **Test the events widget** — appears in the sidebar with upcoming events.
- [ ] **Test mobile view** — hamburger toggle opens/closes the menu, closes on
      Escape and outside click; cards/grids stack; buttons go full-width.

## E. Brand & content

- [ ] **Replace placeholder images/logo** (`assets/images/` + swap the text mark
      in `_header.html.liquid`; see `assets/images/README.md`).
- [ ] **Confirm Expo CTA links** point to the real Expo registration page
      (`/expo-registration` by default) on the home, page, feature, and footer
      CTAs.
- [ ] **Confirm contact details** in `_footer.html.liquid`:
      email `asicayman@gmail.com`, WhatsApp `345-324-0458`
      (`https://wa.me/13453240458`), location *Grand Cayman, Cayman Islands*.
- [ ] **Confirm Expo facts** on home/feature: Sunday, June 28, 2026 · 2:00 PM ·
      The Lion Center, Grand Cayman · Free admission · booth pricing
      ($100 members / $100 early-bird through May 31, 2026 / $150 regular).

---

✅ When every box is checked, the ASI Cayman theme is live and on-brand.
