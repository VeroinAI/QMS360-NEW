import VideoTemplate from '@/components/video/VideoTemplate';
import { WorkspaceControlledVideo } from '@/lib/video';

export default function App() {
  return (
    <WorkspaceControlledVideo>
      <VideoTemplate />
    </WorkspaceControlledVideo>
  );
}
