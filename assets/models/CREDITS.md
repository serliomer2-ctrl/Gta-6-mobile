# 3D model credits

The game uses these ready-made models on **Medium** and **High** quality. **Low** quality keeps the procedural models built in code.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `human_m.glb`, `human_f.glb`, `human_h.glb` | Rigged people: a man, a woman and a heavier man | Exported with [Dramatis](https://github.com/tonioloewald/dramatis3d) (`samples/out/clothed-casual`, `long-hair` and `extreme-heavy`). Built from MakeHuman's base mesh, targets, skeleton helpers, eyes, eyebrows, eyelashes, hair and clothes (male_casualsuit02, female_sportsuit01, male_worksuit01, shoes01/02/03) | **CC0 1.0** (MakeHuman assets; the skeleton follows the Universal Animation Library by Quaternius, also CC0) |
| (skin tones inside the people files) | The skin dial's ten tones | Monk Skin Tone Scale by Dr. Ellis Monk and Google, https://skintone.google | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/) |
| `car_concept.glb` | Concept sports car (used for the *spor* and *süper* car types) | Khronos glTF Sample Assets, "CarConcept": model and textures by Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/legalcode) |

## Changes made for the game

- **People:**
  - Removed the face morph targets, the teeth and the tongue.
  - Resized textures to 512 px and re-encoded them (JPEG where there is no alpha).
  - In the game, clothes, hair and shoes are re-tinted per character, and the skeleton is driven by the game's own animation.
- **Car:**
  - Removed the interior, engine, axles, brake pads, wiper blades and three of the four wheels (the front-left wheel is reused for all four).
  - Dropped tangents and the second UV set.
  - Resized textures to at most 512 px.
  - In the game, the paint takes the car's colour, the glass uses the game's car glass, and the lights use the game's day/night light materials.

## Adding a car model

1. Put the GLB in this folder.
2. Add an entry to `CAR_MODELS` in `main.js`. Give:
   - `file`: the file name without `.glb`.
   - `len`: the length in metres.
   - `wheels`: the four wheel node names, in this order: front-left, front-right, rear-left, rear-right.
   - `paint` and `accent`: material name prefixes.
3. The model must face +Z. The licence must allow redistribution.
