import React, { useState, useRef, useEffect } from 'react';
import { X, Send, MessageCircle, Key, Loader2, Trash2 } from 'lucide-react';
import { 
  ChatMessage, 
  callGeminiAPI, 
  loadApiKey, 
  saveApiKey, 
  clearApiKey,
  isValidApiKeyFormat,
  listAvailableModels
} from '../../services/LLMService';

interface OpsChatProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  initialMessage?: string;
}

const OpsChat: React.FC<OpsChatProps> = ({ 
  isOpen, 
  onClose, 
  systemPrompt,
  initialMessage 
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string>(loadApiKey() || '');
  const [showApiKeyInput, setShowApiKeyInput] = useState(!loadApiKey());
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add initial message when provided and chat opens
  useEffect(() => {
    if (isOpen && initialMessage && messages.length === 0) {
      setMessages([{ role: 'assistant', content: initialMessage }]);
    }
  }, [isOpen, initialMessage]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !showApiKeyInput) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, showApiKeyInput]);

  const handleSaveApiKey = () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    if (!isValidApiKeyFormat(apiKey.trim())) {
      setError('Invalid API key format. Gemini keys start with "AIza"');
      return;
    }
    saveApiKey(apiKey.trim());
    setShowApiKeyInput(false);
    setError(null);
  };

  const handleClearApiKey = () => {
    clearApiKey();
    setApiKey('');
    setShowApiKeyInput(true);
    setMessages([]);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      const response = await callGeminiAPI(newMessages, apiKey, systemPrompt);
      setMessages([...newMessages, { role: 'assistant', content: response }]);
    } catch (err) {
      let errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      
      // Auto-debug: Check if model is not found, then list available models
      if (errorMsg.includes('not found') || errorMsg.includes('not supported')) {
        try {
          const models = await listAvailableModels(apiKey);
          if (models.length > 0) {
            errorMsg += `\n\nAvailable models for your key: ${models.slice(0, 5).join(', ')}...`;
          }
        } catch (e) {
          // Ignore listing error
        }
      }

      setError(errorMsg);
      // If API key error, show key input again
      if (errorMsg.toLowerCase().includes('api key')) {
        setShowApiKeyInput(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showApiKeyInput) {
        handleSaveApiKey();
      } else {
        handleSend();
      }
    }
  };

  const clearChat = () => {
    setMessages(initialMessage ? [{ role: 'assistant', content: initialMessage }] : []);
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      width: '400px',
      height: '500px',
      backgroundColor: '#fff',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      overflow: 'hidden',
      border: '1px solid #e5e7eb'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#0f172a',
        color: '#fff'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <MessageCircle size={20} />
          <div>
            <div style={{ fontWeight: '700', fontSize: '14px' }}>AI Operations Manager</div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>Powered by Gemini</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={clearChat}
            title="Clear chat"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => setShowApiKeyInput(true)}
            title="API Key Settings"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Key size={16} />
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* API Key Input */}
      {showApiKeyInput && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fef3c7',
          borderBottom: '1px solid #fde68a'
        }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#92400e', marginBottom: '8px' }}>
            Enter Gemini API Key
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="AIza..."
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '13px'
              }}
            />
            <button
              onClick={handleSaveApiKey}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
          </div>
          <div style={{ fontSize: '10px', color: '#b45309', marginTop: '6px' }}>
            Get a free key at{' '}
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: '#1d4ed8', textDecoration: 'underline' }}
            >
              aistudio.google.com
            </a>
          </div>
          {apiKey && (
            <button
              onClick={handleClearApiKey}
              style={{
                marginTop: '8px',
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: '#dc2626',
                border: '1px solid #dc2626',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer'
              }}
            >
              Clear Saved Key
            </button>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        backgroundColor: '#f8fafc'
      }}>
        {messages.length === 0 && !showApiKeyInput && (
          <div style={{ 
            textAlign: 'center', 
            color: '#94a3b8', 
            fontSize: '13px',
            marginTop: '40px'
          }}>
            <MessageCircle size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <div>Ask questions about your fleet optimization!</div>
            <div style={{ fontSize: '11px', marginTop: '8px' }}>
              Try: "Why is utilization low?" or "Where should I place the depot?"
            </div>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%'
            }}
          >
            <div style={{
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              backgroundColor: msg.role === 'user' ? '#0f172a' : '#fff',
              color: msg.role === 'user' ? '#fff' : '#1f2937',
              fontSize: '13px',
              lineHeight: '1.5',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none'
            }}>
              {msg.content.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  {i < msg.content.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div style={{ 
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#64748b',
            fontSize: '13px'
          }}>
            <Loader2 size={16} className="animate-spin" />
            Thinking...
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: '#fef2f2',
          borderTop: '1px solid #fecaca',
          color: '#dc2626',
          fontSize: '12px'
        }}>
          {error}
        </div>
      )}

      {/* Input Area */}
      {!showApiKeyInput && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#fff'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about your fleet..."
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '24px',
                border: '1px solid #d1d5db',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              style={{
                padding: '10px 14px',
                backgroundColor: isLoading || !input.trim() ? '#94a3b8' : '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: '24px',
                cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OpsChat;

