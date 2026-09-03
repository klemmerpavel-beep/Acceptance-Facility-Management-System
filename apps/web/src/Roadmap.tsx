import { ROADMAP } from "./sections.js";

/**
 * «Что дальше» — единственное место, где продукт говорит о том, чего в нём
 * ещё нет.
 *
 * Заглушка в навигации обещает раздел и не отдаёт ничего; десять таких
 * заглушек учат человека, что искать бесполезно. Здесь то же обещание
 * собрано списком: что раздел будет делать и когда появится. Навигация при
 * этом честна — в ней только работающее.
 */
export function Roadmap(): React.JSX.Element {
  return (
    <main className="container stack stack--loose">
      <p className="prose t-secondary">
        Продукт строится по частям. Ниже — то, чего в нём пока нет, с указанием стадии.
        В навигацию раздел попадает, когда у него появляется рабочий экран.
      </p>

      <dl className="roadmap">
        {ROADMAP.map((item) => (
          <div className="roadmap__item" key={item.title}>
            <dt className="roadmap__head">
              <span className="t-h3">{item.title}</span>
              <span className="roadmap__where">{item.where}</span>
              <span className="pill">{item.stage}</span>
            </dt>
            <dd className="roadmap__text prose">{item.text}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
