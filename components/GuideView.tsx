import React, { useState, useRef, useEffect } from 'react';
import { getAIGuideResponse } from '../services/apiService';
import type { ChatMessage } from '../types';
import { PaperPlaneIcon, SpinnerIcon } from './icons';

const GuideView: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: 'model',
            text: "Hi there! I'm your AI Wildlife Safety Guide, powered by real-time GBIF biodiversity data. I analyze actual wildlife occurrence patterns to help you navigate safely. I can explain route recommendations based on recent animal sightings, provide species-specific safety tips, and answer questions about wildlife behavior in your area. How can I help you stay safe today?"
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        const newMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmedInput }];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        const response = await getAIGuideResponse(newMessages);

        setMessages(prev => [...prev, { role: 'model', text: response }]);
        setIsLoading(false);
    };

    return (
        <div className="flex flex-col h-full bg-white">
            <header className="p-4 border-b border-gray-200 bg-gray-50">
                <h1 className="text-lg font-bold text-gray-800">AI Wildlife Guide</h1>
                <p className="text-sm text-gray-500">Your personal safety expert</p>
            </header>
            
            <div className="flex-grow p-4 overflow-y-auto content-wrapper">
                <div className="flex flex-col space-y-2">
                    {messages.map((msg, index) => (
                        <div key={index} className={`chat-bubble ${msg.role}`}>
                           {msg.text}
                        </div>
                    ))}
                    {isLoading && (
                         <div className="chat-bubble model flex items-center gap-2">
                            <SpinnerIcon /> <span>Thinking...</span>
                         </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask about wildlife, routes, or general tips..."
                        className="w-full px-4 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                        disabled={isLoading}
                    />
                    <button 
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="p-3 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                        <PaperPlaneIcon className="w-5 h-5" />
                    </button>
                </div>
                 <p className="text-xs text-center text-gray-400 mt-2 px-4">Always use multiple sources for safety decisions. Trust your instincts in the field.</p>
            </div>
        </div>
    );
};

export default GuideView;