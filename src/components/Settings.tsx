import { useState, useEffect } from 'react';

type PermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export function Settings() {
    const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');

    const checkPermission = async () => {
        // @ts-ignore - window.electron is defined in preload
        if (window.electron) {
            // @ts-ignore
            const status = await window.electron.ipcRenderer.invoke('check-screen-permission');
            setPermissionStatus(status);
        }
    };

    const openSettings = async () => {
        // @ts-ignore
        if (window.electron) {
            // @ts-ignore
            await window.electron.ipcRenderer.invoke('open-screen-permission-settings');
        }
    };

    useEffect(() => {
        checkPermission();
        // Poll every few seconds in case user changed it
        const interval = setInterval(checkPermission, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full flex-1 flex flex-col p-4">
            <h2 className="text-xl font-bold mb-6 text-gray-200">Settings</h2>

            <div className="bg-gray-800 p-4 rounded-lg mb-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Permissions</h3>
                <div className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
                    <div>
                        <div className="text-sm font-medium text-white">Screen Recording</div>
                        <div className="text-xs text-gray-500">Required for Screenshots</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded ${permissionStatus === 'granted' ? 'bg-green-900 text-green-400' :
                            permissionStatus === 'denied' ? 'bg-red-900 text-red-400' : 'bg-yellow-900 text-yellow-400'
                            }`}>
                            {permissionStatus.toUpperCase()}
                        </span>
                    </div>
                </div>
                {permissionStatus !== 'granted' && (
                    <button
                        onClick={openSettings}
                        className="mt-3 w-full text-xs bg-blue-600 hover:bg-blue-500 text-white py-2 rounded transition-colors"
                    >
                        Open System Settings
                    </button>
                )}

                <button
                    onClick={async () => {
                        // @ts-ignore
                        if (window.electron?.ipcRenderer?.captureScreenshot) {
                            // @ts-ignore
                            console.log('[Settings] Manual capture triggered');
                            // @ts-ignore
                            await window.electron.ipcRenderer.captureScreenshot();
                        }
                    }}
                    className="mt-3 w-full text-xs bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors border border-gray-600"
                >
                    Test Screenshot Capture
                </button>
            </div>

            <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">About</h3>
                <p className="text-xs text-gray-500">TimePortal v0.1.0</p>
            </div>
        </div>
    );
}
