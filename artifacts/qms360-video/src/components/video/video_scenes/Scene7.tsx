import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoUrl from '@assets/algihaz-logo.svg';

export function Scene7() {
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, ease: "easeInOut" }}
    >
      <motion.div 
        className="flex flex-col items-center"
        initial={{ y: 30 }}
        animate={{ y: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
      >
        <div className="overflow-hidden mb-[3vw]">
          <motion.h2 
            className="text-[4vw] font-light tracking-wide text-white"
            initial={{ y: "100%" }}
            animate={phase >= 1 ? { y: 0 } : { y: "100%" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            Quality, managed end to end.
          </motion.h2>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        >
          <img 
            src={logoUrl} 
            alt="Algihaz Holding" 
            className="w-[25vw] opacity-90"
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
