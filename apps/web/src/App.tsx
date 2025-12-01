import React, { useEffect, useMemo, useState } from 'react';
import { connectWallet, addMessage, getLastIndex, getMessage } from './lib/massa';
import {
  generateKeyPair,
  encodePublicKey,
  decodePublicKey,
  encryptMessage,
  decryptMessage,
} from './lib/crypto';
import { uploadEncryptedPayload, fetchFromIPFS } from './lib/pinata';

type ChatMessage = {
  sender: string;
  text: string;
  timestamp: number;
};

const DEMO_CONV_ID = 'demo-conversation';
const PROFILE_STORAGE_KEY = 'massaChatProfiles';

type UserProfile = {
  address: string;
  name: string;
  createdAt: number;
};

type ProfileStore = {
  byAddress: Record<string, UserProfile>;
  nameIndex: Record<string, string>;
};

type AppView = 'landing' | 'profile' | 'home' | 'chat';

const emptyStore: ProfileStore = { byAddress: {}, nameIndex: {} };

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readProfileStore(): ProfileStore {
  if (!isBrowser()) return emptyStore;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return emptyStore;
    const parsed = JSON.parse(raw) as Partial<ProfileStore>;
    return {
      byAddress: parsed.byAddress ?? {},
      nameIndex: parsed.nameIndex ?? {},
    };
  } catch {
    return emptyStore;
  }
}

function writeProfileStore(store: ProfileStore): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(store));
}

function getProfileByAddress(address: string): UserProfile | null {
  const store = readProfileStore();
  return store.byAddress[address] ?? null;
}

function isNameTaken(name: string, ownerAddress?: string | null): boolean {
  const store = readProfileStore();
  const key = name.toLowerCase();
  const currentOwner = store.nameIndex[key];
  return Boolean(currentOwner && currentOwner !== ownerAddress);
}

function saveProfile(profile: UserProfile): UserProfile {
  const store = readProfileStore();
  const nextStore: ProfileStore = {
    byAddress: { ...store.byAddress, [profile.address]: profile },
    nameIndex: { ...store.nameIndex, [profile.name.toLowerCase()]: profile.address },
  };
  writeProfileStore(nextStore);
  return profile;
}

function findProfileByName(name: string): UserProfile | null {
  const store = readProfileStore();
  const key = name.toLowerCase();
  const owner = store.nameIndex[key];
  if (!owner) return null;
  return store.byAddress[owner] ?? null;
}

