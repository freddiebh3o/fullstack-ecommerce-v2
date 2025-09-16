export class NotFoundError extends Error {
    constructor(msg = "Not found") { super(msg); this.name = "NotFoundError"; }
  }
  