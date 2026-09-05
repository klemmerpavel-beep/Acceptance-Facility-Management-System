import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@priyomka/ui/styles.css";
import { App } from "./App.js";
import { Sprite } from "./Sprite.js";

/**
 * Оболочка демонстрации. Экраны продукта не изменены: оболочка добавляет
 * одну полосу с пояснением, откуда взялись числа.
 *
 * Переключателя роли здесь больше нет. Он показывал, какие данные сервер
 * отдаёт руководителю и прорабу, но пользователь у продукта теперь один, и
 * переключать нечего. Разграничение полей на сервере при этом осталось и
 * проверяется на стенде (`scripts/verify-api.mjs`), а не показывается
 * органом управления, которому в продукте нет соответствия.
 */
const container = document.getElementById("root");
if (!container) throw new Error("Разметка страницы не содержит корневого узла");
createRoot(container).render(
  <StrictMode>
    <Sprite />
    <div>
      <div className="demo-bar">
        <div className="container">
          <p className="t-sm">
            <strong>Демонстрация.</strong> Экраны — рабочие, данные — из разбора действующей сметы
            «Московский проспект 116». Сервер и база в демонстрации не участвуют.
          </p>
        </div>
      </div>
      <App />
    </div>
  </StrictMode>,
);
