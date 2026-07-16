'use client';
import { useState } from 'react';

interface MockAccount {
  email: string;
  name: string;
  role: string;
  avatar: string;
}

const MOCK_GOOGLE_USERS: MockAccount[] = [
  { email: 'owner@schoolerp.com',     name: 'Default Owner',    role: 'Superadmin', avatar: '👑' },
  { email: 'admin@schoolerp.com',     name: 'Demo Admin',       role: 'Admin',      avatar: '🏛️' },
  { email: 'principal@schoolerp.com', name: 'Demo Principal',   role: 'Principal',  avatar: '🎓' },
  { email: 'teacher@schoolerp.com',   name: 'Demo Teacher',     role: 'Teacher',    avatar: '👩‍🏫' },
  { email: 'arjun.sharma@eduos.com',  name: 'Arjun Sharma',     role: 'Teacher',    avatar: '👨‍🏫' },
  { email: 'student1@eduos.com',      name: 'Student One',      role: 'Student',    avatar: '🎒' },
];

export default function GoogleMockAuthPage() {
  const [customEmail, setCustomEmail] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handleSelect = (email: string) => {
    if (window.opener) {
      window.opener.postMessage({ type: 'GOOGLE_MOCK_LOGIN_SUCCESS', email }, window.location.origin);
      window.close();
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f0f4f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      padding: 16,
      boxSizing: 'border-box'
    }}>
      <style>{`
        .google-card {
          width: 100%;
          max-width: 450px;
          background: #ffffff;
          border-radius: 28px;
          padding: 40px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          box-sizing: border-box;
        }
        .google-logo {
          display: flex;
          justify-content: center;
          margin-bottom: 16px;
        }
        .title {
          font-size: 24px;
          font-weight: 400;
          color: #1f1f1f;
          text-align: center;
          margin: 0 0 8px 0;
        }
        .subtitle {
          font-size: 16px;
          color: #444746;
          text-align: center;
          margin: 0 0 24px 0;
        }
        .account-list {
          display: flex;
          flex-direction: column;
          border: 1px solid #c4c7c5;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 20px;
        }
        .account-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border: none;
          background: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          border-bottom: 1px solid #c4c7c5;
          transition: background 0.2s;
        }
        .account-item:last-child {
          border-bottom: none;
        }
        .account-item:hover {
          background: #f8fafd;
        }
        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #eaf1fb;
          display: flex;
          align-items: center;
          justifyContent: center;
          font-size: 16px;
        }
        .name {
          font-size: 14px;
          font-weight: 500;
          color: #1f1f1f;
        }
        .email {
          font-size: 12px;
          color: #444746;
        }
        .custom-input {
          width: 100%;
          padding: 14px 16px;
          border: 1px solid #747775;
          border-radius: 4px;
          font-size: 16px;
          margin-bottom: 16px;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.2s;
        }
        .custom-input:focus {
          border-color: #0b57d0;
          border-width: 2px;
          padding: 13px 15px;
        }
        .btn-primary {
          background: #0b57d0;
          color: #ffffff;
          border: none;
          padding: 10px 24px;
          border-radius: 100px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn-primary:hover {
          background: #0842a0;
        }
        .btn-text {
          color: #0b57d0;
          border: none;
          background: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 8px 16px;
          border-radius: 100px;
          transition: background 0.2s;
        }
        .btn-text:hover {
          background: #f1f3f4;
        }
        .footer {
          font-size: 12px;
          color: #5e6278;
          text-align: center;
          margin-top: 24px;
          line-height: 1.5;
        }
      `}</style>

      <div className="google-card">
        <div className="google-logo">
          <svg width="40" height="40" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.22-.67-.35-1.37-.35-2.1z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
        </div>

        {!showCustom ? (
          <>
            <h1 className="title">Choose an account</h1>
            <p className="subtitle">to continue to Oakridge Academy</p>

            <div className="account-list">
              {MOCK_GOOGLE_USERS.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  className="account-item"
                  onClick={() => handleSelect(user.email)}
                >
                  <div className="avatar">{user.avatar}</div>
                  <div>
                    <div className="name">{user.name}</div>
                    <div className="email">{user.email}</div>
                  </div>
                </button>
              ))}
              <button
                type="button"
                className="account-item"
                onClick={() => setShowCustom(true)}
              >
                <div className="avatar">👤</div>
                <div>
                  <div className="name" style={{ color: '#0b57d0' }}>Use another account</div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="title" style={{ textAlign: 'left', marginBottom: 16 }}>Sign in</h1>
            <p className="subtitle" style={{ textAlign: 'left', marginBottom: 30 }}>to continue to Oakridge Academy</p>

            <input
              type="email"
              placeholder="Email or phone"
              className="custom-input"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              autoFocus
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
              <button type="button" className="btn-text" onClick={() => setShowCustom(false)}>Back</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleSelect(customEmail)}
                disabled={!customEmail.includes('@')}
              >
                Next
              </button>
            </div>
          </>
        )}

        <div className="footer">
          To continue, Google will share your name, email address, language preference, and profile picture with Oakridge Academy.
        </div>
      </div>
    </div>
  );
}
