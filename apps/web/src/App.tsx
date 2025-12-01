import React, { useEffect, useMemo, useState } from 'react';
import {
  connectWallet,
  addMessage,
  getLastIndex,
  getMessage,
  registerProfile,
  getProfileByAddress as getProfileByAddressOnChain,
  getProfileByUsername as getProfileByUsernameOnChain,
  setPrivacy,
  getPrivacy,
  setBlocked,
  isBlocked,
  touchLastSeen,
  getLastSeen,
  OnChainProfile,
  OnChainPrivacy,
} from './lib/massa';
import {
  generateKeyPair,
  encodePublicKey,
  decodePublicKey,
  encryptMessage,
  decryptMessage,
} from './lib/crypto';
import { uploadEncryptedPayload, fetchFromIPFS, uploadJson } from './lib/pinata';

type ChatMessage = {
  sender: string;
  text: string;
  timestamp: number;
};

const PROFILE_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

type AppView = 'landing' | 'profile' | 'home' | 'chat';

type UiProfile = {
  address: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  createdAt: number;
  updatedAt: number;
};

type UiPrivacy = OnChainPrivacy;

type ActiveConversation = {
  peer: UiProfile;
  convId: string;
};

function conversationIdFor(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `conv-${x}-${y}`;
}

function mapProfile(raw: OnChainProfile | null): UiProfile | null {
  if (!raw) return null;
  const avatarUrl = raw.avatarCid ? `${PROFILE_GATEWAY}${raw.avatarCid}` : null;
  return {
    address: raw.address,
    username: raw.username,
    displayName: raw.displayName || raw.username || raw.address.slice(0, 10),
    avatarUrl,
    bio: raw.bio ?? '',
    createdAt: Number(raw.createdAt ?? 0n),
    updatedAt: Number(raw.updatedAt ?? 0n),
  };
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
  const [profile, setProfile] = useState<UiProfile | null>(null);
  const [profileUsername, setProfileUsername] = useState('');
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreview, setProfileAvatarPreview] = useState<string | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<UiProfile | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ActiveConversation | null>(null);
  const [blockedInConversation, setBlockedInConversation] = useState(false);
  const [privacy, setPrivacyState] = useState<UiPrivacy | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remoteLastSeen, setRemoteLastSeen] = useState<string | null>(null);

  const myPublicKeyEncoded = useMemo(() => encodePublicKey(kp.publicKey), [kp.publicKey]);

  const handleConnectWallet = async () => {
    try {
      setIsConnecting(true);
      const { account: addr } = await connectWallet();
      const existingProfileRaw = await getProfileByAddressOnChain(addr);
      const existingProfile = mapProfile(existingProfileRaw);
      setAccount(addr);
      if (existingProfile) {
        setProfile(existingProfile);
        const priv = await getPrivacy(addr);
        setPrivacyState(priv ?? { showLastSeen: true, showProfilePhoto: true, showBio: true });
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
      if (activeConversation && blockedInConversation) {
        alert('You have blocked this user. Unblock them in the chat header to send messages.');
        return;
      }

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

      const { cid } = await uploadEncryptedPayload(payload);

      const convId =
        activeConversation?.convId && profile && activeConversation.peer
          ? activeConversation.convId
          : 'demo-conversation';

      await addMessage(convId, cid);

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
      const convId =
        activeConversation?.convId && profile && activeConversation.peer
          ? activeConversation.convId
          : 'demo-conversation';

      const lastIndex = await getLastIndex(convId);
      const fetched: ChatMessage[] = [];
      for (let i = 1n; i <= lastIndex; i++) {
        const msgJson = await getMessage(convId, i);
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

  const handleCreateProfile = async () => {
    if (!account) {
      setProfileError('Connect your Massa wallet first.');
      return;
    }

    const username = profileUsername.trim();
    const displayName = profileDisplayName.trim() || username;
    const bio = profileBio.trim();

    if (username.length < 3) {
      setProfileError('Pick a username with at least 3 characters.');
      return;
    }
    if (username.length > 24) {
      setProfileError('Username cannot exceed 24 characters.');
      return;
    }
    if (!/^[a-z0-9_\-]+$/i.test(username)) {
      setProfileError('Usernames can only contain letters, numbers, underscores or dashes (no spaces).');
      return;
    }

    setProfileSaving(true);
    setProfileError('');
    try {
      if (profileUsername) {
        const existingByUsername = await getProfileByUsernameOnChain(username);
        if (existingByUsername && existingByUsername.address !== account) {
          setProfileError('That username is already taken. Try another one.');
          setUsernameStatus('taken');
          return;
        }
      }

      let avatarCid = '';
      if (profileAvatarFile) {
        const fileData = await profileAvatarFile.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(fileData)));
        const mime = profileAvatarFile.type || 'image/png';
        const { cid } = await uploadJson({
          type: 'avatar',
          mime,
          data: base64,
        });
        avatarCid = cid;
      }

      await registerProfile({
        ownerAddress: account,
        username,
        displayName,
        avatarCid,
        bio,
      });

      const fresh = await getProfileByAddressOnChain(account);
      const mapped = mapProfile(fresh);
      if (mapped) {
        setProfile(mapped);
      }
      setSearchResult(null);
      setUsernameStatus('available');
      setCurrentView('home');
    } catch (err) {
      console.error(err);
      setProfileError('Failed to save profile on-chain. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSearchProfiles = (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResult(null);
      setSearchFeedback('Type a name to search.');
      return;
    }
    (async () => {
      try {
        const foundRaw = await getProfileByUsernameOnChain(query);
        const found = mapProfile(foundRaw);
        if (!found) {
          setSearchResult(null);
          setSearchFeedback(`No profile found for "${query}".`);
          return;
        }
        setSearchResult(found);
        setSearchFeedback(null);
      } catch (err) {
        console.error(err);
        setSearchFeedback('Search failed. Please try again.');
      }
    })();
  };

  const handleNavigateToChat = () => {
    if (!account || !profile || !searchResult) return;
    const convId = conversationIdFor(account, searchResult.address);
    setActiveConversation({ peer: searchResult, convId });
    setCurrentView('chat');
  };

  const handleBackToHome = () => {
    setCurrentView('home');
  };

  useEffect(() => {
    if (account && activeConversation) {
      handleFetchMessages().catch(console.error);
    }
  }, [account, activeConversation]);

  useEffect(() => {
    if (!account) {
      setProfile(null);
      setCurrentView('landing');
      return;
    }
    (async () => {
      const existingRaw = await getProfileByAddressOnChain(account);
      const existing = mapProfile(existingRaw);
      if (existing) {
        setProfile(existing);
        const priv = await getPrivacy(account);
        setPrivacyState(priv ?? { showLastSeen: true, showProfilePhoto: true, showBio: true });
        setCurrentView((prev) => (prev === 'chat' ? 'chat' : 'home'));
      } else {
        setProfile(null);
        setCurrentView('profile');
      }
    })().catch(console.error);
  }, [account]);

  useEffect(() => {
    if (currentView === 'profile' && profile?.username) {
      setProfileUsername(profile.username);
      setProfileDisplayName(profile.displayName);
      setProfileBio(profile.bio);
    }
    if (currentView !== 'profile') {
      setProfileError('');
    }
    if (currentView !== 'chat') {
      setSearchResult(null);
      setActiveConversation(null);
      setBlockedInConversation(false);
    }
  }, [currentView, profile]);

  useEffect(() => {
    if (!account) return;
    touchLastSeen(account).catch(console.error);
  }, [account]);

  useEffect(() => {
    if (!activeConversation) {
      setRemoteLastSeen(null);
      return;
    }
    (async () => {
      const raw = await getLastSeen(activeConversation.peer.address);
      if (!raw) {
        setRemoteLastSeen(null);
        return;
      }
      const millis = Number(raw);
      if (!millis) {
        setRemoteLastSeen(null);
        return;
      }
      setRemoteLastSeen(new Date(millis).toLocaleString());
    })().catch(console.error);
  }, [activeConversation]);

  const handleToggleBlock = async () => {
    if (!account || !activeConversation) return;
    const target = activeConversation.peer.address;
    try {
      await setBlocked(account, target, !blockedInConversation);
      const nowBlocked = await isBlocked(account, target);
      setBlockedInConversation(nowBlocked);
    } catch (err) {
      console.error(err);
      alert('Failed to update block status.');
    }
  };

  const handlePrivacyChange = async (partial: Partial<UiPrivacy>) => {
    if (!account) return;
    const next: UiPrivacy = {
      showLastSeen: partial.showLastSeen ?? privacy?.showLastSeen ?? true,
      showProfilePhoto: partial.showProfilePhoto ?? privacy?.showProfilePhoto ?? true,
      showBio: partial.showBio ?? privacy?.showBio ?? true,
    };
    setPrivacyState(next);
    try {
      await setPrivacy({
        ownerAddress: account,
        showLastSeen: next.showLastSeen,
        showProfilePhoto: next.showProfilePhoto,
        showBio: next.showBio,
      });
    } catch (err) {
      console.error(err);
      alert('Failed to update privacy settings.');
    }
  };

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
          Username
          <input
            type="text"
            value={profileUsername}
            onChange={(e) => {
              setProfileUsername(e.target.value);
              setUsernameStatus(null);
            }}
            placeholder="e.g. neonfox"
          />
        </label>
        <label>
          Display name
          <input
            type="text"
            value={profileDisplayName}
            onChange={(e) => setProfileDisplayName(e.target.value)}
            placeholder="How your name appears in chats"
          />
        </label>
        <label>
          Bio
          <textarea
            value={profileBio}
            onChange={(e) => setProfileBio(e.target.value)}
            placeholder="Say something about yourself"
          />
        </label>
        <label>
          Profile picture
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setProfileAvatarFile(file);
              if (file) {
                const url = URL.createObjectURL(file);
                setProfileAvatarPreview(url);
              } else {
                setProfileAvatarPreview(null);
              }
            }}
          />
        </label>
        {profileAvatarPreview && (
          <div className="avatar-preview">
            <img src={profileAvatarPreview} alt="Avatar preview" />
          </div>
        )}
        {usernameStatus && (
          <div className={`username-status ${usernameStatus === 'available' ? 'ok' : 'error'}`}>
            {usernameStatus === 'available' ? 'Username is available' : 'Username already in use'}
          </div>
        )}
        {profileError && <div className="form-error">{profileError}</div>}
        <button className="btn-primary" onClick={handleCreateProfile} disabled={!account || profileSaving}>
          {profileSaving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );

  const renderHomeView = () => (
    <div className="home-grid">
      <section className="home-panel">
        <p className="eyebrow">Welcome back</p>
        <h2>{profile ? `Hey ${profile.displayName} 👋` : 'You are connected'}</h2>
        <p className="muted">
          Manage your encrypted chats, discover friends by their MassaChat names, and jump into the secure messenger
          whenever you&apos;re ready.
        </p>
        <div className="home-actions">
          <button
            className="btn-primary"
            onClick={handleNavigateToChat}
            disabled={!account || !profile || !searchResult}
          >
            Open chat
          </button>
          <button className="btn-secondary" onClick={() => setSettingsOpen(true)}>
            Privacy &amp; settings
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
          <strong>{profile?.username ?? 'Not set'}</strong>
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
                <strong>{searchResult.displayName}</strong> · @{searchResult.username} ·{' '}
                {searchResult.address.slice(0, 8)}…{searchResult.address.slice(-6)}
              </p>
              <p className="muted">
                Tap &quot;Open chat&quot; above to start an encrypted conversation.
              </p>
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
        <div className="wallet-pill">
          {profile ? `${profile.displayName} · @${profile.username}` : account}
        </div>
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
            {activeConversation && (
              <span className="wallet-pill">
                Chatting with {activeConversation.peer.displayName} (@{activeConversation.peer.username})
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
                  <div className="chat-name">
                    {activeConversation
                      ? activeConversation.peer.displayName
                      : 'Demo Conversation'}
                  </div>
                  <div className="chat-status">
                    {activeConversation && remoteLastSeen
                      ? `Last seen ${remoteLastSeen}`
                      : account
                      ? 'Secure • Encrypted by Massa'
                      : 'Connect wallet to start'}
                  </div>
                </div>
                <div className="chat-actions">
                  <button className="icon-button" title="Voice call (coming soon)" type="button">
                    📞
                  </button>
                  <button className="icon-button" title="Video call (coming soon)" type="button">
                    🎥
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={handleToggleBlock}
                    title={blockedInConversation ? 'Unblock user' : 'Block user'}
                  >
                    {blockedInConversation ? '🚫' : '⛔'}
                  </button>
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
      {settingsOpen && privacy && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Privacy &amp; visibility</h3>
            <p className="muted">Control what others can see about you.</p>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={privacy.showLastSeen}
                onChange={(e) => handlePrivacyChange({ showLastSeen: e.target.checked })}
              />
              <span>Show my last seen</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={privacy.showProfilePhoto}
                onChange={(e) => handlePrivacyChange({ showProfilePhoto: e.target.checked })}
              />
              <span>Show my profile picture</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={privacy.showBio}
                onChange={(e) => handlePrivacyChange({ showBio: e.target.checked })}
              />
              <span>Show my bio</span>
            </label>
            <button className="btn-secondary" onClick={() => setSettingsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

