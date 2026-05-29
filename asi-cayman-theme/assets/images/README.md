# Images — ASI Cayman Theme

This folder holds the theme's image assets. It ships **empty on purpose** (this
README is just a placeholder so the folder is preserved in the zip). Drop your
real images here and reference them from the templates/CSS.

## Recommended images to add

| Filename (suggested)        | Used for                                  | Suggested size            |
|-----------------------------|-------------------------------------------|---------------------------|
| `asi-cayman-logo.png`       | Header logo (replaces the "ASI" text mark)| ~240×64, transparent PNG/SVG |
| `asi-cayman-logo-white.png` | Footer logo on the navy background        | ~240×64, transparent PNG/SVG |
| `hero.jpg`                  | Optional hero background photo            | 1920×1080, optimized < 400 KB |
| `expo-2026.jpg`             | Expo feature / landing imagery            | 1200×800                  |
| `favicon.png`               | Browser tab icon                          | 64×64 (or 32×32)          |
| `og-image.jpg`              | Social share preview                      | 1200×630                  |

## How to reference an image

**In a Liquid template** (e.g. swap the text logo in `common/_header.html.liquid`):

```liquid
<img src="{{ 'asi-cayman-logo.png' | asset_url }}"
     alt="{{ site.name | default: 'ASI Cayman' }}" width="240" height="64">
```

> `asset_url` is the common netAdventist/Liquid helper for theme assets. If your
> instance doesn't expose it, use the literal path your theme assets resolve to
> (often `/themes/<theme>/assets/images/asi-cayman-logo.png`). Confirm the exact
> path in the Liquid editor after upload.

**In CSS** (e.g. add a hero photo) — paths are relative to `assets/css/`:

```css
.asi-hero { background-image: url("../images/hero.jpg"); background-size: cover; }
```

## Notes
- Keep file names **lowercase, no spaces** (use hyphens).
- Optimize/compress before upload; large images slow the site.
- Prefer SVG or transparent PNG for the logo so it sits cleanly on white and navy.
- Update the `alt` text to be descriptive and meaningful.
