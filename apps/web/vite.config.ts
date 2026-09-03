import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Куки сессии httpOnly, поэтому клиент и API должны выглядеть как один
    // источник: иначе браузер не отдаст куку кросс-доменно без настройки CORS.
    proxy: { "/api": { target: process.env.API_ORIGIN ?? "http://127.0.0.1:3000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
