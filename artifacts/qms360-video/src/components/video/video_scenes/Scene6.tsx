import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3500),
      setTimeout(() => setPhase(5), 4500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const capabilities = [
    { title: "Role-Based Access", desc: "Granular permissions", phaseIndex: 2 },
    { title: "SLA Escalation Engine", desc: "P1 → L1 → L2 auto-notify", phaseIndex: 3, highlight: true },
    { title: "Configurable Master Data", desc: "Adapts to your workflows", phaseIndex: 4 },
    { title: "Multi-Org & Exports", desc: "Enterprise scale", phaseIndex: 5 },
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full p-[6vw]"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="overflow-hidden mb-[4vw]">
        <motion.h2 
          className="text-[4.5vw] font-bold leading-none font-['Space_Grotesk'] text-white text-center"
          initial={{ y: "100%" }}
          animate={phase >= 1 ? { y: 0 } : { y: "100%" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Cross-Cutting Capabilities
        </motion.h2>
      </div>

      <div className="grid grid-cols-2 gap-[3vw] w-[80vw]">
        {capabilities.map((cap, idx) => (
          <motion.div
            key={idx}
            className={`flex items-center p-[2vw] rounded-xl backdrop-blur-md border ${cap.highlight ? 'bg-[#e63946]/10 border-[#e63946]/50' : 'bg-white/5 border-white/10'} shadow-xl`}
            initial={{ opacity: 0, y: 30, rotateX: 45 }}
            animate={phase >= cap.phaseIndex ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 30, rotateX: 45 }}
            transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
            style={{ transformPerspective: 1000 }}
          >
            <div className={`w-[1.5vw] h-[1.5vw] mr-[1.5vw] shrink-0 ${cap.highlight ? 'bg-[#e63946]' : 'bg-[#37237e]'} rounded-sm`} />
            <div>
              <h3 className="text-[2vw] font-bold text-white mb-[0.5vw] leading-tight">{cap.title}</h3>
              <p className={`text-[1.3vw] ${cap.highlight ? 'text-[#e63946]' : 'text-gray-400'}`}>{cap.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
      
      {/* SLA Animation Graphic */}
      <motion.div 
        className="absolute bottom-[5vw] left-1/2 w-[40vw] flex justify-between items-center bg-white/5 p-[1vw] rounded-full border border-white/10 backdrop-blur-md"
        style={{ transform: "translateX(-50%)" }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <div className="text-[1.2vw] font-mono text-gray-300 px-[1vw]">P1 Breach</div>
        <motion.div className="h-[2px] bg-[#e63946] flex-1 mx-[1vw] relative overflow-hidden">
           <motion.div 
             className="absolute top-0 bottom-0 left-0 w-1/3 bg-white"
             animate={{ x: ["-100%", "300%"] }}
             transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
           />
        </motion.div>
        <div className="text-[1.2vw] font-mono text-gray-300 px-[1vw]">Escalate L1</div>
      </motion.div>

    </motion.div>
  );
}