export const App: React.FC = () => {
  const [account, setAccount] = useState<string | null>(null);
  const [kp] = useState(generateKeyPair);
  const [peerPublicKey, setPeerPublicKey] = useState<string>('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileError, setProfileError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<UserProfile | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  const myPublicKeyEncoded = useMemo(() => encodePublicKey(kp.publicKey), [kp.publicKey]);

  const handleConnectWallet = async () => {
    try {
      setIsConnecting(true);
      const { account: addr } = await connectWallet();
      const existingProfile = getProfileByAddress(addr);
      setAccount(addr);
      if (existingProfile) {
        setProfile(existingProfile);
        setCurrentView('home');
      } else {
        setProfile(null);
        setCurrentView('profile');
      }
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

  const handleCreateProfile = () => {
    if (!account) {
      setProfileError('Connect your Massa wallet first.');
      return;
    }

    const trimmed = profileNameInput.trim();
    if (trimmed.length < 3) {
      setProfileError('Pick a name with at least 3 characters.');
      return;
    }
    if (trimmed.length > 24) {
      setProfileError('Name cannot exceed 24 characters.');
      return;
    }
    if (!/^[a-z0-9_\-\s]+$/i.test(trimmed)) {
      setProfileError('Use letters, numbers, spaces, underscores or dashes only.');
      return;
    }
    if (isNameTaken(trimmed, account)) {
      setProfileError('That name is already taken. Try another one.');
      return;
    }

    const newProfile = saveProfile({
      address: account,
      name: trimmed,
      createdAt: Date.now(),
    });
    setProfile(newProfile);
    setSearchResult(null);
    setProfileError('');
    setCurrentView('home');
  };

  const handleSearchProfiles = (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResult(null);
      setSearchFeedback('Type a name to search.');
      return;
    }
    const found = findProfileByName(query);
    if (!found) {
      setSearchResult(null);
      setSearchFeedback(`No profile found for "${query}".`);
      return;
    }
    setSearchResult(found);
    setSearchFeedback(null);
  };

  const handleNavigateToChat = () => {
    if (!account || !profile) return;
    setCurrentView('chat');
  };

  const handleBackToHome = () => {
    setCurrentView('home');
  };

  useEffect(() => {
    if (account) {
      handleFetchMessages().catch(console.error);
    }
  }, [account]);

  useEffect(() => {
    if (!account) {
      setProfile(null);
      setCurrentView('landing');
      return;
    }
    const existing = getProfileByAddress(account);
    if (existing) {
      setProfile(existing);
      setCurrentView((prev) => (prev === 'chat' ? 'chat' : 'home'));
    } else {
      setProfile(null);
      setCurrentView('profile');
    }
  }, [account]);

  useEffect(() => {
    if (currentView === 'profile' && profile?.name) {
      setProfileNameInput(profile.name);
    }
    if (currentView !== 'profile') {
      setProfileError('');
    }
    if (currentView !== 'chat') {
      setSearchResult(null);
    }
  }, [currentView, profile]);

  const renderLandingView = () => (
    <header className="hero">
      <div className="hero-left">
        <h1 className="hero-title">
          Massa<span>Chat</span>
        </h1>
        <p className="hero-subtitle">
          A WhatsApp-style, end-to-end encrypted web3 messenger powered by Massa smart contracts and IPFS.
        </p>
        <div className="feature-grid">
          <div className="feature-card">
            <h3>On-chain identities</h3>
            <p>Claim a unique chat handle linked to your Massa wallet.</p>
          </div>
          <div className="feature-card">
            <h3>Encrypted delivery</h3>
            <p>Messages stay private thanks to NaCl public-key boxes.</p>
          </div>
          <div className="feature-card">
            <h3>dWeb ready</h3>
            <p>Deploy the entire experience on Massa&apos;s decentralized web.</p>
          </div>
          <div className="feature-card">
            <h3>IPFS storage</h3>
            <p>Attachments are pinned through Pinata for decentralized reach.</p>
          </div>
        </div>
        <div className="cta-row">
          <button className="btn-primary" onClick={handleConnectWallet} disabled={isConnecting}>
            {account ? 'Wallet Connected' : isConnecting ? 'Connecting…' : 'Connect Massa Wallet'}
          </button>
        </div>
      </div>
      <div className="hero-right">
        <div className="hero-card">
          <p>Connect your wallet to reserve a name and start chatting securely.</p>
          <small>Need a wallet? Install Massa Station or Bearby.</small>
        </div>
      </div>
    </header>
  );

  const renderProfileView = () => (
    <div className="profile-flow">
      <div className="profile-card">
        <p className="eyebrow">Step 1 · Secure your chat name</p>
        <h2>Create your public profile</h2>
        <p className="muted">
          Pick a short, searchable name so friends can find you. It links to your connected Massa address.
        </p>
        <label>
          Display name
          <input
            type="text"
            value={profileNameInput}
            onChange={(e) => setProfileNameInput(e.target.value)}
            placeholder="e.g. neonfox"
          />
        </label>
        {profileError && <div className="form-error">{profileError}</div>}
        <button className="btn-primary" onClick={handleCreateProfile} disabled={!account}>
          Save profile
        </button>
      </div>
    </div>
  );

  const renderHomeView = () => (
    <div className="home-grid">
      <section className="home-panel">
        <p className="eyebrow">Welcome back</p>
        <h2>{profile ? `Hey ${profile.name} 👋` : 'You are connected'}</h2>
        <p className="muted">
          Manage your encrypted chats, discover friends by their MassaChat names, and jump into the secure messenger
          whenever you&apos;re ready.
        </p>
        <div className="home-actions">
          <button className="btn-primary" onClick={handleNavigateToChat} disabled={!account || !profile}>
            Open secure chat
          </button>
          <button className="btn-secondary" onClick={() => setCurrentView('landing')}>
            View landing
          </button>
        </div>
        <ul className="home-feature-list">
          <li>🔒 End-to-end encryption with NaCl.</li>
          <li>🧬 Signed messages recorded on Massa.</li>
          <li>🌐 IPFS storage via Pinata proxy.</li>
        </ul>
      </section>
      <aside className="profile-summary">
        <div className="profile-row">
          <span className="label">Chat name</span>
          <strong>{profile?.name ?? 'Not set'}</strong>
        </div>
        <div className="profile-row">
          <span className="label">Wallet</span>
          <code>{account ? `${account.slice(0, 8)}…${account.slice(-6)}` : '—'}</code>
        </div>
        <div className="search-card">
          <p className="label">Find people by name</p>
          <form onSubmit={handleSearchProfiles}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search @friend"
            />
            <button type="submit" className="btn-secondary">
              Search
            </button>
          </form>
          {searchFeedback && <p className="muted">{searchFeedback}</p>}
          {searchResult && (
            <div className="search-result">
              <p>
                <strong>{searchResult.name}</strong> · {searchResult.address.slice(0, 8)}…
                {searchResult.address.slice(-6)}
              </p>
              <p className="muted">
                Ask them for their encrypted chat key, then paste it inside the conversation composer.
              </p>
              <button className="text-link" onClick={() => setCurrentView('chat')}>
                Go to chat
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );

  const renderChatView = () => (
    <>
      <div className="view-header">
        <button className="btn-secondary" onClick={handleBackToHome}>
          ← Back to home
        </button>
        <div className="wallet-pill">{profile ? `${profile.name} · ${account?.slice(-6)}` : account}</div>
      </div>
      <header className="hero">
        <div className="hero-left">
          <h1 className="hero-title">
            Massa<span>Chat</span>
          </h1>
          <p className="hero-subtitle">
            A WhatsApp-style, end-to-end encrypted web3 messenger, running fully on the Massa blockchain with IPFS-powered
            storage.
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
            <button className="btn-primary" onClick={handleConnectWallet} disabled={isConnecting}>
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
                  <div key={idx} className={m.sender === account ? 'bubble bubble-me' : 'bubble bubble-them'}>
                    <div className="bubble-text">{m.text}</div>
                    <div className="bubble-meta">{new Date(m.timestamp).toLocaleTimeString()}</div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="empty-state">
                    No messages yet. Connect your wallet, share your public key with a friend, and start chatting.
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
    </>
  );

  let viewContent: React.ReactNode;
  if (currentView === 'profile') {
    viewContent = renderProfileView();
  } else if (currentView === 'home') {
    viewContent = renderHomeView();
  } else if (currentView === 'chat') {
    viewContent = renderChatView();
  } else {
    viewContent = renderLandingView();
  }

  return (
    <div className="app-root">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />
      {viewContent}
    </div>
  );
};

