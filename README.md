# 3D Model Website Prototype

A three.js prototype of a pottery web store laid out like a late-90s desktop. Each piece sits in its own window that you can drag by the title bar. The models spin slowly and lean toward the cursor. You can grab a model to rotate it, and clicking one opens its product page.

## Run locally

There's no build step. Serve the folder over HTTP, since ES modules and the `.glb` won't load from `file://`:

```sh
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Files

- `index.html`: the desktop page. three.js is loaded from a CDN via an import map.
- `main.js`: windows, dragging, orbiting, and the lean and spin animation. The `PRODUCTS` list at the top holds each window's model and link.
- `style.css`: the desktop and window styling.
- `product.html`: placeholder product page.
- `assets/`: 3D models (`.glb`).
