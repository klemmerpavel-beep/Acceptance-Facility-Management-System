import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@priyomka/ui/styles.css";
import { App } from "./App.js";
import { Sprite } from "./Sprite.js";

const container = document.getElementById("root");
if (!container) throw new Error("Разметка страницы не содержит корневого узла");
createRoot(container).render(
  <StrictMode>
    <Sprite />
    <App />
  </StrictMode>,
);
