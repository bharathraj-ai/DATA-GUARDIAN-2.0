# 🚀 Quick Test Guide - 5 Minutes

## Before You Start

**IMPORTANT:** Clear your browser cache OR use incognito window!

### Option 1: Incognito Window (RECOMMENDED)
```
Press: Ctrl + Shift + N (Chrome/Edge)
       Ctrl + Shift + P (Firefox)
```

### Option 2: Clear Cache
```
Press: Ctrl + Shift + Delete
Select: "Cached images and files"
Click: "Clear data"
```

---

## Test 1: Create and Share Link (2 minutes)

### Step 1: Go to Signup
```
URL: http://localhost:3000/signup
```

### Step 2: Fill Form
```
First Name: Test
Last Name: User
Email: test@example.com
Phone: 1234567890
Gender: Male
Age: 25
Time: 5 (minutes)
```

### Step 3: Generate Link
```
Click: "Generate Secure Link"
```

### ✅ Expected Result:
- Link appears instantly (no refresh needed)
- OTP shows (6 digits)
- QR code displays
- Owner dashboard link shows
- Countdown timer starts

### Step 4: Copy Share Link
```
Click: "Copy" button next to the link
```

### ✅ Expected Result:
- "Link copied!" message appears
- Link includes timestamp: `?t=1770401025595`

---

## Test 2: Verify OTP (1 minute)

### Step 5: Open Share Link
```
1. Open NEW TAB (or incognito window)
2. Paste the share link
3. Press Enter
```

### ✅ Expected Result:
- **OTP verification page displays** (NOT blank!)
- Dark background with gradient effects
- 6 input boxes for OTP
- Countdown timer showing "OTP expires in 05:00"
- Lock icon at top
- Security badges at bottom

### Step 6: Enter OTP
```
Type the 6-digit OTP from signup page
```

### ✅ Expected Result:
- Auto-advances between input boxes
- Auto-submits when all 6 digits entered
- Shows "Verifying..." loading state
- Success animation plays
- Redirects to view page automatically

---

## Test 3: View Data (1 minute)

### Step 7: View Page Loads
```
After OTP verification, you're on view page
```

### ✅ Expected Result:
- User data displays
- Countdown timer updates every second
- "LIVE" status badge shows
- Data is masked (e.g., t***@example.com)
- "Temporarily Reveal" button visible

### Step 8: Reveal Data
```
Click: "Temporarily Reveal" button
```

### ✅ Expected Result:
- Data reveals for 10 seconds
- Full email and phone visible
- Button changes to "Hide Data"
- Auto-hides after 10 seconds

---

## Test 4: Kill Switch (1 minute)

### Step 9: Open Owner Dashboard
```
1. Go back to signup page tab
2. Find "Owner Dashboard (Kill Switch)" link
3. Click or copy the link
4. Open in new tab
```

### ✅ Expected Result:
- Dashboard shows link status
- Status: "Active" or "Being Viewed"
- Time remaining displays
- "Revoke Access Now" button visible

### Step 10: Revoke Access
```
1. Click: "Revoke Access Now"
2. Click: "Confirm Revoke"
```

### ✅ Expected Result:
- Status changes to "Revoked" (no refresh needed)
- Success message appears
- "Revoke Access Now" button disappears

### Step 11: Check View Page
```
Go back to the view page tab
```

### ✅ Expected Result:
- Error message appears: "Access has been revoked"
- Data disappears
- "Create New Link" button shows
- **All happens automatically (no refresh needed)**

---

## Test 5: Navigation (30 seconds)

### Step 12: Create New Link
```
On view page error state:
Click: "Create New Link" button
```

### ✅ Expected Result:
- Returns to signup page
- Form is empty and fresh
- No cached data
- **No refresh needed**

### Step 13: Create Another Link
```
After generating a link:
Click: "Create Another Secure Link" button
```

### ✅ Expected Result:
- Page reloads
- Form clears
- Ready for new submission
- **No manual refresh needed**

---

## ✅ Success Criteria

If ALL of these work WITHOUT manual refresh:
- ✅ Link generation
- ✅ OTP page displays (not blank)
- ✅ OTP verification
- ✅ Data viewing
- ✅ Kill switch
- ✅ Navigation between pages

**Then everything is working perfectly! 🎉**

---

## ❌ If Something Doesn't Work

### Issue: Blank OTP Page
**Solution:** You're seeing cached version
```
1. Close ALL tabs of localhost:3000
2. Open NEW incognito window
3. Test again
```

### Issue: Need to Refresh
**Solution:** Browser has old cache
```
1. Press Ctrl + Shift + R (hard refresh)
2. After this ONE time, should work normally
```

### Issue: OTP Verification Fails
**Solution:** Check console for errors
```
1. Press F12 (open DevTools)
2. Go to Console tab
3. Look for red errors
4. Share screenshot if needed
```

---

## 🎯 Quick Checklist

Use this to verify everything:

- [ ] Signup page loads
- [ ] Form submission works
- [ ] Link generates with timestamp
- [ ] OTP page displays (not blank)
- [ ] OTP verification works
- [ ] View page shows data
- [ ] Countdown timer works
- [ ] Reveal/hide works
- [ ] Kill switch works
- [ ] Navigation works
- [ ] No refresh needed anywhere

---

## 📊 Expected Timings

- Page loads: < 1 second
- Link generation: < 1 second
- OTP verification: < 1 second
- Kill switch: < 3 seconds
- Navigation: < 1 second

---

## 🎉 All Done!

If all tests pass, your Data Guardian application is:
- ✅ Fully functional
- ✅ Cache-free
- ✅ Production-ready
- ✅ Secure and fast

**Enjoy your secure data sharing platform! 🚀**
