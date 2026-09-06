import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => setPhase(5), 3600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const features = [
    { title: "Document Register", desc: "Controlled document lifecycle", delay: 0 },
    { title: "Review Workflows", desc: "Multi-stage approvals", delay: 0.2 },
    { title: "Toolbox Talks", desc: "Safety & quality briefings", delay: 0.4 },
    { title: "Checklists", desc: "Standardized inspections", delay: 0.6 }
  ];

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between w-full h-full p-[8vw]"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Left side content */}
      <div className="relative z-10 w-[45vw]">
        <motion.div 
          className="flex items-center gap-[1vw] mb-[2vw]"
          initial={{ opacity: 0, x: -20 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="w-[3vw] h-[3vw] bg-[#37237e] text-white flex items-center justify-center font-bold text-[1.5vw] rounded-sm">
            01
          </div>
          <span className="text-[#37237e] font-semibold text-[1.5vw] tracking-widest uppercase bg-white/10 px-[1vw] py-[0.2vw] rounded-sm backdrop-blur-md">Module</span>
        </motion.div>

        <div className="overflow-hidden mb-[3vw]">
          <motion.h2 
            className="text-[6vw] font-bold leading-none font-['Space_Grotesk'] text-white"
            initial={{ y: "100%" }}
            animate={phase >= 2 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            QA/QC
          </motion.h2>
        </div>

        <div className="flex flex-col gap-[2vw]">
          {features.map((feature, idx) => (
            <motion.div 
              key={idx}
              className="flex items-center gap-[1.5vw]"
              initial={{ opacity: 0, x: -30 }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
              transition={{ duration: 0.6, delay: feature.delay, ease: "easeOut" }}
            >
              <div className="w-[1vw] h-[1vw] bg-[#e63946] rounded-full shadow-[0_0_10px_#e63946]" />
              <div>
                <h3 className="text-[2vw] font-semibold text-white leading-tight">{feature.title}</h3>
                <p className="text-[1.2vw] text-gray-400 font-light">{feature.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      
      {/* Right side abstract graphic */}
      <motion.div 
        className="relative w-[40vw] h-[40vw] flex items-center justify-center"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.img 
          src="/__mockup/attached_assets/generated_images/dashboard_abstract.png" 
          className="absolute inset-0 w-full h-full object-cover rounded-2xl shadow-2xl opacity-60 mix-blend-screen"
          style={{ maskImage: 'radial-gradient(circle, black 40%, transparent 80%)', WebkitMaskImage: 'radial-gradient(circle, black 40%, transparent 80%)' }}
          animate={{ rotate: 2 }}
          transition={{ duration: 10, ease: "linear", repeat: Infinity, repeatType: "reverse" }}
        />
        
        {/* Floating UI elements */}
        <motion.div 
          className="absolute w-[25vw] h-[8vw] bg-white/5 backdrop-blur-lg border border-white/10 rounded-lg top-[10vw] right-[5vw] shadow-2xl flex items-center p-[1.5vw]"
          initial={{ opacity: 0, x: 50, y: -20 }}
          animate={phase >= 4 ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: 50, y: -20 }}
          transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
        >
          <div className="w-[3vw] h-[3vw] rounded-full bg-green-500/20 flex items-center justify-center mr-[1.5vw]">
            <div className="w-[1.5vw] h-[1.5vw] rounded-full bg-green-500" />
          </div>
          <div>
            <div className="h-[1vw] w-[10vw] bg-white/20 rounded mb-[0.5vw]" />
            <div className="h-[0.8vw] w-[6vw] bg-white/10 rounded" />
          </div>
        </motion.div>
        
        <motion.div 
          className="absolute w-[20vw] h-[12vw] bg-white/5 backdrop-blur-lg border border-white/10 rounded-lg bottom-[8vw] left-[2vw] shadow-2xl p-[1.5vw] flex flex-col justify-center"
          initial={{ opacity: 0, x: -30, y: 30 }}
          animate={phase >= 5 ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: -30, y: 30 }}
          transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
        >
           <div className="h-[1vw] w-[15vw] bg-white/20 rounded mb-[1vw]" />
           <div className="h-[0.8vw] w-[12vw] bg-white/10 rounded mb-[1vw]" />
           <div className="flex gap-[0.5vw]">
             <div className="h-[2vw] w-[4vw] bg-[#37237e]/50 rounded" />
             <div className="h-[2vw] w-[4vw] bg-white/10 rounded" />
           </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
