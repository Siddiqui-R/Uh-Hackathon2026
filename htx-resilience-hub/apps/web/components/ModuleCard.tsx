interface Props { title: string; value: string; status: string; caption: string; accent?: string; loading?: boolean; }
export default function ModuleCard({ title, value, status, caption, accent = "green", loading = false }: Props) {
  return <article className={`module-card ${accent}`} aria-busy={loading || undefined}><div className="module-top"><h3>{title}</h3><span className="tag">{loading && <span className="spinner" aria-hidden />}{status}</span></div>
    {loading ? <><span className="skeleton skeleton-value" aria-hidden /><p className="sr-only">Loading {title.toLowerCase()}…</p></> : <p className="module-value">{value}</p>}
    {loading ? <span aria-hidden><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /></span> : <p className="tiny">{caption}</p>}</article>;
}
