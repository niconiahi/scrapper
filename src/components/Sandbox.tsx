import { ScrappedSection } from './generated/ScrappedSection'

export function Sandbox() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontFamily: 'system-ui, sans-serif' }}>Scrapper Sandbox</h1>
      <p style={{ color: '#555' }}>
        Generated components from <code>./generated/</code> render below.
      </p>
      <hr style={{ margin: '24px 0' }} />
      <ScrappedSection />
    </main>
  )
}
