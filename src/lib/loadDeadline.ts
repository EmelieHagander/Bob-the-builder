/** Bound a read without treating a timeout as an empty or signed-out result. */
export function withLoadDeadline<T>(read: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The connection took too long. Check your connection and try again.')), timeoutMs)
    read.then(value => { clearTimeout(timer); resolve(value) }, reason => { clearTimeout(timer); reject(reason) })
  })
}
