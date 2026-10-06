export class DronaAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
