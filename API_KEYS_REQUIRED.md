# EduOS AI — API Keys & Credentials Required

This document lists all API keys, credentials, and configuration variables needed to run the complete EduOS AI project (backend + frontend).

---

## 📋 Table of Contents

1. [Backend Environment Variables](#backend-environment-variables)
2. [Frontend Environment Variables](#frontend-environment-variables)
3. [Third-Party API Providers (Optional)](#third-party-api-providers-optional)
4. [Setup Instructions by Component](#setup-instructions-by-component)

---

## 🔧 Backend Environment Variables

### Core Configuration (`eduOs_backend/.env`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Deployment environment | `development` or `production` |
| `PORT` | Yes | Backend server port | `5000` |
| `HOST` | Yes | Server host/IP | `localhost` or `0.0.0.0` |
| `MONGO_URI` | Yes | MongoDB connection string | `mongodb://localhost:27017/school_erp` or MongoDB Atlas URI |
| `LOG_LEVEL` | No | Logging verbosity | `info`, `debug`, `warn`, `error` (default: `info`) |
| `LOG_DIR` | No | Directory for log files | `logs` (default) |
| `CORS_ORIGIN` | No | CORS allowed origins | `*` (dev) or specific domain (prod) |
| `SWAGGER_ENABLED` | No | Enable API documentation | `true` or `false` |

### Authentication & Security (`eduOs_backend/.env`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `JWT_SECRET` | **⚠️ Critical** | Secret key for signing JWT tokens | `your-very-long-random-secret-key-change-in-production` |
| `GOOGLE_CLIENT_ID` | Conditional* | Google OAuth client ID (for Google Sign-In) | `123456789-abcdef.apps.googleusercontent.com` |
| `MEDICAL_ENCRYPTION_KEY` | **⚠️ Critical** | 32-byte key for AES-256-GCM encryption of medical records | `your-32-character-encryption-key-here` |
| `WHATSAPP_VERIFY_TOKEN` | Conditional* | Token for WhatsApp webhook verification | `any-random-token-you-choose` |
| `BCRYPT_SALT_ROUNDS` | No | Password hashing salt rounds | `10` (default) |

*Conditional: Required only if Google Sign-In or WhatsApp integration is enabled.

### Token Management (`eduOs_backend/.env`)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `ACCESS_TOKEN_EXPIRES_IN` | No | JWT access token expiration | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | No | Refresh token validity period (days) | `30` |
| `OTP_TTL_MINUTES` | No | OTP code validity period (minutes) | `5` |
| `OTP_MAX_ATTEMPTS` | No | Maximum OTP verification attempts | `5` |
| `MULTI_PROFILE_ENABLED` | No | Allow users with multiple profiles | `true` |

### Rate Limiting (`eduOs_backend/.env`)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit time window (milliseconds) | `900000` (15 minutes) |
| `RATE_LIMIT_MAX` | No | General API request limit per window | `2000` |
| `RATE_LIMIT_AUTH_MAX` | No | Auth endpoint request limit (login/OTP) | `30` |

### File Upload (`eduOs_backend/.env`)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `UPLOAD_DIR` | No | Directory for file uploads | `uploads` |
| `UPLOAD_MAX_BYTES` | No | Maximum upload file size (bytes) | `15728640` (15 MB) |

### AI & Third-Party Providers (`eduOs_backend/.env`)

| Variable | Required | Description | Options |
|----------|----------|-------------|---------|
| `AI_PROVIDER` | No | AI copilot provider | `rules` (default), `anthropic`, `openai` |
| `ANTHROPIC_API_KEY` | Conditional* | Anthropic Claude API key | (get from https://console.anthropic.com) |
| `OPENAI_API_KEY` | Conditional* | OpenAI API key | (get from https://platform.openai.com) |
| `SMS_PROVIDER` | No | SMS OTP delivery service | `console` (dev-only), `twilio`, `msg91`, `aws-sns` |
| `EMAIL_PROVIDER` | No | Email OTP delivery service | `console` (dev-only), `sendgrid`, `aws-ses`, `resend` |
| `PAYMENT_PROVIDER` | No | Payment gateway | `sandbox` (dev), `none`, `razorpay`, `stripe` |

*Conditional: Required only if AI_PROVIDER is set to the corresponding value.

---

## 📱 Frontend Environment Variables

### Frontend Configuration (`Frontend/web/.env` or `.env.local`)

| Variable | Required | Type | Description | Example |
|----------|----------|------|-------------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | Yes | Public | Backend API base URL | `http://localhost:5000` or `https://api.school.com` |
| `GOOGLE_CLIENT_ID` | Conditional* | Secret | Google OAuth client ID (NextAuth) | `123456789-abcdef.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Conditional* | Secret | Google OAuth client secret (NextAuth) | `your-google-client-secret` |
| `NEXTAUTH_SECRET` | Conditional* | Secret | NextAuth session encryption secret | `your-random-nextauth-secret` |
| `NEXTAUTH_URL` | Conditional* | Public | NextAuth callback URL (for OAuth redirect) | `http://localhost:3000` or `https://school.com` |

*Conditional: Required only if Google Sign-In authentication is enabled.

**Note:** Variables prefixed with `NEXT_PUBLIC_` are exposed to the client (browser). Secrets should NEVER have this prefix.

---

## 🔌 Third-Party API Providers (Optional)

### 1. **Google OAuth** (for Sign-In)

**Needed for:** Both backend (`GOOGLE_CLIENT_ID`) and frontend (NextAuth)

- **Get credentials:** https://console.cloud.google.com/
- **Steps:**
  1. Create a new project
  2. Enable Google+ API
  3. Create OAuth 2.0 credentials (Web application)
  4. Set authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (dev) or your production URL
  5. Copy Client ID and Client Secret

### 2. **SMS OTP Providers** (Optional - for production SMS delivery)

**Provider options:**
- **Twilio** → `SMS_PROVIDER=twilio`
  - Get API credentials: https://www.twilio.com/
  - Requires: Account SID, Auth Token, Twilio Phone Number
  
- **Msg91** → `SMS_PROVIDER=msg91`
  - Get API credentials: https://www.msg91.com/
  - Requires: API key
  
- **AWS SNS** → `SMS_PROVIDER=aws-sns`
  - Requires: AWS Access Key ID, Secret Access Key

**In development:** `SMS_PROVIDER=console` (logs OTP to console/logs instead of sending)

### 3. **Email OTP Providers** (Optional - for production email delivery)

**Provider options:**
- **SendGrid** → `EMAIL_PROVIDER=sendgrid`
  - Get API key: https://sendgrid.com/
  - Requires: SendGrid API key

- **AWS SES** → `EMAIL_PROVIDER=aws-ses`
  - Requires: AWS Access Key ID, Secret Access Key

- **Resend** → `EMAIL_PROVIDER=resend`
  - Get API key: https://resend.com/
  - Requires: Resend API key

**In development:** `EMAIL_PROVIDER=console` (logs OTP to console instead of sending)

### 4. **Payment Gateways** (Optional - for online fee payments)

**Provider options:**
- **Razorpay** → `PAYMENT_PROVIDER=razorpay`
  - Get credentials: https://razorpay.com/
  - Requires: Key ID, Key Secret
  
- **Stripe** → `PAYMENT_PROVIDER=stripe`
  - Get credentials: https://stripe.com/
  - Requires: Publishable Key, Secret Key

**In development:** `PAYMENT_PROVIDER=sandbox` (simulates payments without real charges)

### 5. **WhatsApp Business API** (Optional - for WhatsApp assistant)

**Needed for:** Live WhatsApp integration

- **Get credentials:** https://www.meta.com/en/business/tools/whatsapp-business-platform/
- **Required environment variables:**
  - `WHATSAPP_VERIFY_TOKEN` - Your chosen verification token
  - `WA_PHONE_NUMBER_ID` - Your WhatsApp Business phone number ID
  - `WA_ACCESS_TOKEN` - Meta API access token
  - `WA_APP_SECRET` - Your app secret for webhook signature verification

**In development:** `WHATSAPP_VERIFY_TOKEN=change-this-verify-token` (simulation mode only)

### 6. **AI/LLM APIs** (Optional - for advanced copilot features)

**Provider options:**
- **Anthropic Claude** → `AI_PROVIDER=anthropic`
  - Get API key: https://console.anthropic.com/
  - Requires: `ANTHROPIC_API_KEY`
  
- **OpenAI GPT** → `AI_PROVIDER=openai`
  - Get API key: https://platform.openai.com/
  - Requires: `OPENAI_API_KEY`

**In development:** `AI_PROVIDER=rules` (uses deterministic rule-based responses, no API key needed)

### 7. **MongoDB** (Required)

- **Local development:** MongoDB running on `mongodb://localhost:27017`
- **Production:** MongoDB Atlas (cloud)
  - Create account: https://www.mongodb.com/cloud/atlas
  - Connection string format: `mongodb+srv://username:password@cluster.mongodb.net/database-name?retryWrites=true&w=majority`

---

## ✅ Setup Instructions by Component

### For Development (Quick Start)

```bash
# Backend
cd eduOs_backend
cp .env.example .env  # If available, otherwise create .env

# Minimal .env for development:
NODE_ENV=development
PORT=5000
HOST=localhost
MONGO_URI=mongodb://localhost:27017/school_erp
JWT_SECRET=dev-secret-change-in-production
GOOGLE_CLIENT_ID=          # Optional - leave empty for now
MEDICAL_ENCRYPTION_KEY=dev-key-32-bytes-needed
WHATSAPP_VERIFY_TOKEN=dev-token

npm install
npm run seed    # Load demo data
npm run dev     # Starts on http://localhost:5000

# Frontend
cd ../Frontend/web
cp .env.example .env.local  # If available, otherwise create .env.local

# Minimal .env.local for development:
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
GOOGLE_CLIENT_ID=        # Optional - leave empty for now
GOOGLE_CLIENT_SECRET=    # Optional - leave empty for now
NEXTAUTH_SECRET=dev-secret

npm install
npm run dev     # Starts on http://localhost:3000
```

### For Production

1. **Set all critical secrets:**
   - `JWT_SECRET` - Use a strong random string (min 32 chars)
   - `MEDICAL_ENCRYPTION_KEY` - Use a strong random 32-byte key
   - `NEXTAUTH_SECRET` - Use a strong random string
   - `GOOGLE_CLIENT_SECRET` - From Google Cloud Console

2. **Configure external services:**
   - Set `SMS_PROVIDER`, `EMAIL_PROVIDER`, `PAYMENT_PROVIDER` to actual providers
   - Add corresponding API keys from each provider

3. **Set production URLs:**
   - `NEXT_PUBLIC_BACKEND_URL` = Your production API URL
   - `NEXTAUTH_URL` = Your production frontend URL
   - `CORS_ORIGIN` = Your production frontend domain

4. **Disable development features:**
   - `NODE_ENV=production`
   - `SWAGGER_ENABLED=false`

5. **Use MongoDB Atlas:**
   - `MONGO_URI=mongodb+srv://...` with production credentials

---

## 🔐 Security Best Practices

1. **Never commit `.env` files** — Keep them in `.gitignore`
2. **Use environment-specific secrets** — Different keys for dev/staging/production
3. **Rotate secrets regularly** — Especially production JWT/encryption keys
4. **Use secret management** — Consider AWS Secrets Manager, Vault, or similar
5. **HTTPS only in production** — All API calls must use HTTPS
6. **Restrict API key permissions** — Use scoped/limited keys when possible
7. **Monitor API usage** — Track quota and set up alerts

---

## 📚 Quick Reference: What Works Out-of-the-Box

✅ **Without any API keys (Development Mode):**
- User authentication via email/SMS OTP (console logs the code)
- Student/parent/teacher portals with demo data
- Fee management and reporting
- Attendance tracking
- Assignment management
- Rule-based AI copilot (no LLM integration)
- WhatsApp simulation mode

❌ **Requires API Keys (Production Features):**
- Google Sign-In
- Real SMS delivery
- Real email delivery
- Online payment processing
- Live WhatsApp integration
- Advanced AI/LLM-based copilot

---

## 🆘 Troubleshooting API Key Issues

| Issue | Solution |
|-------|----------|
| "JWT_SECRET is undefined" | Add `JWT_SECRET=your-secret` to backend `.env` |
| Google login fails | Check `GOOGLE_CLIENT_ID` is correct and OAuth redirect URI is registered |
| OTP not being sent | Check `SMS_PROVIDER`/`EMAIL_PROVIDER` — set to `console` in dev |
| Payment errors | Check `PAYMENT_PROVIDER=sandbox` in dev, not `none` |
| WhatsApp webhook 401 | Verify `WHATSAPP_VERIFY_TOKEN` matches Meta's expectation |
| CORS errors | Ensure `CORS_ORIGIN` includes frontend URL, `NEXTAUTH_URL` is set |
| MongoDB connection fails | Check `MONGO_URI` is correct, MongoDB server is running |

---

Generated: 2024
Project: EduOS AI — School ERP with AI Copilot & Multi-Portal Architecture
