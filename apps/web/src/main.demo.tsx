import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Role } from "@priyomka/contracts";
import "@priyomka/ui/styles.css";
import { App } from "./App.js";
import { Sprite } from "./Sprite.js";
import { setDemoRole } from "./api.demo.js";

/**
 * Оболочка демонстрации. Экраны продукта не изменены: оболочка добавляет
 * полосу с пояснением и переключатель роли, который показывает то, что
 * иначе не видно, — какие данные сервер отдаёт каждой роли.
 */
function DemoShell(): React.JSX.Element {
  const [role, setRole] = useState<Role>("OWNER");
  const [generation, setGeneration] = useState(0);

  const switchRole = (next: Role): void => {
    setDemoRole(next);
    setRole(next);
    setGeneration((value) => value + 1);
  };

  return (
    <div>
      <div className="demo-bar">
        <div className="container row row--between row--wrap">
          <p className="t-sm">
            <strong>Демонстрация.</strong> Экраны — рабочие, данные — из разбора действующей сметы
            «Московский проспект 116». Сервер и база в демонстрации не участвуют.
          </p>
          <div className="segmented" role="group" aria-label="Роль">
            <button
              type="button"
              className="segmented__option"
              aria-pressed={role === "OWNER"}
              onClick={() => switchRole("OWNER")}
            >
              Руководитель
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={role === "FOREMAN"}
              onClick={() => switchRole("FOREMAN")}
            >
              Прораб
            </button>
          </div>
        </div>
      </div>
      <App key={`${role}-${generation}`} />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Разметка страницы не содержит корневого узла");
createRoot(container).render(
  <StrictMode>
    <Sprite />
    <DemoShell />
  </StrictMode>,
);
