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
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            >
                {/* Modal */}
                <div
                    className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full shadow-2xl animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                    style={{ boxShadow: 'var(--shadow-xl)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-700">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-purple-600/20 rounded-lg flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                    <path d="M3 3h18v18H3zM9 3v18"/>
                                    <path d="M15 9h6"/>
                                    <path d="M15 15h6"/>
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-white">Select Tempo Account</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-4">
                        {accounts.length === 0 ? (
                            <div className="text-center py-8 text-gray-400">
                                <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <p className="text-sm">No accounts available</p>
                                <p className="text-xs text-gray-500 mt-1">Configure accounts in Tempo</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {accounts.map((account) => {
                                    const isSelected = selectedAccountKey === account.key;
                                    return (
                                        <button
                                            key={account.id}
                                            onClick={() => handleAccountClick(account)}
                                            className={`w-full p-3 rounded-lg border transition-all text-left ${
                                                isSelected
                                                    ? 'bg-purple-600/20 border-purple-500 hover:bg-purple-600/30'
                                                    : 'bg-gray-750 border-gray-700 hover:bg-gray-700/50 hover:border-gray-600'
                                            }`}
                                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`font-semibold ${isSelected ? 'text-purple-300' : 'text-white'}`}>
                                                            {account.name}
                                                        </span>
                                                        {account.global && (
                                                            <span className="px-1.5 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-xs text-blue-400">
                                                                Global
                                                            </span>
                                                        )}
                                                        {account.status !== 'OPEN' && (
                                                            <span className="px-1.5 py-0.5 bg-gray-500/20 border border-gray-500/30 rounded text-xs text-gray-400">
                                                                {account.status}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-400 font-mono">
                                                        {account.key}
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <div className="flex-shrink-0">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-700">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
