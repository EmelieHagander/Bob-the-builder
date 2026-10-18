import { PGlite as BasePGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'

/** Extension-capable database for fixtures that apply the complete Bob schema.
 * Registration makes pgvector available; production migrations still own
 * CREATE EXTENSION and every table, policy and function under test. */
export class PGlite extends BasePGlite {
  constructor() {
    super({ extensions: { vector } })
  }
}
