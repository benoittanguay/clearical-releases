import { useState, useEffect } from 'react';
import type { TempoSettings, JiraSettings } from '../context/SettingsContext';
import type { JiraProject } from '../services/jiraService';

interface IntegrationConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTempoSettings: TempoSettings;
    currentJiraSettings: JiraSettings;
    onSave: (tempoSettings: TempoSettings, jiraSettings: JiraSettings) => void;
}

export function IntegrationConfigModal({ 
    isOpen, 
    onClose, 
    currentTempoSettings, 
    currentJiraSettings, 
    onSave 
}: IntegrationConfigModalProps) {
    const [tempTempoSettings, setTempTempoSettings] = useState<TempoSettings>(currentTempoSettings);
    const [tempJiraSettings, setTempJiraSettings] = useState<JiraSettings>(currentJiraSettings);
    const [isTestingTempo, setIsTestingTempo] = useState(false);
    const [isTestingJira, setIsTestingJira] = useState(false);
    const [activeTab, setActiveTab] = useState<'jira' | 'tempo'>('jira');
    const [availableProjects, setAvailableProjects] = useState<JiraProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTempTempoSettings(currentTempoSettings);
            setTempJiraSettings(currentJiraSettings);
        }
    }, [isOpen, currentTempoSettings, currentJiraSettings]);

    const handleSave = () => {
        onSave(tempTempoSettings, tempJiraSettings);
        onClose();
    };

    const handleTestTempo = async () => {
        if (!tempTempoSettings.apiToken || !tempTempoSettings.baseUrl) {
            alert('Please enter API token and select base URL first.');
            return;
        }

        setIsTestingTempo(true);
        try {
            const { TempoService } = await import('../services/tempoService');
            const service = new TempoService(tempTempoSettings.baseUrl, tempTempoSettings.apiToken);
            const isConnected = await service.testConnection();
            alert(isConnected ? 'Tempo connection successful!' : 'Tempo connection failed. Please check your API token and URL.');
        } catch (error) {
            alert(`Tempo connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingTempo(false);
        }
    };

    const handleTestJira = async () => {
        if (!tempJiraSettings.apiToken || !tempJiraSettings.baseUrl || !tempJiraSettings.email) {
            alert('Please enter all Jira fields first.');
            return;
        }

        setIsTestingJira(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(tempJiraSettings.baseUrl, tempJiraSettings.email, tempJiraSettings.apiToken);
            const isConnected = await service.testConnection();
            
            if (isConnected) {
                alert('Jira connection successful!');
                // Load available projects after successful connection
                loadAvailableProjects();
            } else {
                alert('Jira connection failed. Please check your credentials and URL.');
            }
        } catch (error) {
            alert(`Jira connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingJira(false);
        }
    };

    const loadAvailableProjects = async () => {
        if (!tempJiraSettings.apiToken || !tempJiraSettings.baseUrl || !tempJiraSettings.email) {
            return;
        }

        setLoadingProjects(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(tempJiraSettings.baseUrl, tempJiraSettings.email, tempJiraSettings.apiToken);
            const projects = await service.getProjects();
            setAvailableProjects(projects);
        } catch (error) {
            console.error('Failed to load projects:', error);
            setAvailableProjects([]);
        } finally {
            setLoadingProjects(false);
        }
    };

    const handleProjectToggle = (projectKey: string) => {
        setTempJiraSettings(prev => {
            const currentSelected = prev.selectedProjects || [];
            const isSelected = currentSelected.includes(projectKey);
            
            const newSelected = isSelected
                ? currentSelected.filter(key => key !== projectKey)
                : [...currentSelected, projectKey];
                
            return { ...prev, selectedProjects: newSelected };
        });
    };

    const selectAllProjects = () => {
        setTempJiraSettings(prev => ({
            ...prev,
            selectedProjects: availableProjects.map(p => p.key)
        }));
    };

    const clearAllProjects = () => {
        setTempJiraSettings(prev => ({
            ...prev,
            selectedProjects: []
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-white">Configure Time Tracking Integration</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Testing Credentials Banner */}
                <div className="bg-orange-900/50 border border-orange-700 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span className="text-orange-300 text-sm font-medium">Testing Mode</span>
                    </div>
                    <p className="text-orange-200 text-xs mt-1">
                        Development credentials are automatically loaded for testing purposes.
                    </p>
                </div>

                <div className="mb-4 text-sm text-gray-400">
                    Both Jira and Tempo integrations work together to provide comprehensive time tracking capabilities.
                </div>

                {/* Tab Navigation */}
                <div className="flex space-x-1 mb-6 bg-gray-900 rounded-lg p-1">
                    <button
                        onClick={() => setActiveTab('jira')}
                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'jira'
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-700'
                        }`}
                    >
                        Jira Setup
                    </button>
                    <button
                        onClick={() => setActiveTab('tempo')}
                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'tempo'
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-700'
                        }`}
                    >
                        Tempo Setup
                    </button>
                </div>

                {/* Jira Configuration Tab */}
                {activeTab === 'jira' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 mb-4">
                            <input
                                id="jira-enabled-unified"
                                type="checkbox"
                                checked={tempJiraSettings.enabled}
                                onChange={(e) => {
                                    setTempJiraSettings(prev => ({ ...prev, enabled: e.target.checked }));
                                }}
                                className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                            />
                            <label htmlFor="jira-enabled-unified" className="text-sm text-gray-300">
                                Enable Jira Integration
                            </label>
                        </div>

                        {tempJiraSettings.enabled && (
                            <>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        Jira Base URL *
                                    </label>
                                    <input
                                        type="text"
                                        value={tempJiraSettings.baseUrl}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="https://your-domain.atlassian.net"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        Email *
                                    </label>
                                    <input
                                        type="email"
                                        value={tempJiraSettings.email}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, email: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="your.email@company.com"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        API Token *
                                    </label>
                                    <input
                                        type="password"
                                        value={tempJiraSettings.apiToken}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Enter your Jira API token"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">
                                        Generate at: Jira → Profile → Security → Create and manage API tokens
                                    </div>
                                </div>

                                <button
                                    onClick={handleTestJira}
                                    disabled={isTestingJira}
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                                >
                                    {isTestingJira ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Testing Jira...
                                        </>
                                    ) : (
                                        'Test Jira Connection'
                                    )}
                                </button>

                                {/* Project Selection */}
                                {availableProjects.length > 0 && (
                                    <div className="mt-6">
                                        <label className="block text-sm text-gray-400 mb-2">
                                            Select Projects to Fetch Data From
                                        </label>
                                        <div className="text-xs text-gray-500 mb-3">
                                            Choose which projects to include in issue fetching. This improves performance and focuses on relevant data for AI features.
                                        </div>
                                        
                                        <div className="flex items-center gap-2 mb-3">
                                            <button
                                                onClick={selectAllProjects}
                                                className="text-xs text-blue-400 hover:text-blue-300 underline"
                                            >
                                                Select All
                                            </button>
                                            <span className="text-xs text-gray-500">|</span>
                                            <button
                                                onClick={clearAllProjects}
                                                className="text-xs text-blue-400 hover:text-blue-300 underline"
                                            >
                                                Clear All
                                            </button>
                                            <span className="text-xs text-gray-500 ml-2">
                                                {tempJiraSettings.selectedProjects?.length || 0} of {availableProjects.length} selected
                                            </span>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto bg-gray-900 border border-gray-700 rounded px-3 py-2">
                                            {availableProjects.map((project) => (
                                                <div key={project.key} className="flex items-center gap-2 py-2 border-b border-gray-800 last:border-b-0">
                                                    <input
                                                        type="checkbox"
                                                        id={`project-${project.key}`}
                                                        checked={tempJiraSettings.selectedProjects?.includes(project.key) || false}
                                                        onChange={() => handleProjectToggle(project.key)}
                                                        className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                                                    />
                                                    <label
                                                        htmlFor={`project-${project.key}`}
                                                        className="flex-1 text-sm text-gray-300 cursor-pointer"
                                                    >
                                                        <span className="font-medium text-blue-400">{project.key}</span>
                                                        <span className="text-gray-500 ml-2">- {project.name}</span>
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {loadingProjects && (
                                    <div className="mt-4 flex items-center justify-center py-4 text-sm text-gray-400">
                                        <div className="w-4 h-4 border border-gray-400 border-t-transparent rounded-full animate-spin mr-2"></div>
                                        Loading available projects...
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Tempo Configuration Tab */}
                {activeTab === 'tempo' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 mb-4">
                            <input
                                id="tempo-enabled-unified"
                                type="checkbox"
                                checked={tempTempoSettings.enabled}
                                onChange={(e) => {
                                    setTempTempoSettings(prev => ({ ...prev, enabled: e.target.checked }));
                                }}
                                className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                            />
                            <label htmlFor="tempo-enabled-unified" className="text-sm text-gray-300">
                                Enable Tempo Integration
                            </label>
                        </div>

                        {tempTempoSettings.enabled && (
                            <>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        API Token *
                                    </label>
                                    <input
                                        type="password"
                                        value={tempTempoSettings.apiToken}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="Enter your Tempo API token"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">
                                        Get your API token from Tempo → Settings → API Integration
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        Base URL *
                                    </label>
                                    <select
                                        value={tempTempoSettings.baseUrl}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="https://api.tempo.io">Global (api.tempo.io)</option>
                                        <option value="https://api.eu.tempo.io">EU (api.eu.tempo.io)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">
                                        Default Issue Key (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={tempTempoSettings.defaultIssueKey || ''}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, defaultIssueKey: e.target.value }));
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder="e.g. PROJECT-123"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">
                                        Default Jira issue for time logging (can be overridden per entry)
                                    </div>
                                </div>

                                <button
                                    onClick={handleTestTempo}
                                    disabled={isTestingTempo}
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                                >
                                    {isTestingTempo ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Testing Tempo...
                                        </>
                                    ) : (
                                        'Test Tempo Connection'
                                    )}
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                    >
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
}