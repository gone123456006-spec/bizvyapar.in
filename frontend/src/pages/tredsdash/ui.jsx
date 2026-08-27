function maxValue(series, keys) {
  let max = 1
  for (const row of series || []) {
    for (const key of keys) {
      max = Math.max(max, Number(row[key]) || 0)
    }
  }
  return max
}

export function SparkBars({ series = [], keys = ['uniqueVisitors'], labels = {} }) {
  const peak = maxValue(series, keys)
  return (
    <div className="td-chart" role="img" aria-label="Trend chart">
      {series.map((row) => (
        <div className="td-chart-col" key={row.day}>
          <div className="td-chart-bars">
            {keys.map((key) => (
              <span
                key={key}
                className={`td-bar td-bar--${key}`}
                style={{ height: `${Math.max(4, ((Number(row[key]) || 0) / peak) * 100)}%` }}
                title={`${labels[key] || key}: ${row[key] || 0}`}
              />
            ))}
          </div>
          <span className="td-chart-label">{String(row.day).slice(5)}</span>
        </div>
      ))}
    </div>
  )
}

export function StatCards({ items = [] }) {
  return (
    <section className="td-stats">
      {items.map((item) => (
        <article className="td-stat" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.hint ? <em>{item.hint}</em> : null}
        </article>
      ))}
    </section>
  )
}

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div className="td-pagination">
      <button
        type="button"
        className="td-btn td-btn--ghost"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Prev
      </button>
      <span>
        Page {page} / {totalPages}
      </span>
      <button
        type="button"
        className="td-btn td-btn--ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  )
}
