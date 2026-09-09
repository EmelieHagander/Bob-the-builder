/** A scope generation defeats A → B → A races, including late responses. */
export function createRequestScope() {
  let generation = 0
  return {
    invalidate() { generation++ },
    capture() { const captured = generation; return () => captured === generation },
  }
}
