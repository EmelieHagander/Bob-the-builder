/** Session renewal is not an account switch, including SIGNED_IN on tab focus. */
export function createAuthIdentityTracker() {
  let owner: string | null | undefined
  return (event: string, nextOwner: string | null): boolean => {
    const changed = event === 'SIGNED_OUT' || owner !== undefined && owner !== nextOwner
      || owner === undefined && event !== 'INITIAL_SESSION'
    owner = nextOwner
    return changed
  }
}
