import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "./",
  plugins: [{
    name: "production-content-policy",
    apply: "build",
    transformIndexHtml(html) {
      // Development needs HMR connections and injected CSS; published files do not.
      return html.replace("connect-src 'self'", "connect-src 'none'").replace("style-src 'self' 'unsafe-inline'", "style-src 'self'");
    }
  }, {
    name: "bundle-license-notices",
    apply: "build",
    generateBundle() {
      const notices = [
        ["fflate 0.8.3", "node_modules/fflate/LICENSE"],
        ["pdf-lib 1.17.1", "node_modules/pdf-lib/LICENSE.md"],
        ["@pdf-lib/standard-fonts 1.0.0", "node_modules/@pdf-lib/standard-fonts/LICENSE.md"],
        ["@pdf-lib/upng 1.0.1", "node_modules/@pdf-lib/upng/LICENSE"],
        ["pako 1.0.11: MIT", "node_modules/pako/LICENSE"],
        ["pako / zlib: zlib notice", "notices/pako-zlib.txt"],
        ["tslib 1.14.1", "node_modules/tslib/LICENSE.txt"]
      ].map(([name, path]) => `${name}\n\n${readFileSync(new URL(path, import.meta.url), "utf8")}`).join("\n\n-----\n\n");
      this.emitFile({ type: "asset", fileName: "third-party-licenses.txt", source: notices });
      this.emitFile({ type: "asset", fileName: "LICENSE.txt", source: readFileSync(new URL("LICENSE", import.meta.url), "utf8") });
    }
  }]
});
