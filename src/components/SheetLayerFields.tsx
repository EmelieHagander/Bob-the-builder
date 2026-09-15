import { Field, inputStyle } from './form'
import { COVERAGE_TRUTH_LABELS, sheetPurchaseCount } from '../data/sheetLayers'
import type { SheetLayerForm, SheetLayerSnapshot } from '../data/sheetLayers'

export function SheetLayerFields({ value, onChange }: { value: SheetLayerForm; onChange: (value: SheetLayerForm) => void }) {
  const change = (next: Partial<SheetLayerForm>) => onChange({ ...value, ...next })
  return <div className="fact-details">
    <h3>Chosen sheet layer</h3>
    <p className="foundation-hint">Name the chosen material above. These are supplied product inputs, not a product recommendation. One requirement covers one material; use separate requirements for different materials.</p>
    <Field label="Number of layers"><input style={inputStyle} type="number" min={1} max={20} step={1} required value={value.layerCount} onChange={event => change({ layerCount: event.target.value })} /></Field>
    <Field label="Purchase unit basis"><select style={inputStyle} value={value.coverageKind} onChange={event => change({ coverageKind: event.target.value as SheetLayerForm['coverageKind'], widthMm: '', heightMm: '', packCoverage: '' })}>
      <option value="sheet_dimensions">Individual sheet dimensions</option><option value="pack_coverage">Declared coverage per pack</option>
    </select></Field>
    {value.coverageKind === 'sheet_dimensions' ? <div className="fact-filters">
      <Field label="Sheet width (mm)"><input style={inputStyle} inputMode="numeric" pattern="[0-9]+" maxLength={5} required value={value.widthMm} onChange={event => change({ widthMm: event.target.value })} /></Field>
      <Field label="Sheet height (mm)"><input style={inputStyle} inputMode="numeric" pattern="[0-9]+" maxLength={5} required value={value.heightMm} onChange={event => change({ heightMm: event.target.value })} /></Field>
    </div> : <Field label="Coverage per pack (m²)"><input style={inputStyle} inputMode="decimal" required maxLength={15} value={value.packCoverage} onChange={event => change({ packCoverage: event.target.value })} /></Field>}
    <Field label="Product input certainty"><select style={inputStyle} required value={value.coverageTruth} onChange={event => change({ coverageTruth: event.target.value as SheetLayerForm['coverageTruth'] })}>
      <option value="">Choose the source type</option>{Object.entries(COVERAGE_TRUTH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></Field>
    <Field label="Product input source"><input style={inputStyle} required maxLength={1000} placeholder="For example: packaging, product sheet, or how it was measured" value={value.coverageSource} onChange={event => change({ coverageSource: event.target.value })} /></Field>
    <p className="foundation-hint">The server multiplies net wall area by layers, applies the allowance once, subtracts your compatible m² stock allocation, then rounds to whole sheets or packs. Stock in pcs is not silently converted. Coverage supports 0.0001 m² precision.</p>
    <p className="solution-attention">Area-based quantity only — not a cut or layout plan. Openings, offcuts, board orientation and joints may require additional material. Confirm the actual layout and product suitability separately.</p>
  </div>
}

export function SheetLayerSummary({ value, purchaseQuantity, purchaseIncrement }: {
  value: SheetLayerSnapshot; purchaseQuantity: string; purchaseIncrement: string
}) {
  const count = sheetPurchaseCount(purchaseQuantity, purchaseIncrement)
  const unit = value.coverage_kind === 'sheet_dimensions' ? 'sheet' : 'pack'
  return <div className="fact-source" aria-label="Saved sheet layer">
    <strong>Saved sheet layer · {value.layer_count} {value.layer_count === 1 ? 'layer' : 'layers'}</strong>
    <p>{value.net_wall_area_m2} m² net wall area × {value.layer_count} layers, before allowance.</p>
    <p>{value.coverage_kind === 'sheet_dimensions' ? `${value.sheet_width_mm} × ${value.sheet_height_mm} mm` : 'Declared pack coverage'} · {value.unit_coverage_m2} m² per {unit}.</p>
    <p><strong>{count} {unit}{count === '1' ? '' : 's'} to buy</strong> · {purchaseQuantity} m² purchasing coverage.</p>
    <p>{COVERAGE_TRUTH_LABELS[value.coverage_truth]} · {value.coverage_source}</p>
    <p className="foundation-hint">Area-based purchase quantity, not a cut/layout plan or suitability approval. Estimates remain estimates.</p>
  </div>
}
