import { useState } from 'react';

type Preset = 'this-week' | 'last-week' | 'this-month' | 'last-30' | 'last-90' | 'custom';

interface ReportDateRangePickerProps {
    dateFrom: string;
    dateTo: string;
    onDateFromChange: (date: string) => void;
    onDateToChange: (date: string) => void;
}

function getPresetDates(preset: Preset): { from: string; to: string } | null {
    const today = new Date();
    const toStr = (d: Date) => d.toISOString().split('T')[0];

    switch (preset) {
        case 'this-week': {
            const day = today.getDay();
            const monday = new Date(today);
            monday.setDate(today.getDate() - ((day + 6) % 7));
            return { from: toStr(monday), to: toStr(today) };
        }
        case 'last-week': {
            const day = today.getDay();
            const lastMonday = new Date(today);
            lastMonday.setDate(today.getDate() - ((day + 6) % 7) - 7);
            const lastSunday = new Date(lastMonday);
            lastSunday.setDate(lastMonday.getDate() + 6);
            return { from: toStr(lastMonday), to: toStr(lastSunday) };
        }
        case 'this-month': {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            return { from: toStr(firstDay), to: toStr(today) };
        }
        case 'last-30': {
            const thirtyAgo = new Date(today);
            thirtyAgo.setDate(today.getDate() - 30);
            return { from: toStr(thirtyAgo), to: toStr(today) };
        }
        case 'last-90': {
            const ninetyAgo = new Date(today);
            ninetyAgo.setDate(today.getDate() - 90);
            return { from: toStr(ninetyAgo), to: toStr(today) };
        }
        case 'custom':
            return null;
    }
}

const presets: { key: Preset; label: string }[] = [
    { key: 'this-week', label: 'This Week' },
    { key: 'last-week', label: 'Last Week' },
    { key: 'this-month', label: 'This Month' },
    { key: 'last-30', label: 'Last 30 Days' },
    { key: 'last-90', label: 'Last 90 Days' },
    { key: 'custom', label: 'Custom' },
];

export function ReportDateRangePicker({ dateFrom, dateTo, onDateFromChange, onDateToChange }: ReportDateRangePickerProps) {
    const [activePreset, setActivePreset] = useState<Preset>('last-30');

    const handlePresetClick = (preset: Preset) => {
        setActivePreset(preset);
        const dates = getPresetDates(preset);
        if (dates) {
            onDateFromChange(dates.from);
            onDateToChange(dates.to);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                {presets.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => handlePresetClick(key)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-all no-drag"
                        style={{
                            backgroundColor: activePreset === key ? 'white' : 'transparent',
                            color: activePreset === key ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                            boxShadow: activePreset === key ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                            fontFamily: 'var(--font-body)',
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {activePreset === 'custom' && (
                <div className="flex items-center gap-2 no-drag">
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => onDateFromChange(e.target.value)}
                        className="bg-white border-2 border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 hover:border-[var(--color-border-secondary)] transition-all duration-200"
                        style={{ fontFamily: 'var(--font-mono)', colorScheme: 'light' }}
                    />
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>to</span>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => onDateToChange(e.target.value)}
                        className="bg-white border-2 border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 hover:border-[var(--color-border-secondary)] transition-all duration-200"
                        style={{ fontFamily: 'var(--font-mono)', colorScheme: 'light' }}
                    />
                </div>
            )}
        </div>
    );
}
