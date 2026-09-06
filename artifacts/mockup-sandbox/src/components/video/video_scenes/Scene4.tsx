import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 3000),
      setTimeout(() => setPhase(5), 4500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full p-[6vw] overflow-hidden"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background concept */}
      <motion.img 
        src="/__mockup/attached_assets/generated_images/lessons_learned_bg.png" 
        className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen"
        initial={{ scale: 1.1, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.2 }}
        transition={{ duration: 2 }}
      />
      
      <div className="relative z-10 text-center flex flex-col items-center">
        <motion.div 
          className="flex items-center gap-[1vw] mb-[1.5vw]"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="w-[3vw] h-[3vw] bg-[#37237e] text-white flex items-center justify-center font-bold text-[1.5vw] rounded-sm">
            02
          </div>
          <span className="text-[#37237e] font-semibold text-[1.5vw] tracking-widest uppercase bg-white/10 px-[1vw] py-[0.2vw] rounded-sm backdrop-blur-md">Module</span>
        </motion.div>

        <div className="overflow-hidden mb-[4vw]">
          <motion.h2 
            className="text-[5.5vw] font-bold leading-none font-['Space_Grotesk'] text-white"
            initial={{ y: "100%" }}
            animate={phase >= 2 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Lessons Learned
          </motion.h2>
        </div>
      </div>

      {/* Feature Grid */}
      <div className="relative z-10 flex gap-[2vw] w-full max-w-[80vw] mx-auto">
        {[
          { title: "Before & After", desc: "Photo evidence", icon: "📸" },
          { title: "AI Assistant", desc: "Smart writing", icon: "✨" },
          { title: "Audit Trail", desc: "Signatures & approvals", icon: "✍️" },
          { title: "Auto-Ref", desc: "AGH-QAM-LL-000001", icon: "🔢", highlight: true }
        ].map((feat, idx) => (
          <motion.div
            key={idx}
            className={`flex-1 flex flex-col p-[2vw] rounded-xl backdrop-blur-lg border ${feat.highlight ? 'bg-[#37237e]/40 border-[#37237e]' : 'bg-white/5 border-white/10'} shadow-2xl relative overflow-hidden`}
            initial={{ opacity: 0, y: 40 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, delay: idx * 0.15, type: "spring", stiffness: 80 }}
          >
            {feat.highlight && (
              <motion.div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                initial={{ x: "-100%" }}
                animate={phase >= 5 ? { x: "100%" } : { x: "-100%" }}
                transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 3 }}
              />
            )}
            <span className="text-[3vw] mb-[1vw]">{feat.icon}</span>
            <h3 className="text-[1.8vw] font-semibold text-white mb-[0.5vw] leading-tight">{feat.title}</h3>
            <p className={`text-[1.1vw] ${feat.highlight ? 'text-[#e63946] font-medium' : 'text-gray-400 font-light'}`}>{feat.desc}</p>
          </motion.div>
        ))}
      </div>
      
      {/* Floating Ref Number */}
      <motion.div
        className="absolute top-[30vh] right-[10vw] bg-[#0d1b2a] border border-[#e63946]/30 px-[1.5vw] py-[0.5vw] rounded text-[#e63946] font-mono text-[1.2vw] z-20 shadow-[0_0_20px_rgba(230,57,70,0.2)]"
        initial={{ opacity: 0, x: 20, rotate: 5 }}
        animate={phase >= 4 ? { opacity: 1, x: 0, rotate: 0 } : { opacity: 0, x: 20, rotate: 5 }}
        transition={{ duration: 0.6, type: "spring" }}
      >
        ID: AGH-QAM-LL-000001
      </motion.div>
    </motion.div>
  );
}
