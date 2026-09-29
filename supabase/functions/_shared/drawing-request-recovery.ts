import { fingerprint } from './bob-job-journal.ts'
import type { CadCandidate } from './cad-assistant.ts'

/** Only persisted requirements and freshly read inputs can release a paused
 * intake. A new turn, retrieval timestamp or reworded delegation is not progress.
 * This conservative first gate fingerprints the bounded intake, not a guessed
 * semantic dependency subset. Missing/failed pages remain explicit in evidence. */
export async function drawingInputFingerprint(brief:Record<string,any>, evidence:unknown, images:unknown) {
  const {request_id:_id,brief:_prose,...scope}=brief
  const handoff=scope.handoff
  return fingerprint({contract:1,scope:{...scope,handoff:{...handoff,
    requirements:[...handoff.requirements].sort((a,b)=>a.id.localeCompare(b.id)),
    views:[...handoff.views].sort(),unresolved:[...handoff.unresolved].sort(),
  }},evidence,images})
}

/** Private reviewed geometry/scope commitment, without pixel or export bytes.
 * SQL compares this exact JSON before linking a request to a saved Artifact. */
export function drawingCandidateCommitment(candidate:CadCandidate) {
  const {packet,drawing_request:_request,...scope}=candidate
  return {...scope,packet:{recipe:packet.recipe,manifest:packet.manifest}}
}
