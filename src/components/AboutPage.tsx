export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">About</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">About CompareAI</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What We Do</h2>
            <p className="text-neutral-300 leading-relaxed">CompareAI is a free AI-powered comparison engine that analyzes any two entities — products, concepts, technologies, services, or ideas. Our multi-agent AI pipeline uses web research to produce factual, source-backed comparisons with dimension-by-dimension scoring, pros and cons, and actionable recommendations.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Why We Built This</h2>
            <p className="text-neutral-300 leading-relaxed">Comparison searches are among the most common decision-making queries on the web. Existing comparison tools often lack depth, structured analysis, and source transparency. We built CompareAI to provide AI-powered comparisons that are backed by real web sources — not just LLM opinions.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">The Team</h2>
            <p className="text-neutral-300 leading-relaxed">CompareAI is built and maintained by the CompareAI Editorial Team. We combine AI engineering expertise with editorial rigor to deliver reliable comparison reports.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Editorial Policy</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>Every featured comparison is reviewed for accuracy and completeness</li>
              <li>Sources are automatically collected from web research and linked directly in reports</li>
              <li>We prioritize factual, verifiable claims over subjective opinions</li>
              <li>Reports are updated when significant new information becomes available</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p className="text-neutral-300 leading-relaxed">For questions, feedback, or partnership inquiries, please reach out via our website.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">Home</a>
          <a href="/methodology" className="text-indigo-400 hover:text-indigo-300 transition-colors">Methodology</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">Popular Comparisons</a>
        </div>
      </main>
    </div>
  );
}
