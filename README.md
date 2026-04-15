# Rock Forge

A pixel-art rock processing game built with vanilla HTML, CSS, and JavaScript.

## The Idea

Everything follows one design loop:

```
[Source Material]
       ↓
   [Process]
       ↓
   [Product]
       ↓
 becomes source material again
```

You start with a rock. You apply a process. You get a product. Then you drag the product back and process it again — as many times as you want, in any order. There is no win condition; the fun is in seeing what combinations produce.

## Processes

| Process | Effect |
|---------|--------|
| **Flip** | Mirrors the rock horizontally |
| **Split Half** | Cuts the rock into two pieces you can select independently |
| **Mosaic Ruby** | Embeds clusters of red ruby gemstones into the surface |
| **Gold Plated** | Wraps a gold layer around the shape, making it physically thicker |

Processes compose freely:
- Gold plate a ruby-mosaic rock → gold with red inlays visible
- Split, then flip just one half
- Gold plate repeatedly → thicker and thicker gold layers
- Split a gold-plated rock → see the cross-section

## How to Play

1. **Drag** a rock from the sidebar into the **Source** box.
2. **Drag** a process into the **Process** box.
3. Click **🔥 FORGE 🔥** — watch the animation.
4. The **Product** appears. From here you can:
   - Drag it back to **Source** to process again
   - Drag it to **Save Zone** to keep as a reusable material
   - Drag it to the **Trash** to discard
5. When a rock has multiple pieces (after splitting), click individual pieces to select which ones to process.

## Running Locally

No build step required. Serve the files with any static server:

```bash
# Python
python3 -m http.server 8899

# Node
npx serve -p 8899
```

Then open `http://localhost:8899`.

## Tech Stack

- **HTML/CSS/JS** — no frameworks, no dependencies
- **Pixel art engine** — custom `Rock` class with grid-based transformations
- **RockCollection** — manages multi-piece rocks after splitting, with per-piece selection
- **Forge animations** — per-process visual effects (gold wave, ruby pop-in, squeeze flip, crack & split)
- **Drag & drop** — all interactions use native HTML5 drag and drop
- **Seeded RNG** — consistent rock generation via Mulberry32

## Design Philosophy

See [guide.md](guide.md) for the full design process document.

The key constraint: **no hard-coded outcomes**. Every process is a pure function (`Rock → Rock`). They compose in any order, any number of times. The system never needs to know what combination the player will try — it just works.
