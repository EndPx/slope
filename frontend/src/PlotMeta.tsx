/** Instrument header row inside a plot panel: surface annotation + legend. */
export function PlotMeta(props: {surface: string; axis: string; legend: Array<{color: string; label: string; dashed?: boolean}>}) {
  return (
    <div className="plot-meta">
      <span>
        SURFACE: {props.surface} &nbsp;//&nbsp; AXIS: {props.axis}
      </span>
      <span className="legend">
        {props.legend.map((l) => (
          <span key={l.label}>
            <i style={{background: l.dashed ? "transparent" : l.color, borderTop: l.dashed ? `2px dashed ${l.color}` : undefined, height: l.dashed ? 0 : 2}} />
            {l.label}
          </span>
        ))}
      </span>
    </div>
  );
}
