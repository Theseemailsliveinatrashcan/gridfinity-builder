# Gridfinity Builder

Design Gridfinity bins and baseplates in the browser, split large parts to fit your print bed, and download STLs. Everything runs on your machine; there is no server.

**Live app:** https://theseemailsliveinatrashcan.github.io/gridfinity-builder/

## Features

**Bins**
- Any size in 0.5-unit steps (1 unit = 42 mm); height in 7 mm units or by inside depth in mm
- Standard stacking lip or flat top, wall and floor thickness
- Compartments in both directions, label tabs (full, left, center, right), finger scoops
- Solid bins, magnet holes (6 × 2 mm), M3 screw holes, holes at outer corners only

**Lids**
- Seat in a bin's stacking lip; flat, or stackable with baseplate sockets on top
- Optional finger recess and underside magnet holes
- Test-print the fit first

**Baseplates**
- Size in units, or fit a drawer in mm with adjustable padding position
- Thin (open frame), solid bottom, or weighted styles; magnet holes

**Split to fit your print bed**
- Cuts only along grid lines, into the fewest and most even pieces (a 7-unit plate on a 5-unit bed becomes 4 + 3, not 5 + 2)
- Baseplates join with dovetails in the bottom layer, with an adjustable fit gap (default 0.2 mm per side)
- Bins split with flat faces for gluing
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

- Code in this repository: MIT, see [LICENSE](LICENSE).
- [Gridfinity](https://gridfinity.xyz) was created by Zack Freedman and released under the MIT license. Dimensions follow [gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) (MIT); no code was copied from it.
- **MultiBoard:** the tile generator is an independent, experimental design modelled from publicly reported measurements, compatible with [MultiBoard](https://www.multiboard.io). It is not affiliated with or endorsed by MultiBoard Ltd, and it contains no MultiBoard files or code. MultiBoard's own designs are covered by the [MultiBoard license](https://www.multiboard.io/license). Threads and snaps are not modelled yet; print a small test tile before printing a wall.
