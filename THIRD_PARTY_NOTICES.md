# Third-party notices

`sonic3air.wasm`, `sonic3air.data` and the code inside `sonic3air.js` are **Sonic 3 A.I.R.**
("Sonic 3 - Angel Island Revisited") by Eukaryot and contributors, taken unchanged from its official
release. Sonic 3 A.I.R. is free software under the **GNU General Public License v3** (see
[LICENSE](LICENSE)). This package ships none of SEGA's game: the player provides the
Sonic & Knuckles + Sonic 3 ROM.

| Component | Version | Licence | Where it comes from |
| --- | --- | --- | --- |
| Sonic 3 A.I.R. (Oxygen Engine, lemonscript, rmx) | `v26.03.28.0-stable` | GPL-3.0 | https://github.com/Eukaryot/sonic3air — release asset `sonic3air_web_data.zip`, SHA-256 `227ceb546388fe37051bb770fcfebcf2128cedc55646b27831f29f8b664b4b3c`, checked by `scripts/fetch-upstream.mjs` |
| SDL2 | 2.32.8 | zlib | Emscripten's `sdl2` port, linked into the binary by upstream |
| Dear ImGui | 1.92.4 | MIT | vendored by upstream (`framework/external/imgui`) |
| ProggyClean font | — | MIT (as distributed with Dear ImGui) | Dear ImGui's default font, Tristan Grimmer |

The components above are the ones identifiable in the binary. Upstream vendors its other
dependencies in its source tree (`framework/external/` at the tag above); that tree, with their
licences, is the corresponding source of this binary.

## Sonic 3 A.I.R.

Copyright Eukaryot and contributors. Sonic 3 A.I.R. is a non-profit fan game project, not affiliated
with SEGA or Sonic Team. It is distributed under the terms of the GNU General Public License version
3; see [LICENSE](LICENSE). **Corresponding source:** https://github.com/Eukaryot/sonic3air/tree/v26.03.28.0-stable
(build recipe: `Oxygen/sonic3air/build/_emscripten/`).

## SDL2 (zlib licence)

```
Copyright (C) 1997-2025 Sam Lantinga <slouken@libsdl.org>
  
This software is provided 'as-is', without any express or implied
warranty.  In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:
  
1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required. 
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.

```

## Dear ImGui (MIT)

```
The MIT License (MIT)

Copyright (c) 2014-2025 Omar Cornut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ProggyClean font

Copyright (c) 2004, 2005 Tristan Grimmer. Distributed with Dear ImGui under the MIT licence above
(https://github.com/bluescan/proggyfonts).
