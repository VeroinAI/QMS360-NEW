import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoUrl from '@assets/algihaz-logo.svg';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="flex flex-col items-center gap-[2vw]"
        initial={{ y: 20 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <motion.img 
          src={logoUrl} 
          alt="Algihaz Holding" 
          className="w-[20vw] mb-[2vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        />
        <div className="overflow-hidden">
          <motion.h1 
            className="text-[8vw] font-bold leading-none tracking-tight font-['Space_Grotesk'] text-white"
            initial={{ y: "100%" }}
            animate={phase >= 1 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            QMS<span className="text-[#e63946]">360</span>
          </motion.h1>
        </div>
        <motion.div 
          className="h-[1px] bg-gradient-to-r from-transparent via-[#37237e] to-transparent w-[30vw]"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={phase >= 2 ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </motion.div>
    </motion.div>
  );
}
