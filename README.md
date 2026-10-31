# Gridfinity Builder

Design Gridfinity bins and baseplates in the browser, split large parts to fit your print bed, and download STLs. Everything runs on your machine; there is no server.

**Live app:** https://theseemailsliveinatrashcan.github.io/gridfinity-builder/

## Features

**Bins**
- Any size in 0.5-unit steps (1 unit = 42 mm); height in 7 mm units or by inside depth in mm
- Standard stacking lip or flat top, wall and floor thickness
- Compartments in both directions, label tabs (full, left, center, right), finger scoops
- Solid bins, magnet holes (6 × 2 mm), M3 screw holes, holes at outer corners only
- Plain or eight-rib press-fit magnet holes (5.9 mm inner diameter), optional 0.8 mm entry chamfer, or refined side-loaded pockets (5.86 × 1.9 mm, 0.4 mm bottom). Lids and holders share these options; half cells skip magnets.
- Scoops on the front wall only, or on all four sides for trays
- Optionally download a matching lid: flat, or stackable (baseplate sockets on top so boxes stack), with an optional finger recess
- Removable dividers: slotted inner walls plus printable divider plates; plates both ways cross with egg-crate notches at marked positions
- Cullenect-compatible label sockets (V2 standard; print cards with gflabel)
- Vase mode: a closed outer shape for spiral/vase printing, with slicer settings and a vase filament estimate
- Label card slots: a channel at the back of each compartment holds a printed 12 × 1 mm card upright; the app adds a blank card for each width and checks that every card can drop in past the lip and clears the lid

**Lids**
- Seat in a bin's stacking lip; flat, or stackable with baseplate sockets on top
- Optional finger recess and underside magnet holes
- Test-print the fit first

**Holders**
- A bin filled with a grid of pockets for one item: AA, AAA, 18650, 21700 and CR2032 batteries; 1/4" and 4 mm hex bits; SD and microSD cards; pens and markers; posts for 1/4" and 3/8" sockets; or custom round, hex, slot or post shapes
- Straight or staggered rows, finger notches, leaning card slots; height fits the pockets automatically, and the app shows how many items fit
- Preset sizes include typical clearance; test-print the fit first

**Baseplates**
- Size in units, or fit a drawer in mm with adjustable padding position
- Thin (open frame), solid bottom, weighted or skeletonized styles; plain/crush-rib magnet pockets with optional chamfer
- Screw-together edges: rebuilt-style Ø3.35 mm M3 / 4-40 bores in a 6.75 mm skeletonized bottom, including aligned split seams. This overrides the selected bottom style; use short screws accessible through the cut-outs. Bores blocked by hardware are skipped with a warning.
- Skeletonized cut-outs retain corner magnet pads; our centre mounting bosses get narrow bridges to stay attached. Half cells omit corner pads and keep their mounting bosses.
- Screw-down holes (M3, countersunk or counterbored) to fix a plate into a drawer
- Half-cell fill: when fitting a drawer leaves 21 mm or more, add a row of half-width sockets for half-unit bins

**Spacers**
- Straight or corner (L) strips that fill the gap between a baseplate and the drawer wall, with height presets matching each plate style and an optional ledge the plate rests on

**Split to fit your print bed**
- Cuts only along grid lines, into the fewest and most even pieces (a 7-unit plate on a 5-unit bed becomes 4 + 3, not 5 + 2)
- Solid/weighted baseplates join with dovetails in the bottom layer, with an adjustable fit gap (default 0.2 mm per side). Skeletonized plates use flat seams; enable screw-together edges for horizontal screw joints. Screw joints override dovetails.
- Bins and flat lids get dovetails in the floor layer that drop in from above; they move or skip spots blocked by dividers, scoops or label tabs, and fall back to flat (glued) seams when there is no room
- Each piece downloads as its own STL or 3MF, or all together (.zip of STLs, or one 3MF with every piece)

**Filament estimate**
- Upper-bound grams and metres for PLA, PETG or ABS, based on the solid volume

**MultiBoard-compatible tiles (experimental)**
- 25 mm grid tiles with large and peg holes. See the note below.

Designs are saved in the page URL, so you can bookmark or share a link.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # geometry tests (dimensions, manifoldness, splitting)
npm run build    # static build in dist/
```

Geometry is built with [manifold-3d](https://github.com/elalish/manifold) (WebAssembly) in a Web Worker, so every STL is watertight. The preview uses three.js, with a simple software renderer when WebGL is not available.

| Path | Contents |
| --- | --- |
| `src/geometry/constants.ts` | Gridfinity dimensions |
| `src/geometry/bin.ts`, `baseplate.ts`, `multiboard.ts` | Part generators |
| `src/geometry/split.ts` | Bed-fit planning and dovetail splitting |
| `src/fields.ts` | Option definitions for the form |
| `tests/` | Vitest geometry tests |

## Credits and licenses

- Cullenect label system by [Cullen J Webb](https://github.com/CullenJWebb/Cullenect-Labels) (MIT); not affiliated. Socket geometry is independently modelled from the canonical V2 dimensions. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Generate cards with [gflabel](https://github.com/ndevenish/gflabel) using Cullenect V2.

- Code in this repository: MIT, see [LICENSE](LICENSE).
- [Gridfinity](https://gridfinity.xyz) was created by Zack Freedman and released under the MIT license. Dimensions follow [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) (MIT); no code was copied from it.
- **MultiBoard:** the tile generator is an independent, experimental design modelled from publicly reported measurements, compatible with [MultiBoard](https://www.multiboard.io). It is not affiliated with or endorsed by MultiBoard Ltd, and it contains no MultiBoard files or code. MultiBoard's own designs are covered by the [MultiBoard license](https://www.multiboard.io/license). Threads and snaps are not modelled yet; print a small test tile before printing a wall.
