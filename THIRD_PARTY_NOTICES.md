# Third-party software

The runtime bundles the following packages. They are fetched at development/install time, not from a CDN when someone uses the tool.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | https://github.com/Hopding/standard-fonts |
| @pdf-lib/upng | 1.0.1 | MIT | https://github.com/Hopding/upng |
| pako | 1.0.11 | MIT AND Zlib | https://github.com/nodeca/pako |
| tslib | 1.14.1 | 0BSD | https://github.com/microsoft/tslib |

`vite.config.ts` includes the complete installed license texts, plus the zlib notice from pako's source, in `dist/third-party-licenses.txt`. The app's own MIT license is copied to `dist/LICENSE.txt`. Retain both files when distributing the build.

The dependency tree and licenses were inspected on 2026-08-30. `npm audit` reported no known vulnerabilities at that time; that is not a security guarantee. Review lockfile and license changes before dependency upgrades.

No external artwork, stock photographs, icon packs or web fonts are included. Tiny automated-test PNGs are generated from local test code.
