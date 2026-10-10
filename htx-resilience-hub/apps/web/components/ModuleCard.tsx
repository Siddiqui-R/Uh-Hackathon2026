interface Props { title: string; value: string; status: string; caption: string; accent?: string; }
export default function ModuleCard({ title, value, status, caption, accent = "green" }: Props) {
  return <article className={`module-card ${accent}`}><div className="module-top"><h3>{title}</h3><span className="tag">{status}</span></div><p className="module-value">{value}</p><p className="tiny">{caption}</p></article>;
}
