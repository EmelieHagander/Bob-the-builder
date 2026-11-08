# Saved drawing raster dependencies

`@resvg/resvg-wasm` 2.6.2 (MPL-2.0) and `dejavu-fonts-ttf` 2.37.0
(DejaVu fonts license) are fixed, public binary dependencies. The Edge function
fetches their immutable versioned CDN assets, checks exact length and SHA-256,
and initializes once per isolate. Project content is never sent to the CDN.
An unavailable or mismatched dependency returns an unavailable view.

Source/library: https://github.com/yisibl/resvg-js/tree/v2.6.2
Font/license: https://dejavu-fonts.github.io/License.html

Rasterization only reopens an authorized saved SVG and reframes one numbered
sheet. It does not create geometry, run a CAD model or call an AI provider.
The source SVG remains the authority; raster bytes are transient and not stored
in job checkpoints. `SAVED_VIEW_RENDERER` versions the derived pixels.
