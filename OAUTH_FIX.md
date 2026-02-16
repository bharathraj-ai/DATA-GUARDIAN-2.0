# Google OAuth 400 Bad Request - Fix Guide

## 🎯 Issue
Getting a "400 Bad Request" error when trying to sign in with Google OAuth.

## ✅ Solutions Applied

### 1. Updated NextAuth Configuration
- Added `trustHost: true` to handle dynamic hosts properly
- Added proper OAuth parameters (`access_type: 'offline'`, `response_type: 'code'`)
- Improved callback URL validation in sign-in page

### 2. Environment Variables Required

Make sure you have these environment variables set in your `.env.local` file:

```env
# Google OAuth Credentials
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# NextAuth Configuration (IMPORTANT!)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-random-secret-key-here
```

**For production:**
```env
NEXTAUTH_URL=https://yourdomain.com
```

### 3. Google Cloud Console Configuration

The 400 error is usually caused by a **redirect URI mismatch**. Follow these steps:

#### Step 1: Get Your Callback URL
Your NextAuth callback URL will be:
- **Development**: `http://localhost:3000/api/auth/callback/google`
- **Production**: `https://yourdomain.com/api/auth/callback/google`

#### Step 2: Configure in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/auth/callback/google` (for development)
   - `https://yourdomain.com/api/auth/callback/google` (for production)

#### Step 3: Verify OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Make sure:
   - App is in **Testing** mode (or Published if ready)
   - Your email is added as a test user (if in Testing mode)
   - Required scopes are configured

### 4. Common Issues & Fixes

#### Issue: "redirect_uri_mismatch"
**Fix**: Ensure the redirect URI in Google Console **exactly matches** your `NEXTAUTH_URL/api/auth/callback/google`

#### Issue: "invalid_client"
**Fix**: 
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
- Make sure there are no extra spaces or quotes in `.env.local`

#### Issue: "access_denied"
**Fix**: 
- If app is in Testing mode, add your email as a test user
- Check OAuth consent screen configuration

### 5. Testing the Fix

1. Restart your development server after updating environment variables
2. Clear browser cache/cookies for localhost
3. Try signing in again

### 6. Debugging

If the issue persists, check:

1. **Server logs** - Look for NextAuth errors
2. **Browser console** - Check for JavaScript errors
3. **Network tab** - Inspect the OAuth request/response
4. **Environment variables** - Verify they're loaded correctly:
   ```bash
   # In your terminal, check if variables are set
   echo $NEXTAUTH_URL
   ```

## 📝 Notes

- The `trustHost: true` setting allows NextAuth to work with dynamic hosts (useful for deployment platforms)
- Always use `http://` for localhost, never `https://`
- The callback URL must end with `/api/auth/callback/google` exactly
- After changing Google Console settings, wait a few minutes for changes to propagate

## 🔒 Security Reminders

- Never commit `.env.local` to version control
- Use strong, random values for `NEXTAUTH_SECRET`
- In production, use HTTPS for `NEXTAUTH_URL`
- Regularly rotate OAuth credentials

