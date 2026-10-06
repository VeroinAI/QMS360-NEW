import { useSearchLessonsLog } from "@workspace/api-client-react";
import type { SearchLessonsLogParams } from "@workspace/api-client-react";
import { useLessonsProjectFilter } from "@/lib/lessons-project-filter";

export function useOverviewLessons(userId?: string) {
  const projectId = useLessonsProjectFilter();
  const logParams: SearchLessonsLogParams = { projectId, page: 1, limit: 20 };
  const createdParams: SearchLessonsLogParams = { projectId, creatorId: userId, page: 1, limit: 1 };
  const pendingParams: SearchLessonsLogParams = { projectId, pendingApproval: true, page: 1, limit: 5 };
  const options = (kind: string, params: SearchLessonsLogParams) => ({
    query: {
      enabled: !!userId,
      queryKey: ["/api/lessons/log", "overview", kind, userId, params],
      refetchInterval: 30000,
    },
  });
  const log = useSearchLessonsLog(logParams, options("recent", logParams));
  const created = useSearchLessonsLog(createdParams, options("created-by-me", createdParams));
  const pending = useSearchLessonsLog(pendingParams, options("pending", pendingParams));
  return { log, created, pending };
}
