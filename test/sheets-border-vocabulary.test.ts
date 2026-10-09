import { describe, it, expect } from 'vitest';
import { normalizeBorders, normalizeTypedCell } from '../src/capabilities/sheets/normalize';
describe('pinned Sheets border vocabulary', () => {
    it('accepts scalar thickness and line-style flags', () => {
        expect(normalizeBorders(2)).toEqual(Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'solid', weight: 'medium' }])));
        expect(normalizeBorders('hair').left).toEqual({ style: 'solid', weight: 'thin' });
        expect(normalizeBorders('dashed').top).toEqual({ style: 'dashed' });
        expect(() => normalizeBorders('2')).toThrow();
    });
    it('folds both flattened side word orders and width attributes without mutating inputs', () => {
        const input = { value: 'x', border_bottom: { type: 'thin' }, top_border_width: 3, border_color: '#000000' };
        const output = normalizeTypedCell(input);
        expect(output.border_styles).toMatchObject({ bottom: { style: 'solid', weight: 'thin' }, top: { weight: 'thick' }, left: { color: '#000000' } });
        expect(input).toHaveProperty('border_bottom');
    });
    it('moves all-side attributes to an explicit side selector and keeps narrower overrides', () => {
        expect(normalizeTypedCell({ border_type: 'left-border', border_style: 'dashed', border_color: '#000000', border_left_color: '#ffffff' })).toEqual({ border_styles: { left: { style: 'dashed', color: '#ffffff' } } });
        expect(normalizeTypedCell({ border_type: 'FULL_BORDER' }).border_styles).toMatchObject({ top: { style: 'solid' }, right: { style: 'solid' } });
        expect(normalizeTypedCell({ border_type: 'NO_BORDER' }).border_styles).toMatchObject({ top: { style: 'none' } });
    });
    it('supports loose per-side values and nested cell style border families', () => {
        expect(normalizeTypedCell({ cell_styles: { border: { top: 'thin', left: 2 }, font_weight: 'bold' } })).toEqual({ cell_styles: { font_weight: 'bold' }, border_styles: { top: { style: 'solid', weight: 'thin' }, left: { style: 'solid', weight: 'medium' } } });
    });
    it('rejects conflicts and geometry that uniform cell borders cannot express', () => {
        for (const border_type of ['OUTER_BORDER', 'INNER_BORDER', 'HORIZONTAL_BORDER', 'VERTICAL_BORDER']) expect(() => normalizeTypedCell({ border_type })).toThrow();
        expect(() => normalizeTypedCell({ border_styles: { top: { color: '#000000' } }, top_border_color: '#ffffff' })).toThrow();
        expect(() => normalizeTypedCell({ border: { top: 'thin', bogus: 'solid' } })).toThrow();
        expect(() => normalizeBorders({ top: { style: 'thin', weight: 'thick' } })).toThrow();
    });
});
it('accepts scalar style flags and folds declarative border aliases into matrix cells', async () => {
    const { styleInput } = await import('../src/capabilities/sheets/styles');
    const { stylesPlan } = await import('../src/capabilities/sheets/declarative-styles');
    const output: Record<string, unknown> = {};
    styleInput('cells-set-style', { range: 'A1', 'border-styles': 'thin' }, output);
    expect(output.cells).toMatchObject([[{ border_styles: { left: { style: 'solid', weight: 'thin' } } }]]);
    const plan = stylesPlan({ styles: [{ name: 'A', cell_styles: [{ range: 'A1', border_type: 'LEFT_BORDER', border_style: 'dashed' }] }] }, 'b');
    expect(plan.operations[0]?.input).toMatchObject({ cells: [[{ border_styles: { left: { style: 'dashed' } } }]] });
});
