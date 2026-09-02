import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Подмена слоя доступа к данным. Экраны продукта импортируют `./api.js`;
 * в демонстрационной сборке этот запрос разрешается в `api.demo.ts`.
 * Сами экраны не изменяются и не знают о подмене.
 */
const demoApi = (): Plugin => ({
  name: "priyomka-demo-api",
  enforce: "pre",
  resolveId(source, importer) {
    if (source !== "./api.js" || importer === undefined) return null;
    if (importer.includes("api.demo")) return null;
    return resolve(import.meta.dirname, "src/api.demo.ts");
  },
});

export default defineConfig({
  plugins: [demoApi(), react()],
  base: "./",
  build: {
    outDir: "dist-demo",
    rollupOptions: { input: resolve(import.meta.dirname, "index.demo.html") },
  },
});
