import { ENGINE_STATUS, FOUNDATION_STAGES, PROJECT_NAME, PROJECT_PHASE } from './project'
import './App.css'

export default function App() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="O11 Football Manager home">
          <img src={`${import.meta.env.BASE_URL}o11-mark.svg`} width="40" height="40" alt="" />
          <span>
            <strong>O11</strong>
            <small>FOOTBALL MANAGER</small>
          </span>
        </a>
        <span className="topbar-status"><span className="status-dot" aria-hidden="true" /> IN DEVELOPMENT</span>
      </header>

      <section className="hero" id="home" aria-labelledby="page-title">
        <div className="hero-content">
          <div className="eyebrow"><span className="eyebrow-rule" /> ENGINEERING PHASE {PROJECT_PHASE}</div>
          <h1 id="page-title">Built for the <em>beautiful game.</em></h1>
          <p className="hero-lede">A football management simulator designed around meaningful decisions, detailed player attributes, and a genuine 2D match engine.</p>
          <p className="hero-note">This is a temporary development preview, not the actual game interface. O11 is planned as a full-screen, landscape-first football management game.</p>
          <div className="hero-actions">
            <a className="primary-link" href="#foundation">View development plan <span aria-hidden="true">↘</span></a>
            <a className="subtle-link" href="https://github.com/sm75z697k8-droid/O11-Football-Manager" target="_blank" rel="noopener noreferrer">GitHub repository <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div className="schematic" aria-hidden="true">
          <div className="schematic-head"><span>SIMULATION FIRST</span><span>ENGINE / 00</span></div>
          <div className="pitch">
            <div className="pitch-halfway" />
            <div className="pitch-circle" />
            <div className="pitch-area pitch-area-left" />
            <div className="pitch-area pitch-area-right" />
            <div className="pitch-dot pitch-dot-a" />
            <div className="pitch-dot pitch-dot-b" />
            <div className="pitch-dot pitch-dot-c" />
            <div className="pitch-dot pitch-dot-d" />
            <div className="pitch-ball" />
          </div>
          <div className="schematic-foot"><span>PLAYER / BALL CONTACT • NO MATCH AI</span><span>VISUAL CONCEPT</span></div>
        </div>
      </section>

      <section className="foundation" id="foundation" aria-labelledby="foundation-title">
        <div className="section-intro">
          <span className="section-kicker">ROADMAP / FOUNDATION</span>
          <h2 id="foundation-title">The engine comes first.</h2>
          <p>We will verify each engineering milestone before adding simulated football behavior or the full management interface.</p>
        </div>
        <ol className="stage-list">
          {FOUNDATION_STAGES.map((stage) => (
            <li className="stage" key={stage.id}>
              <span className="stage-number">{stage.id}</span>
              <div className="stage-copy"><strong>{stage.title}</strong><small>{stage.summary}</small></div>
              <span className={stage.id === PROJECT_PHASE ? 'stage-state stage-current' : 'stage-state'}>
                {stage.id === PROJECT_PHASE ? 'CURRENT PHASE' : ['0A', '0B', '0C', '0D', '0E', '1', '2'].includes(stage.id) ? 'COMPLETE' : 'PLANNED'}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <footer className="footer">
        <span>{PROJECT_NAME}</span>
        <span>FOUNDATION {PROJECT_PHASE} · ENGINE {ENGINE_STATUS.toUpperCase().replace('-', ' ')}</span>
      </footer>
    </main>
  )
}
