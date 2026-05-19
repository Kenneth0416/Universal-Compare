export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">Methodology</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">How Our Comparisons Are Generated</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Our 4-Phase AI Research Pipeline</h2>
            <p className="text-neutral-300 leading-relaxed mb-4">Every comparison goes through a rigorous 4-phase process designed to produce balanced, evidence-based analysis.</p>
            <ol className="text-neutral-300 space-y-3 list-decimal list-inside">
              <li><strong className="text-white">Dual-Track Research</strong> — We search the web across 5-8 different angles per entity, gathering information from official sources, reviews, benchmarks, and expert analysis.</li>
              <li><strong className="text-white">Framework Architecture</strong> — An AI architect analyzes the relationship between the two entities and generates 4-6 comparison dimensions specifically tailored to them. No generic templates.</li>
              <li><strong className="text-white">Multi-Dimensional Analysis</strong> — Each dimension is analyzed independently with scores on a 0-10 scale. Each analysis cites 1-2 web sources that directly support the findings.</li>
              <li><strong className="text-white">Synthesis</strong> — A final phase extracts pros and cons for each entity and produces an actionable recommendation with a clear verdict.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Data Sources &amp; Verification</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Web search via multiple query angles covering factual overviews, technical specifications, expert reviews, and recent news</li>
              <li>Each claim in the analysis is linked to its original source URL for transparency</li>
              <li>Scores are based on publicly available benchmarks, reviews, and specifications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Scoring Methodology</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>All scores use a 0-10 scale where 10 represents the most favorable outcome</li>
              <li>For negative dimensions (e.g., risk, cost), lower real-world values receive higher scores</li>
              <li>Scores are relative within the comparison, not absolute ratings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Editorial Standards</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Comparisons are AI-generated and reviewed by the CompareAI Editorial Team</li>
              <li>Featured comparisons undergo quality review before publication</li>
              <li>Our methodology is continuously updated as AI capabilities improve</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Limitations</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>AI analysis may contain inaccuracies — always verify critical decisions with primary sources</li>
              <li>Scores are relative within each comparison and should not be compared across reports</li>
              <li>Data freshness depends on available web sources at the time of generation</li>
            </ul>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">Home</a>
          <a href="/about" className="text-indigo-400 hover:text-indigo-300 transition-colors">About</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">Popular Comparisons</a>
        </div>
      </main>
    </div>
  );
}
