import { createContext, useContext } from "react";

export const LessonsProjectFilterContext = createContext<string | undefined>(undefined);

export function useLessonsProjectFilter() {
  return useContext(LessonsProjectFilterContext);
}
