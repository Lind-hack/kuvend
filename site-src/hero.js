// The hero's live backdrop: a slow graphite mesh gradient with a little warmth, film grain and a
// vignette, drawn with WebGPU by the `shaders` library. The page already shows a still gradient;
// this only fades in on top once it renders, and never runs with reduced motion or without WebGPU.
import { createShader, isWebGPUSupported } from "shaders/js";
import { componentDefinition as MeshGradient } from "shaders/core/MeshGradient";
import { componentDefinition as FilmGrain } from "shaders/core/FilmGrain";
import { componentDefinition as Vignette } from "shaders/core/Vignette";

const host = document.querySelector(".hero-bg");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

async function start() {
  if (!host || reduced || !isWebGPUSupported()) return;
  const layer = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // The shader sizes itself from the canvas's CSS box, so give it the whole backdrop.
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  layer.append(canvas);
  host.append(layer);
  try {
    await createShader(
      canvas,
      {
        components: [
          {
            type: "MeshGradient",
            // Graphite with one ember of amber and a cool steel edge: the desk, lit low.
            props: {
              stops: [
                { color: "#0b0c0e", position: 0 },
                { color: "#16130f", position: 0.3 },
                { color: "#3b2810", position: 0.52 },
                { color: "#121925", position: 0.78 },
                { color: "#0b0c0e", position: 1 },
              ],
              colorSpace: "oklab",
              count: 4,
              smoothness: 0.9,
              swirl: 0.35,
              drift: 0.25,
              speed: 0.16,
              seed: 7,
            },
          },
          { type: "FilmGrain", props: { strength: 0.06, animated: true } },
          { type: "Vignette", props: { color: "#0b0c0e", radius: 0.55, falloff: 0.5, intensity: 0.85 } },
        ],
      },
      {
        components: [MeshGradient, FilmGrain, Vignette],
        disableTelemetry: true,
        onReady: () => host.setAttribute("data-live", ""),
        onError: () => {
          host.removeAttribute("data-live");
          layer.remove();
        },
      },
    );
  } catch {
    layer.remove();
  }
}

start();
