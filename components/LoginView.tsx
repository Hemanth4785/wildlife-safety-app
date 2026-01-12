import React, { useState } from 'react';
import { ShieldIcon } from './icons';

interface LoginViewProps {
    onAuth: (mode: 'login' | 'signup', name: string, email: string, pass: string) => string | null;
}

const LoginView: React.FC<LoginViewProps> = ({ onAuth }) => {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('explorer@wildlife-safety.com');
    const [password, setPassword] = useState('password');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const result = onAuth(mode, name, email, password);
        if (result) {
            setError(result);
        }
    };

    const toggleMode = () => {
        setError('');
        setMode(prev => prev === 'login' ? 'signup' : 'login');
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <div className="w-full max-w-md p-8 space-y-8 bg-white shadow-lg rounded-xl">
                <div className="text-center">
                    <ShieldIcon className="w-12 h-12 mx-auto text-emerald-600" />
                    <h1 className="mt-4 text-3xl font-bold text-gray-900">
                        {mode === 'login' ? 'Welcome Back' : 'Create Account'}
                    </h1>
                    <p className="mt-2 text-sm text-gray-600">
                        {mode === 'login' ? 'Sign in to continue to Wildlife Safety' : 'Join to start your safety journey'}
                    </p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div className="rounded-md shadow-sm space-y-3">
                        {mode === 'signup' && (
                             <div>
                                <input
                                    id="full-name"
                                    name="name"
                                    type="text"
                                    required
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                                    placeholder="Full Name"
                                />
                            </div>
                        )}
                        <div>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                                placeholder="Email address"
                            />
                        </div>
                        <div>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                                placeholder="Password"
                            />
                        </div>
                    </div>
                    
                    {error && <p className="text-sm text-red-600 text-center">{error}</p>}

                    <div>
                        <button
                            type="submit"
                            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                        >
                            {mode === 'login' ? 'Sign in' : 'Create Account'}
                        </button>
                    </div>
                </form>
                <p className="text-center text-sm text-gray-600">
                    {mode === 'login' ? "Don't have an account?" : "Already have an account?"}
                    <button onClick={toggleMode} className="font-medium text-emerald-600 hover:text-emerald-500 ml-1">
                        {mode === 'login' ? 'Sign up' : 'Sign in'}
                    </button>
                </p>
                <p className="text-center text-xs text-gray-500 px-4">
                    For Demo: Use email <strong>explorer@wildlife-safety.com</strong> and password <strong>password</strong> to sign in.
                </p>
            </div>
        </div>
    );
};

export default LoginView;
