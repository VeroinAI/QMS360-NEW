export function lessonLoadError(error: unknown, resource = "this Lessons page") {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 403) {
    return {
      title: `You do not have access to ${resource}`,
      description: resource === "this lesson"
        ? "Your current Lessons access does not allow you to view this lesson. Ask your administrator to check your Lessons role, viewing permission and project access. Being assigned as an approver does not automatically grant viewing access."
        : "Your current Lessons access does not allow you to view this page. Ask your administrator to check your Lessons role and permissions for this page.",
    };
  }
  if (status === 401) return {
    title: "Please sign in again",
    description: "Your session has expired or you are not signed in. Sign in again to continue.",
  };
  if (status === 404) return {
    title: "Lesson or page not found",
    description: "It may have been removed, or the link may be incorrect. Return to the lesson log or check the link with the sender.",
  };
  return {
    title: "Unable to load lessons",
    description: "We could not load this page. Please refresh and try again. If the problem continues, contact your administrator.",
  };
}