import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Scene1 } from '../video/video_scenes/Scene1';
import { Scene2 } from '../video/video_scenes/Scene2';
import { Scene3 } from '../video/video_scenes/Scene3';
import { Scene4 } from '../video/video_scenes/Scene4';
import { Scene5 } from '../video/video_scenes/Scene5';
import { Scene6 } from '../video/video_scenes/Scene6';
import { Scene7 } from '../video/video_scenes/Scene7';


const SCENE_DURATIONS = [4000, 6000, 10000, 12000, 10000, 12000, 6000];

export default function QMS360Video() {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const playScene = (index: number) => {
      timeoutId = setTimeout(() => {
        const nextScene = (index + 1) % SCENE_DURATIONS.length;
        setCurrentScene(nextScene);
        playScene(nextScene);
      }, SCENE_DURATIONS[index]);
    };
    
    playScene(0);
    
    return () => clearTimeout(timeoutId);
  }, []);

  const getSceneComponent = () => {
    switch (currentScene) {
      case 0: return <Scene1 key="s1" />;
      case 1: return <Scene2 key="s2" />;
      case 2: return <Scene3 key="s3" />;
      case 3: return <Scene4 key="s4" />;
      case 4: return <Scene5 key="s5" />;
      case 5: return <Scene6 key="s6" />;
      case 6: return <Scene7 key="s7" />;
      default: return null;
    }
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-[#0d1321] text-white relative font-['Plus_Jakarta_Sans',sans-serif]" style={{ aspectRatio: '16/9' }}>
      {/* Background persistent layers */}
      <motion.div
        className="absolute inset-0 z-0 opacity-40 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#37237e] via-[#0d1321] to-[#0d1321]"
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "linear"
        }}
      />
      
      {/* Persistent Brand Shapes */}
      <motion.div 
        className="absolute w-[40vw] h-[40vw] border-[1px] border-[#e63946]/20 rounded-full z-0"
        animate={{
          x: currentScene === 0 ? '50vw' : (currentScene === 6 ? '50vw' : '80vw'),
          y: currentScene === 0 ? '50vh' : (currentScene === 6 ? '50vh' : '-10vh'),
          scale: currentScene === 0 ? 1 : 1.5,
          opacity: currentScene % 2 === 0 ? 0.3 : 0.1
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ transform: 'translate(-50%, -50%)' }}
      />
      
      <motion.div 
        className="absolute w-[60vw] h-[60vw] border-[1px] border-[#37237e]/30 rounded-full z-0"
        animate={{
          x: currentScene === 3 ? '10vw' : '90vw',
          y: currentScene === 3 ? '90vh' : '10vh',
          scale: currentScene === 2 ? 1.5 : 1,
        }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        style={{ transform: 'translate(-50%, -50%)' }}
      />
      
      {/* Dynamic persistent noise */}
      <div 
        className="absolute inset-0 z-50 pointer-events-none opacity-5 mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Main Content inside AnimatePresence */}
      <div className="relative z-10 w-full h-full flex items-center justify-center p-[4vw]">
        <AnimatePresence mode="popLayout">
          {getSceneComponent()}
        </AnimatePresence>
      </div>

      {/* Persistent logo watermark */}
      <AnimatePresence>
        {currentScene > 0 && currentScene < 6 && (
          <motion.img 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 0.5, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            src="/__mockup/attached_assets/algihaz-logo.svg" 
            className="absolute bottom-[3vw] right-[3vw] w-[10vw] z-50 mix-blend-screen"
            alt="Algihaz Logo"
          />
        )}
      </AnimatePresence>
      
      {/* Progress bar */}
      <div className="absolute top-0 left-0 h-[0.5vh] bg-[#e63946] z-50" style={{
        width: `${((currentScene + 1) / SCENE_DURATIONS.length) * 100}%`,
        transition: `width ${SCENE_DURATIONS[currentScene]}ms linear`
      }} />
    </div>
  );
}
