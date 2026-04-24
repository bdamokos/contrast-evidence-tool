# Contrast Checker

A static browser tool for reviewing text contrast in screenshots and design PDFs.

## What it does

- Upload PNG, JPEG, WebP, or PDF files.
- Paste screenshots from the clipboard with Ctrl/Cmd + V.
- Render selected PDF pages into reviewable images.
- Draw numbered rectangles around text regions.
- Extract likely foreground and background colors from each rectangle.
- Calculate WCAG contrast ratios in the browser.
- Manually override sampled colors when anti-aliasing or gradients make the automatic guess imperfect.
- Export a PDF evidence report with annotated screenshots, crop previews, hex values, ratios, and pass/fail results.

All processing happens in the browser. There is no backend.

## Run locally

Use any static file server:

```sh
npm start
```

Then open:

```text
http://localhost:8000
```

Opening `index.html` directly may work for images, but PDF rendering is more reliable from a local server.

## Smoke check

This is intentionally a browser smoke test, not a big unit-test suite:

```sh
npm test
```



## Notes on accuracy

Raster screenshots include anti-aliased text, shadows, gradients, compression artifacts, and blended pixels. The automatic sampler clusters colors and makes a best-effort foreground/background guess, but the sampled hex values are editable by design. The exported report shows the exact values used for the WCAG calculation.
