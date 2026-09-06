import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center w-full h-full p-[8vw]"
      initial={{ opacity: 0, x: "-50vw" }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: "50vw", filter: "blur(10px)" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-full flex">
        {/* Left: Typography */}
        <div className="flex-1 relative z-10 flex flex-col justify-center">
          <motion.div 
            className="flex items-center gap-[1vw] mb-[2vw]"
            initial={{ opacity: 0, y: 20 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="w-[3vw] h-[3vw] bg-[#37237e] text-white flex items-center justify-center font-bold text-[1.5vw] rounded-sm">
              03
            </div>
            <span className="text-[#37237e] font-semibold text-[1.5vw] tracking-widest uppercase bg-white/10 px-[1vw] py-[0.2vw] rounded-sm backdrop-blur-md">Module</span>
          </motion.div>

          <div className="overflow-hidden mb-[3vw]">
            <motion.h2 
              className="text-[6.5vw] font-bold leading-none font-['Space_Grotesk'] text-white"
              initial={{ y: "100%" }}
              animate={phase >= 2 ? { y: 0 } : { y: "100%" }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              Audit
            </motion.h2>
          </div>
          
          <motion.p
            className="text-[2vw] text-gray-300 font-light max-w-[30vw] leading-relaxed"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.8 }}
          >
            Comprehensive auditing to maintain the highest standards.
          </motion.p>
        </div>

        {/* Right: Flow diagram abstract */}
        <div className="flex-1 relative flex items-center justify-center">
          <div className="relative w-[30vw] h-[30vw]">
            {/* Center node */}
            <motion.div 
              className="absolute top-1/2 left-1/2 w-[8vw] h-[8vw] bg-[#37237e] rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(55,35,126,0.6)] z-20"
              initial={{ scale: 0, x: "-50%", y: "-50%" }}
              animate={phase >= 3 ? { scale: 1, x: "-50%", y: "-50%" } : { scale: 0, x: "-50%", y: "-50%" }}
              transition={{ type: "spring", stiffness: 100 }}
            >
              <span className="text-[2vw]">📋</span>
            </motion.div>
            
            {/* Satellite nodes */}
            {[
              { label: "Annual Plans", pos: { top: "10%", left: "10%" } },
              { label: "Schedules", pos: { top: "10%", right: "10%" } },
              { label: "NCR / Obs", pos: { bottom: "10%", right: "10%" } },
              { label: "CARs", pos: { bottom: "10%", left: "10%" } }
            ].map((node, idx) => (
              <motion.div
                key={idx}
                className="absolute w-[10vw] h-[10vw] bg-white/5 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-center p-[1vw] z-10"
                style={node.pos}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.6, delay: idx * 0.15, type: "spring" }}
              >
                <span className="text-[1.2vw] font-medium leading-tight">{node.label}</span>
              </motion.div>
            ))}
            
            {/* Connecting lines */}
            <motion.svg className="absolute inset-0 w-full h-full pointer-events-none"
              initial={{ opacity: 0 }}
              animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 1, delay: 0.5 }}
            >
              <line x1="50%" y1="50%" x2="25%" y2="25%" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="5,5" />
              <line x1="50%" y1="50%" x2="75%" y2="25%" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="5,5" />
              <line x1="50%" y1="50%" x2="75%" y2="75%" stroke="rgba(230,57,70,0.5)" strokeWidth="2" />
              <line x1="50%" y1="50%" x2="25%" y2="75%" stroke="rgba(230,57,70,0.5)" strokeWidth="2" />
            </motion.svg>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
