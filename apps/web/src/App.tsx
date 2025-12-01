import React, { useEffect, useMemo, useState } from 'react';
import { connectWallet, addMessage, getLastIndex, getMessage } from './lib/massa';
import { generateKeyPair, encodePublicKey, decodePublicKey, encryptMessage, decryptMessage } from './lib/crypto';
import { uploadEncryptedPayload, fetchFromIPFS } from './lib/pinata';

type ChatMessage = {
  sender: string;
  text: string;
  timestamp: number;
};

const DEMO_CONV_ID = 'demo-conversation';

export const App: React.FC = () => {
  const [account, setAccount] = useState<string | null>(null);
  const [kp] = useState(generateKeyPair);
  const [peerPublicKey, setPeerPublicKey] = useState<string>('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const myPublicKeyEncoded = useMemo(() => encodePublicKey(kp.publicKey), [kp.publicKey]);

  const handleConnectWallet = async () => {
    try {
      setIsConnecting(true);
      const { account: addr } = await connectWallet();
      setAccount(addr);
    } catch (err) {
      console.error(err);
      alert('Failed to connect Massa wallet. Is the extension installed?');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSend = async () => {
    if (!account) {
      alert('Connect your wallet first');
      return;
    }
    if (!peerPublicKey) {
      alert('Enter your peer public key');
      return;
    }
    if (!messageInput.trim()) return;

    try {
      setIsSending(true);
      const peerPk = decodePublicKey(peerPublicKey.trim());

      const plaintext = messageInput.trim();
      const enc = encryptMessage(plaintext, kp.secretKey, peerPk);

      const payload = {
        nonce: enc.nonce,
        box: enc.box,
        senderPub: myPublicKeyEncoded,
        createdAt: Date.now(),
      };

      const { cid, ipfsUrl } = await uploadEncryptedPayload(payload);

      await addMessage(DEMO_CONV_ID, cid);

      setMessages((prev) => [
        ...prev,
        { sender: account, text: plaintext, timestamp: Date.now() },
      ]);
      setMessageInput('');
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleFetchMessages = async () => {
    try {
      const lastIndex = await getLastIndex(DEMO_CONV_ID);
      const fetched: ChatMessage[] = [];
      for (let i = 1n; i <= lastIndex; i++) {
        const msgJson = await getMessage(DEMO_CONV_ID, i);
        if (!msgJson) continue;
        const parsed = JSON.parse(msgJson) as { cid: string; sender: string; timestamp: number };
        const ipfsPayload = await fetchFromIPFS(`https://gateway.pinata.cloud/ipfs/${parsed.cid}`);
        const decrypted = decryptMessage(
          ipfsPayload.nonce,
          ipfsPayload.box,
          decodePublicKey(ipfsPayload.senderPub),
          kp.secretKey,
        );
        fetched.push({
          sender: parsed.sender,
          text: decrypted ?? '[unable to decrypt]',
          timestamp: parsed.timestamp,
        });
      }
      setMessages(fetched);
    } catch (err) {
      console.error(err);
      alert('Failed to fetch messages');
    }
  };

  useEffect(() => {
    if (account) {
      handleFetchMessages().catch(console.error);
    }
  }, [account]);

  return (
    <div className="app-root">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />

      <header className="hero">
        <div className="hero-left">
          <h1 className="hero-title">
            Massa<span>Chat</span>
          </h1>
          <p className="hero-subtitle">
            A WhatsApp-style, end-to-end encrypted web3 messenger,
            running fully on the Massa blockchain with IPFS-powered storage.
          </p>

          <div className="feature-grid">
            <div className="feature-card">
              <h3>On-chain messaging</h3>
              <p>Encrypted IPFS CIDs and metadata secured on the Massa network.</p>
            </div>
            <div className="feature-card">
              <h3>End-to-end encryption</h3>
              <p>NaCl public-key boxes ensure only you and your peer can read chats.</p>
            </div>
            <div className="feature-card">
              <h3>Voice &amp; video ready</h3>
              <p>Extendable WebRTC layer for secure calls &amp; video, web3-native.</p>
            </div>
            <div className="feature-card">
              <h3>Massa dWeb</h3>
              <p>Designed to deploy to Massa&apos;s decentralized web environment.</p>
            </div>
          </div>

          <div className="cta-row">
            <button
              className="btn-primary"
              onClick={handleConnectWallet}
              disabled={isConnecting}
            >
              {account ? 'Wallet Connected' : isConnecting ? 'Connecting…' : 'Connect Massa Wallet'}
            </button>
            {account && (
              <span className="wallet-pill">
                {account.slice(0, 8)}…{account.slice(-6)}
              </span>
            )}
          </div>
        </div>

        <div className="hero-right">
          <div className="phone-frame">
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="phone-header">
                <div>
                  <div className="chat-name">Demo Conversation</div>
                  <div className="chat-status">
                    {account ? 'Secure • Encrypted by Massa' : 'Connect wallet to start'}
                  </div>
                </div>
                <div className="chat-actions">
                  <span title="Voice call">📞</span>
                  <span title="Video call">🎥</span>
                </div>
              </div>

              <div className="pubkey-panel">
                <div>
                  <label>Your chat public key</label>
                  <textarea readOnly value={myPublicKeyEncoded} />
                </div>
                <div>
                  <label>Partner public key</label>
                  <textarea
                    value={peerPublicKey}
                    onChange={(e) => setPeerPublicKey(e.target.value)}
                    placeholder="Paste your partner's public key here"
                  />
                </div>
              </div>

              <div className="messages-pane">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={
                      m.sender === account ? 'bubble bubble-me' : 'bubble bubble-them'
                    }
                  >
                    <div className="bubble-text">{m.text}</div>
                    <div className="bubble-meta">
                      {new Date(m.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="empty-state">
                    No messages yet. Connect your wallet, share your public key with a
                    friend, and start chatting.
                  </div>
                )}
              </div>

              <div className="composer">
                <input
                  type="text"
                  placeholder="Type an encrypted message…"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                />
                <button onClick={handleSend} disabled={isSending || !account}>
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
    </div>
  );
};


