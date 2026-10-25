import { useEffect, useRef } from "react";

/** Component-local display history only: these names must never be offered as eligible choices. */
export function useParticipantNames(people: readonly { id: string; fullName: string }[]) {
  const known = useRef(new Map<string, string>());
  useEffect(() => {
    for (const person of people) known.current.set(person.id, person.fullName);
  }, [people]);
  return (id: string) => people.find(person => person.id === id)?.fullName ?? known.current.get(id);
}
