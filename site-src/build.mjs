// Bundles the hero shader into site/js/hero.js. The `shaders` registry imports all ~200 effects;
// the hero uses three, so the registry is swapped for an empty one and the three are passed in.
import { build } from "esbuild";

await build({
  entryPoints: ["site-src/hero.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  outfile: "site/js/hero.js",
  legalComments: "none",
  plugins: [
    {
      name: "only-what-the-hero-uses",
      setup(b) {
        b.onResolve({ filter: /registry\.js$/ }, (args) => (args.importer.includes("createShader") ? { path: "registry-stub", namespace: "stub" } : undefined));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const getAllShaders = () => [];", loader: "js" }));
      },
    },
  ],
});
