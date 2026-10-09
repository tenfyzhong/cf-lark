import { useRef } from 'react';

const sections = ['Applications', 'Storage', 'Clients'] as const;
export type ManagementSection = typeof sections[number];
export const panelId = (section: ManagementSection) => `panel-${section.toLowerCase()}`;
export const tabId = (section: ManagementSection) => `tab-${section.toLowerCase()}`;

export function ManagementTabs({ selected, onSelect }: {
    selected: ManagementSection;
    onSelect: (section: ManagementSection) => void;
}) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    return <nav className="management-tabs" role="tablist" aria-label="Management sections">
        {sections.map((section, index) => <button key={section} type="button" role="tab"
            id={tabId(section)} aria-controls={panelId(section)} aria-selected={selected === section}
            tabIndex={selected === section ? 0 : -1}
            ref={(element) => { refs.current[index] = element; }}
            onClick={() => onSelect(section)}
            onKeyDown={(event) => {
                let next: number;
                switch (event.key) {
                    case 'ArrowRight': next = (index + 1) % sections.length; break;
                    case 'ArrowLeft': next = (index + sections.length - 1) % sections.length; break;
                    case 'Home': next = 0; break;
                    case 'End': next = sections.length - 1; break;
                    default: return;
                }
                event.preventDefault();
                onSelect(sections[next]!);
                refs.current[next]?.focus();
            }}>{section}</button>)}
    </nav>;
}
