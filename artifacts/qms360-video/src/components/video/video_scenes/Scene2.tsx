import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center w-full h-full overflow-hidden"
      initial={{ opacity: 0, x: "100%" }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: "-100%", filter: "blur(10px)" }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background Image */}
      <motion.img 
        src={`${import.meta.env.BASE_URL}generated_images/construction_bg.png`} 
        className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-screen"
        initial={{ scale: 1.2 }}
        animate={{ scale: 1 }}
        transition={{ duration: 6, ease: "linear" }}
      />

      <div className="relative z-10 w-[70vw] pl-[8vw]">
        <motion.div 
          className="inline-block px-[1.5vw] py-[0.5vw] border border-[#e63946]/50 rounded-full mb-[2vw] backdrop-blur-md"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span className="text-[#e63946] font-semibold text-[1.5vw] tracking-wider uppercase">Platform Overview</span>
        </motion.div>

        <div className="overflow-hidden mb-[1vw]">
          <motion.h2 
            className="text-[5vw] font-bold leading-[1.1] font-['Space_Grotesk'] text-white"
            initial={{ y: "100%" }}
            animate={phase >= 2 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Web-based<br/>Quality Management
          </motion.h2>
        </div>
        
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <p className="text-[2.2vw] text-gray-300 max-w-[50vw] leading-relaxed mt-[2vw] font-light">
            Engineered exclusively for <span className="text-white font-semibold">Algihaz Holding</span> construction and contracting.
          </p>
        </motion.div>
      </div>
      
      {/* Accent geometric lines */}
      <motion.div 
        className="absolute right-[10vw] top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-[#37237e] to-transparent"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 1.5, delay: 0.5, ease: "easeInOut" }}
      />
    </motion.div>
  );
}
