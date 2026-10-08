// Status page. The frontend lives elsewhere (translation-tool); this exists
// only so the root URL of the deployment shows something other than a 404.

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '40rem' }}>
      <h1>transliterator-baps</h1>
      <p>Backend service for handwritten Gujarati transliteration.</p>
      <p>
        This deployment exposes only API routes — there is no user-facing UI
        here. The frontend lives in <code>translation-tool/</code>.
      </p>
      <ul>
        <li><code>POST /api/upload</code></li>
        <li><code>POST /api/blob-token</code></li>
        <li><code>GET /api/jobs/[id]</code></li>
      </ul>
      <p>
        See <code>CLAUDE.md</code> for architecture details.
      </p>
    </main>
  );
}
