import type { TempoAccount } from '../services/tempoService';

interface TempoAccountPickerProps {
    accounts: TempoAccount[];
    selectedAccountKey?: string;
    onSelect: (account: TempoAccount) => void;
    onClose: () => void;
}

export function TempoAccountPicker({
    accounts,
    selectedAccountKey,
    onSelect,
    onClose
}: TempoAccountPickerProps) {
    const handleAccountClick = (account: TempoAccount) => {
        onSelect(account);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in max-h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-6 pb-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[var(--color-accent)]/10 rounded-xl flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <path d="M9 3v18"/>
                                <path d="M15 9h6"/>
                                <path d="M15 15h6"/>
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                            Select Account
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[#FAF5EE] transition-all active:scale-95"
                        aria-label="Close dialog"
                        title="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 pb-2 flex-1 overflow-y-auto">
                    {accounts.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-[var(--color-bg-tertiary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <p className="text-sm font-medium text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-display)' }}>
                                No accounts available
                            </p>
                            <p className="text-xs text-[var(--color-text-tertiary)] mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                                Configure accounts in Tempo settings
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {accounts.map((account) => {
                                const isSelected = selectedAccountKey === account.key;
                                return (
                                    <button
                                        key={account.id}
                                        onClick={() => handleAccountClick(account)}
                                        className={`w-full p-4 rounded-xl border transition-all duration-200 text-left group ${
                                            isSelected
                                                ? 'bg-[var(--color-accent)]/8 border-[var(--color-accent)] shadow-sm'
                                                : 'bg-[var(--color-bg-primary)] border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)] hover:shadow-sm'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span
                                                        className={`font-semibold ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
                                                        style={{ fontFamily: 'var(--font-display)' }}
                                                    >
                                                        {account.name}
                                                    </span>
                                                    {account.global && (
                                                        <span className="px-2 py-0.5 bg-[var(--color-info-muted)] border border-[var(--color-info)]/20 rounded-full text-[10px] font-medium text-[var(--color-info)] uppercase tracking-wide">
                                                            Global
                                                        </span>
                                                    )}
                                                    {account.status !== 'OPEN' && (
                                                        <span className="px-2 py-0.5 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-full text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                                                            {account.status}
                                                        </span>
                                                    )}
                                                </div>
                                                <div
                                                    className="text-xs text-[var(--color-text-tertiary)]"
                                                    style={{ fontFamily: 'var(--font-mono)' }}
                                                >
                                                    {account.key}
                                                </div>
                                            </div>
                                            <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                                isSelected
                                                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                                                    : 'border-[var(--color-border-secondary)] group-hover:border-[var(--color-text-tertiary)]'
                                            }`}>
                                                {isSelected && (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12" />
                                                    </svg>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 p-6 pt-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
