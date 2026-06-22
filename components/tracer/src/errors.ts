export class NotInSpanError extends Error {
  constructor() {
    super("Can't perform this operation out of an span")
  }
}
