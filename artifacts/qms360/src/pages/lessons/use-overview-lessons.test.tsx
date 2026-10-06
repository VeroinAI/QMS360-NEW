import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LessonsProjectFilterContext } from "@/lib/lessons-project-filter";
import { useOverviewLessons } from "./use-overview-lessons";

const search = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({ useSearchLessonsLog: search }));

function Probe({ userId }: { userId?: string }) {
  const { log, created, pending } = useOverviewLessons(userId);
  return <span>{log.data?.total}/{created.data?.total}/{pending.data?.total}</span>;
}

function render(projectId?: string, userId = "current-user") {
  return renderToStaticMarkup(<LessonsProjectFilterContext.Provider value={projectId}><Probe userId={userId} /></LessonsProjectFilterContext.Provider>);
}

describe("Lessons overview project counts", () => {
  beforeEach(() => {
    search.mockReset();
    search.mockImplementation(params => ({
      data: { items: [], total: params.creatorId ? 137 : params.pendingApproval ? 9 : 250 },
      isLoading: false,
      isError: false,
    }));
  });

  it("uses full server totals and the logged-in creator, not the loaded page size", () => {
    expect(render()).toContain("250/137/9");
    const calls = search.mock.calls;
    expect(calls[0][0]).toEqual({ projectId: undefined, page: 1, limit: 20 });
    expect(calls[1][0]).toEqual({ projectId: undefined, creatorId: "current-user", page: 1, limit: 1 });
    expect(calls[2][0]).toEqual({ projectId: undefined, pendingApproval: true, page: 1, limit: 5 });
  });

  it("changes every overview query and cache key when the selected project changes", () => {
    render("project-a");
    render("project-b");
    for (let i = 0; i < 3; i++) {
      const first = search.mock.calls[i]!;
      const second = search.mock.calls[i + 3]!;
      expect(first[0].projectId).toBe("project-a");
      expect(second[0].projectId).toBe("project-b");
      expect(first[1].query.queryKey).not.toEqual(second[1].query.queryKey);
    }
  });

  it("restores all-project scope and isolates cached counts between users", () => {
    render("project-a", "first-user");
    render(undefined, "second-user");
    expect(search.mock.calls[4]![0]).toMatchObject({ projectId: undefined, creatorId: "second-user" });
    expect(search.mock.calls[1]![1].query.queryKey).not.toEqual(search.mock.calls[4]![1].query.queryKey);
  });

  it("does not request counts before the logged-in user is known", () => {
    renderToStaticMarkup(<Probe />);
    for (const [, options] of search.mock.calls) expect(options.query.enabled).toBe(false);
  });
});
