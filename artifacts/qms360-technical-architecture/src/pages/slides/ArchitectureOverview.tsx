const base = import.meta.env.BASE_URL;

export default function ArchitectureOverview() {
  return <div className="w-screen h-screen overflow-hidden relative bg-bg px-[4vw] py-[4vh] font-body text-primary grid grid-cols-[3fr_2fr] grid-rows-[auto_1fr_auto] gap-x-[4vw] gap-y-[3vh]">
    <header className="col-span-2 flex items-center justify-between border-b border-slate-200 pb-[2vh]">
      <div className="flex items-center gap-[1vw]"><div className="h-[2vw] w-[2vw] rounded-[0.4vw] bg-accent flex items-center justify-center text-white font-bold text-[1.5vw]">Q</div><span className="text-[1.5vw] font-bold tracking-tight">QMS360</span></div>
      <div className="flex gap-[2vw] text-[1.5vw] font-semibold text-muted"><span>TECHNICAL ARCHITECTURE</span><span>2026</span></div>
    </header>
    <main className="flex flex-col justify-center">
      <p className="mb-[1vh] text-[1.5vw] font-bold uppercase tracking-[0.12em] text-accent">VerionAI-enabled quality management platform</p>
      <h1 className="m-0 max-w-[51vw] text-[5.2vw] font-extrabold leading-[1.02] tracking-[-0.04em] text-wrap-balance">QMS360 Technical Architecture</h1>
      <div className="mt-[4vh] grid grid-cols-2 gap-[1.2vw]">
        <div className="rounded-[1vw] border border-slate-200 bg-white p-[1.5vw] shadow-[0_0.5vw_1.5vw_rgba(30,58,95,0.06)]"><p className="text-[1.5vw] font-bold uppercase tracking-wide text-muted">End-to-end language</p><p className="mt-[0.5vh] text-[2.3vw] font-extrabold">TypeScript</p></div>
        <div className="rounded-[1vw] border border-slate-200 bg-white p-[1.5vw] shadow-[0_0.5vw_1.5vw_rgba(30,58,95,0.06)]"><p className="text-[1.5vw] font-bold uppercase tracking-wide text-muted">Architecture</p><p className="mt-[0.5vh] text-[2.3vw] font-extrabold">Modular monolith</p></div>
      </div>
      <p className="mt-[2.5vh] text-[1.65vw] leading-[1.45] text-slate-600">React/Vite SPA + Node.js/Express API + PostgreSQL</p>
      <p className="text-[1.65vw] leading-[1.45] text-slate-600">Contract-first REST APIs with generated clients</p>
      <p className="text-[1.65vw] leading-[1.45] text-slate-600">Modular monolith serving QA/QC, Lessons, Audit, and platform administration</p>
    </main>
    <aside className="flex items-center justify-center"><div className="relative h-full w-full overflow-hidden rounded-[1.2vw] border border-slate-200 bg-white shadow-[0_0.8vw_2vw_rgba(30,58,95,0.10)]"><img src={`${base}hero-architecture.jpg`} crossOrigin="anonymous" alt="Abstract software architecture visualization" className="h-full w-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-[#1E3A5F]/55 via-transparent to-transparent"></div><div className="absolute bottom-[2.5vh] left-[2vw] right-[2vw] text-white"><p className="text-[1.5vw] font-bold uppercase tracking-[0.12em] text-teal-200">Core stack</p><p className="mt-[0.8vh] text-[2.2vw] font-bold leading-tight">Browser → API → Data</p></div></div></aside>
    <footer className="col-span-2 flex items-center justify-between border-t border-slate-200 pt-[2vh] text-[1.5vw] font-medium text-slate-400"><span>QMS360 Platform</span><span>Architecture Overview • 01</span></footer>
  </div>;
}
