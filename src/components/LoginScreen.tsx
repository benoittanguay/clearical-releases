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
        <div
            className="min-h-screen flex items-center justify-center p-4 animate-fade-in"
            style={{
                backgroundColor: 'var(--color-bg-primary)',
                fontFamily: 'var(--font-body)'
            }}
        >
            <div className="w-full max-w-sm">
                {/* Logo/Brand */}
                <div className="text-center mb-8 animate-slide-down">
                    <img
                        src="./icon.png"
                        alt="Clearical"
                        className="w-16 h-16 mx-auto mb-5 rounded-3xl"
                        style={{
                            boxShadow: 'var(--shadow-accent)'
                        }}
                    />
                    <h1
                        className="text-3xl font-bold mb-2 text-gradient-accent"
                        style={{
                            fontFamily: 'var(--font-display)',
                            letterSpacing: 'var(--tracking-tight)'
                        }}
                    >
                        Clearical
                    </h1>
                    <p
                        className="text-sm"
                        style={{ color: 'var(--color-text-secondary)' }}
                    >
                        Track your time, boost productivity
                    </p>
                </div>

                {/* Login Form */}
                <div
                    className="rounded-3xl p-8 shadow-lg border animate-slide-up"
                    style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        borderColor: 'var(--color-border-primary)',
                        borderRadius: 'var(--radius-3xl)'
                    }}
                >
                    {step === 'email' ? (
                        <form onSubmit={handleSendOtp}>
                            <h2
                                className="text-xl font-semibold mb-6"
                                style={{
                                    fontFamily: 'var(--font-display)',
                                    color: 'var(--color-text-primary)'
                                }}
                            >
                                Sign in to your account
                            </h2>

                            <div className="mb-5">
                                <label
                                    htmlFor="email"
                                    className="block text-xs font-semibold mb-2 uppercase"
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                        color: 'var(--color-text-secondary)',
                                        letterSpacing: 'var(--tracking-wider)'
                                    }}
                                >
                                    Email Address
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full px-4 py-3 rounded-xl border transition-all duration-200 focus:outline-none"
                                    style={{
                                        backgroundColor: 'var(--color-bg-tertiary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-body)',
                                        borderRadius: 'var(--radius-xl)'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = 'var(--color-accent)';
                                        e.target.style.boxShadow = 'var(--shadow-accent)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = 'var(--color-border-primary)';
                                        e.target.style.boxShadow = 'none';
                                    }}
                                    disabled={isLoading}
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div
                                    className="mb-5 p-4 rounded-xl border animate-slide-down"
                                    style={{
                                        backgroundColor: 'var(--color-error-muted)',
                                        borderColor: 'var(--color-error)',
                                        borderRadius: 'var(--radius-xl)'
                                    }}
                                >
                                    <p
                                        className="text-sm font-medium"
                                        style={{ color: 'var(--color-error)' }}
                                    >
                                        {error}
                                    </p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-3.5 font-semibold rounded-full transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
                                style={{
                                    backgroundColor: 'var(--color-accent)',
                                    color: 'var(--color-text-inverse)',
                                    fontFamily: 'var(--font-display)',
                                    borderRadius: 'var(--radius-full)',
                                    boxShadow: 'var(--shadow-accent)'
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) {
                                        e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-accent-lg)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'var(--shadow-accent)';
                                }}
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                                className="flex items-center gap-1.5 text-sm font-medium mb-6 transition-colors duration-200"
                                style={{
                                    color: 'var(--color-text-secondary)',
                                    fontFamily: 'var(--font-display)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.color = 'var(--color-accent)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                                }}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                Back
                            </button>

                            <h2
                                className="text-xl font-semibold mb-2"
                                style={{
                                    fontFamily: 'var(--font-display)',
                                    color: 'var(--color-text-primary)'
                                }}
                            >
                                Enter verification code
                            </h2>
                            <p
                                className="text-sm mb-6"
                                style={{ color: 'var(--color-text-secondary)' }}
                            >
                                We sent a 6-digit code to{' '}
                                <span
                                    className="font-semibold"
                                    style={{ color: 'var(--color-text-primary)' }}
                                >
                                    {email}
                                </span>
                            </p>

                            <div className="mb-5">
                                <input
                                    type="text"
                                    value={otpCode}
                                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    className="w-full px-4 py-4 rounded-xl border text-center text-3xl font-bold tracking-widest transition-all duration-200 focus:outline-none"
                                    style={{
                                        backgroundColor: 'var(--color-bg-tertiary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-mono)',
                                        borderRadius: 'var(--radius-xl)'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = 'var(--color-accent)';
                                        e.target.style.boxShadow = 'var(--shadow-accent)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = 'var(--color-border-primary)';
                                        e.target.style.boxShadow = 'none';
                                    }}
                                    disabled={isLoading}
                                    autoFocus
                                    maxLength={6}
                                />
                            </div>

                            {error && (
                                <div
                                    className="mb-5 p-4 rounded-xl border animate-slide-down"
                                    style={{
                                        backgroundColor: 'var(--color-error-muted)',
                                        borderColor: 'var(--color-error)',
                                        borderRadius: 'var(--radius-xl)'
                                    }}
                                >
                                    <p
                                        className="text-sm font-medium"
                                        style={{ color: 'var(--color-error)' }}
                                    >
                                        {error}
                                    </p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading || otpCode.length < 6}
                                className="w-full py-3.5 font-semibold rounded-full transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
                                style={{
                                    backgroundColor: 'var(--color-accent)',
                                    color: 'var(--color-text-inverse)',
                                    fontFamily: 'var(--font-display)',
                                    borderRadius: 'var(--radius-full)',
                                    boxShadow: 'var(--shadow-accent)'
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading && otpCode.length === 6) {
                                        e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-accent-lg)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'var(--shadow-accent)';
                                }}
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                                className="w-full mt-4 py-2 text-sm font-medium transition-colors duration-200 disabled:opacity-50"
                                style={{
                                    color: 'var(--color-text-secondary)',
                                    fontFamily: 'var(--font-display)'
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) {
                                        e.currentTarget.style.color = 'var(--color-accent)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                                }}
                            >
                                Didn't receive the code? Resend
                            </button>
                        </form>
                    )}
                </div>

                {/* Sign up link */}
                <div className="mt-6 text-center">
                    <p
                        className="text-sm"
                        style={{ color: 'var(--color-text-secondary)' }}
                    >
                        Don't have an account?{' '}
                        <button
                            onClick={handleOpenSignup}
                            className="font-semibold transition-colors duration-200"
                            style={{
                                color: 'var(--color-accent)',
                                fontFamily: 'var(--font-display)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--color-accent-hover)';
                                e.currentTarget.style.textDecoration = 'underline';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--color-accent)';
                                e.currentTarget.style.textDecoration = 'none';
                            }}
                        >
                            Sign up for free
                        </button>
                    </p>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p
                        className="text-xs leading-relaxed"
                        style={{ color: 'var(--color-text-secondary)' }}
                    >
                        By signing in, you agree to our{' '}
                        <button
                            onClick={() => window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/terms')}
                            className="transition-colors duration-200"
                            style={{ color: 'var(--color-text-secondary)' }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--color-accent)';
                                e.currentTarget.style.textDecoration = 'underline';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                                e.currentTarget.style.textDecoration = 'none';
                            }}
                        >
                            Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                            onClick={() => window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/privacy')}
                            className="transition-colors duration-200"
                            style={{ color: 'var(--color-text-secondary)' }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--color-accent)';
                                e.currentTarget.style.textDecoration = 'underline';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                                e.currentTarget.style.textDecoration = 'none';
                            }}
                        >
                            Privacy Policy
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
