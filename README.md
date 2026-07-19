# rohitmukherjee.com

Static site built with Jekyll on GitHub Pages.

## Adding an essay

Create a text file in `_essays/` named `YYYY-MM-DD-slug.md` with this header
and then write in markdown:

```
---
title: Your title here
date: 2026-07-19
excerpt_line: Optional one-line summary shown on the homepage.
---

Your essay body here. Plain text. Use `#` for headings, `**bold**` for
bold, and `[text](https://url)` for links.
```

Commit and push. GitHub rebuilds the site and the essay appears at the top
of the list on the homepage.

## Replacing the CV

Overwrite `assets/cv.pdf` with your real CV. The download link on the
homepage picks it up automatically.

## Editing the tools list

The Tools section is in `index.md`. Copy the `<article class="tool">` block
to add another one.

## Layout files

- `index.md` &mdash; homepage (Essays / CV / Tools sections)
- `_essays/` &mdash; individual essays
- `_layouts/default.html` &mdash; page shell (header, main, footer, theme picker)
- `_layouts/essay.html` &mdash; essay page wrapper
- `_includes/` &mdash; header, footer, `<head>` partial
- `assets/css/main.css` &mdash; all styling; three themes via `[data-theme]` CSS variables
- `_config.yml` &mdash; Jekyll config

## Local preview (optional)

```
bundle install
bundle exec jekyll serve
```

Not required &mdash; GitHub Pages builds on push.

## Existing tools

Live as pass-through subdirectories:

- `singapore-apartment/` &mdash; the property calculator
- `cs416/` &mdash; the older CS416 project

Their HTML files have no Jekyll front matter, so Jekyll copies them
verbatim into the built site.
