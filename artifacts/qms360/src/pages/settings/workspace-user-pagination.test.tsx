import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceUserPagination } from "./workspace-user-pagination";
import { getListAuditUsersUrl, getListLessonsUsersUrl, getListQaqcUsersUrl } from "@workspace/api-client-react";

describe("Workspace user pagination", () => {
  it("shows numbered pages, total users and the current page range", () => {
    const html = renderToStaticMarkup(<WorkspaceUserPagination page={2} total={45} onPageChange={() => {}} />);
    expect(html).toContain("21–40 of 45 users");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('aria-current="page"');
    for (const page of [1, 2, 3]) expect(html).toContain(`aria-label="Page ${page}"`);
  });
  it("bounds empty and large result sets without producing hundreds of buttons", () => {
    const empty = renderToStaticMarkup(<WorkspaceUserPagination page={1} total={0} onPageChange={() => {}} />);
    expect(empty).toContain("0 users");
    expect(empty).toContain("Page 1 of 1");
    expect(empty.match(/disabled=""/g)).toHaveLength(2);
    const large = renderToStaticMarkup(<WorkspaceUserPagination page={500} total={20000} onPageChange={() => {}} />);
    expect(large.match(/aria-label="Page \d+"/g)).toHaveLength(7);
    expect(large).toContain('aria-label="Page 1000"');
    expect(large).toContain("…");
  });
  it.each([getListAuditUsersUrl, getListLessonsUsersUrl, getListQaqcUsersUrl])("serializes server-side search and page in the generated URL", getUrl => {
    const url = new URL(getUrl({ page: 2, limit: 20, search: "Oversight & QA" }), "https://example.test");
    expect(url.searchParams.get("search")).toBe("Oversight & QA");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("20");
  });
});
