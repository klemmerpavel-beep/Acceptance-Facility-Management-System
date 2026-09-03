/**
 * Пустое состояние отложенного раздела.
 *
 * Раздел, до которого работа не дошла, обязан говорить об этом прямо и
 * называть стадию. Показывать вместо него правдоподобные данные — тот же
 * обман, что и правдоподобное число вместо честного нуля.
 */
export function Planned({
  title,
  text,
  stage,
}: {
  title: string;
  text: string;
  stage: string;
}): React.JSX.Element {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__text prose">{text}</p>
      <span className="pill">{stage}</span>
    </div>
  );
}
