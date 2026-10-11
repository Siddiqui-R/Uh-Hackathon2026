import PublicConditions from "@/components/PublicConditions";

export default function PublicDashboard({ sessionUnavailable = false }: { sessionUnavailable?: boolean }) {
  return <div className="app-shell public-dashboard">
    <header className="site-header"><a href="/" className="wordmark"><span className="brand-icon">✳</span> Noach</a>
      <nav aria-label="Main navigation"><a href="/" aria-current="page">Dashboard</a></nav>
    </header>
    <main>
      {sessionUnavailable && <div className="notice" role="status">We couldn’t check your existing sign-in. You can still explore this overview and try again.</div>}
      <section className="hero" id="today"><div><p className="section-label">ENVIRONMENTAL INTELLIGENCE FOR HOUSTON</p><h1>Know what’s changing.<br /><em>Plan around it.</em></h1>
        <p className="hero-copy">Weather, air and bayou conditions in one place. Get a grounded answer for your plans and a heads-up when a nearby reading changes.</p>
        <div className="hero-actions"><a className="primary" href="/login?next=%2F">Sign in ↗</a><a className="public-signup" href="/signup">New here? Create an account</a></div>
      </div><div className="hero-stamp"><span className="stamp-symbol" aria-hidden>◎</span><span>LOCAL SIGNALS<br />BETTER DECISIONS</span></div></section>
      <section className="conditions" aria-label="Current environmental conditions"><div className="section-heading"><div><p className="section-label">01 / THE CURRENT PICTURE</p><h2>Houston at a glance</h2></div><span className="tiny">Forecasts and observations are labeled separately</span></div>
        <PublicConditions />
      </section>
      <div className="feature-cards">
        <a href="/places" className="panel"><span className="section-label">01 / PLACES</span><strong>Save your places ↗</strong><span>Get conditions around where you live, study, or work.</span></a>
        <a href="/recommendations" className="panel"><span className="section-label">02 / RECOMMENDATIONS</span><strong>Plan a better hour ↗</strong><span>Compare your next routine with nearby forecast hours.</span></a>
        <a href="/assistant" className="panel"><span className="section-label">03 / ASSISTANT</span><strong>Ask a question ↗</strong><span>Get grounded guidance for your plans.</span></a>
      </div>
    </main>
    <footer><a className="wordmark" href="/"><span className="brand-icon">✳</span> Noach</a><p>Local awareness. Everyday resilience.</p><span className="tiny">Built for Houston · CodeRED: Orion 2026</span></footer>
  </div>;
}
