# @palot/orbits

Dotted 3D thinking orbs for agent interfaces. This package is a close adaptation of
[`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs), used under its MIT license.

## Add it to Palot

```json
{
  "dependencies": {
    "@palot/orbits": "workspace:*"
  }
}
```

## Use it

```tsx
import { ThinkingOrb } from "@palot/orbits";

<ThinkingOrb state="searching" size={64} />;
```

`PalotOrb` is an alias for the same component:

```tsx
import { PalotOrb } from "@palot/orbits";

<PalotOrb state="listening" size={20} />;
```

## States

`working`, `searching`, `solving`, `listening`, `connecting`, `weaving`, `composing`,
`breathing`, and `shaping`.

## Props

| Prop     | Type                    | Default   | Purpose                                                    |
| -------- | ----------------------- | --------- | ---------------------------------------------------------- |
| `state`  | `OrbState`              | `working` | Selects the orb animation.                                 |
| `size`   | `number`                | `64`      | Sets the canvas size. The tuned presets are 64px and 20px. |
| `speed`  | `number`                | `1`       | Multiplies the tuned animation speed.                      |
| `paused` | `boolean`               | `false`   | Freezes the current frame.                                 |
| `theme`  | `auto`, `dark`, `light` | `auto`    | Selects light or dark ink.                                 |
| `tint`   | CSS color               | none      | Adds a color wash while keeping the original depth.        |

Other canvas props pass through. The component follows reduced-motion settings and pauses when it
is outside the viewport or the document is hidden.
