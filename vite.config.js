import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: { main: "index.html", spike: "spike/index.html", player: "player/index.html" },
    },
  },
});
