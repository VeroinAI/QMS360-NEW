// Optional scene metadata for Replit workspace integrations. When the
// workspace's scene controls are enabled for this project, a viewer's click on
// a scene segment scopes their next chat request to that scene's source file.
// Fill one entry per SCENE_DURATIONS key in VideoTemplate.tsx only when a
// skill reference asks for it; otherwise leave the map empty. Scenes missing
// from the map still play and can be jumped to.
//
// Example:
//   export const SCENE_DETAILS: Record<string, SceneDetails> = {
//     open: { title: 'Intro', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
//   };

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  s1: { title: 'Opening — Algihaz QMS360', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
  s2: { title: 'Platform Overview', filePath: 'src/components/video/video_scenes/Scene2.tsx' },
  s3: { title: 'QA/QC Module', filePath: 'src/components/video/video_scenes/Scene3.tsx' },
  s4: { title: 'Lessons Learned Module', filePath: 'src/components/video/video_scenes/Scene4.tsx' },
  s5: { title: 'Audit Module', filePath: 'src/components/video/video_scenes/Scene5.tsx' },
  s6: { title: 'Escalation Engine', filePath: 'src/components/video/video_scenes/Scene6.tsx' },
  s7: { title: 'Closing', filePath: 'src/components/video/video_scenes/Scene7.tsx' },
};
