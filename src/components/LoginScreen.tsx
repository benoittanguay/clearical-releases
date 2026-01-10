import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

type LoginStep = 'email' | 'otp';

export function LoginScreen() {
    const { sendOtp, verifyOtp } = useAuth();
    const [step, setStep] = useState<LoginStep>('email');
    const [email, setEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email || !email.includes('@')) {
            setError('Please enter a valid email address');
            return;
        }

        setIsLoading(true);
        setError(null);

        const result = await sendOtp(email);

        setIsLoading(false);

        if (result.success) {
            setStep('otp');
        } else {
            setError(result.error || 'Failed to send verification code');
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!otpCode || otpCode.length < 6) {
            setError('Please enter the 6-digit code');
            return;
        }

        setIsLoading(true);
        setError(null);

        const result = await verifyOtp(email, otpCode);

        setIsLoading(false);

        if (!result.success) {
            setError(result.error || 'Invalid verification code');
        }
        // If successful, the AuthContext will update and redirect
    };

    const handleBackToEmail = () => {
        setStep('email');
        setOtpCode('');
        setError(null);
    };

    const handleOpenSignup = () => {
        window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/signup');
    };

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="w-full max-w-sm">
                {/* Logo/Brand */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white">TimePortal</h1>
                    <p className="text-gray-400 text-sm mt-1">Track your time, boost productivity</p>
                </div>

                {/* Login Form */}
                <div className="bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-700">
                    {step === 'email' ? (
                        <form onSubmit={handleSendOtp}>
                            <h2 className="text-lg font-semibold text-white mb-4">Sign in to your account</h2>

                            <div className="mb-4">
                                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                                    Email address
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    disabled={isLoading}
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
                                    <p className="text-sm text-red-400">{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Sending code...
                                    </span>
                                ) : (
                                    'Continue with Email'
                                )}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp}>
                            <button
                                type="button"
                                onClick={handleBackToEmail}
                                className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                Back
                            </button>

                            <h2 className="text-lg font-semibold text-white mb-2">Enter verification code</h2>
                            <p className="text-sm text-gray-400 mb-4">
                                We sent a 6-digit code to <span className="text-white">{email}</span>
                            </p>

                            <div className="mb-4">
                                <input
                                    type="text"
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                                    disabled={isLoading}
                                    autoFocus
                                    maxLength={6}
                                />
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
                                    <p className="text-sm text-red-400">{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading || otpCode.length < 6}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Verifying...
                                    </span>
                                ) : (
                                    'Verify Code'
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={handleSendOtp}
                                disabled={isLoading}
                                className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-white disabled:text-gray-600 transition-colors"
                            >
                                Didn't receive the code? Resend
                            </button>
                        </form>
                    )}
                </div>

                {/* Sign up link */}
                <div className="mt-6 text-center">
                    <p className="text-gray-400 text-sm">
                        Don't have an account?{' '}
                        <button
                            onClick={handleOpenSignup}
                            className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            Sign up for free
                        </button>
                    </p>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-500">
                        By signing in, you agree to our{' '}
                        <button
                            onClick={() => window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/terms')}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                            onClick={() => window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/privacy')}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            Privacy Policy
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
