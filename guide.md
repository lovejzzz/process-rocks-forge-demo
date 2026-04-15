# Rock Forge — Design Process

## Core Loop

The entire game revolves around one repeating cycle:

```
[Source Material]
       ↓
   [Process]
       ↓
   [Product]
       ↓
 becomes source material again
```

A **source material** enters the forge, a **process** is applied, and a **product** comes out. The product can then be dragged back into the source slot to be processed again — infinitely.

This is the fundamental design pattern. Every object in the game is the result of zero or more transformations applied to a base rock. There is no final state; the player decides when to stop.

## Why This Matters

The cyclic workflow means:

- **No hard-coded outcomes.** The system must handle arbitrary chains of transformations. A rock that has been split, ruby-mosaic'd, gold-plated, flipped, and split again must still be a valid source.
- **Composition over configuration.** Each process is a pure function: rock in, rock out. They compose freely in any order.
- **History is visible.** Every product carries the full sequence of processes that created it, shown as a breadcrumb trail.

## The Four Processes

| Process | What It Does |
|---------|-------------|
| **Flip** | Mirrors the rock horizontally |
| **Split Half** | Cuts the rock into two separate pieces |
| **Mosaic Ruby** | Embeds clusters of red ruby into the surface |
| **Gold Plated** | Wraps a layer of gold around the entire shape, making it thicker |

Each process is independent and stackable. Gold plating preserves rubies. Splitting produces two selectable pieces. Any subset of pieces can be selected for the next process.

## Interaction Model

1. **Drag** a material from the sidebar into the **Source** box.
2. **Drag** a process from the sidebar into the **Process** box.
3. Click **FORGE** — an animation plays showing the transformation.
4. The **Product** appears. Drag it back to Source to continue, or drop it in the save zone to keep it as a reusable material.
5. Drag anything to the **Trash** to discard it.
