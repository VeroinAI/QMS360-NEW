import {
  VideoCanvas,
  type VideoAspectRatio,
  useVideoAudio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import { Scene7 } from './video_scenes/Scene7';
import logoUrl from '@assets/algihaz-logo.svg';

export const SCENE_DURATIONS = {
  s1: 4000,
  s2: 6000,
  s3: 10000,
  s4: 12000,
  s5: 10000,
  s6: 12000,
  s7: 6000,
};

// Canonical start offset (seconds) of each scene, used to keep the music bed
// aligned when the preview jumps between scenes or replays a locked scene.
const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

export default function VideoTemplate() {
  const { currentScene, currentSceneKey } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });

  const { muted, paused } = useVideoAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Seek only on scene transitions -- resuming from pause must continue from
  // the frozen timestamp, not snap back to the scene start.
  const lastSceneKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) {
      audio.pause();
      return;
    }
    if (lastSceneKeyRef.current !== currentSceneKey) {
      lastSceneKeyRef.current = currentSceneKey;
      const targetTime = SCENE_START_SEC[currentSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
        audio.currentTime = targetTime;
      }
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, muted, paused]);

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      style={{ backgroundColor: '#0d1321' }}
      className="text-white relative font-['Plus_Jakarta_Sans',sans-serif] overflow-hidden"
    >
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

      <div className="relative z-10 w-full h-full flex items-center justify-center p-[4vw]">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="s1" />}
          {currentScene === 1 && <Scene2 key="s2" />}
          {currentScene === 2 && <Scene3 key="s3" />}
          {currentScene === 3 && <Scene4 key="s4" />}
          {currentScene === 4 && <Scene5 key="s5" />}
          {currentScene === 5 && <Scene6 key="s6" />}
          {currentScene === 6 && <Scene7 key="s7" />}
        </AnimatePresence>
      </div>
      
      {/* Persistent logo watermark */}
      <AnimatePresence>
        {currentScene > 0 && currentScene < 6 && (
          <motion.img 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 0.5, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            src={logoUrl} 
            className="absolute bottom-[3vw] right-[3vw] w-[10vw] z-50 mix-blend-screen"
            alt="Algihaz Logo"
          />
        )}
      </AnimatePresence>
      
      {/* Progress bar */}
      <div className="absolute top-0 left-0 h-[0.5vh] bg-[#e63946] z-50" style={{
        width: `${((currentScene + 1) / Object.keys(SCENE_DURATIONS).length) * 100}%`,
        transition: `width ${Object.values(SCENE_DURATIONS)[currentScene]}ms linear`
      }} />

      {/* Background music; muted/paused state comes from the workspace control bar */}
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />

    </VideoCanvas>
  );
}
