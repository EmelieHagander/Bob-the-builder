/** Opaque immutable input identity, not a URL or authority capability. The
 * caller's resolver registry still proves this exact input was opened here. */
export const stageImageRef = (url: string): string | undefined => url.startsWith('private-image:') ? 'image-input:' + url.slice(14) : undefined
