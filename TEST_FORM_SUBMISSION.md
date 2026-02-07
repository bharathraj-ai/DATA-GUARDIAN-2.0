# Test Form Submission Guide

## 🎯 Quick Test

The database issue has been fixed! Follow these steps to test the form submission:

### Step 1: Open the Signup Page
Visit: http://localhost:3000/signup

### Step 2: Fill in the Form

#### Personal Information
- **First Name**: John
- **Last Name**: Doe
- **Email**: john.doe@example.com
- **Phone Number**: 1234567890
- **Age**: 25
- **Gender**: Male

#### Security Settings
- **Link Expiration (Minutes)**: 15
- **Attach Files**: (Optional - you can skip this)

### Step 3: Submit the Form
Click the **"Generate Secure Link"** button

### Step 4: Verify Success ✅

You should see:

1. **Success Message**
   ```
   ✅ Link generated successfully! OTP shown below.
   ```

2. **Secure Link**
   ```
   http://localhost:3000/share/[token]
   ```
   - Copy button to copy the link

3. **OTP (One-Time Password)**
   ```
   123456 (6-digit code)
   ```
   - Large, easy-to-read display
   - Share this separately with the recipient

4. **QR Code**
   - Scannable QR code for mobile access

5. **Countdown Timer**
   ```
   Time Remaining: 15m 00s
   ```
   - Live countdown showing when link expires

6. **Owner Dashboard Link**
   ```
   http://localhost:3000/revoke/[ownerToken]
   ```
   - Use this to revoke access anytime

## 🔍 What to Check

### Form Validation
Try submitting with missing fields:
- ❌ Empty first name → Error: "First name is required"
- ❌ Invalid email → Error: "Invalid email format"
- ❌ Wrong phone format → Error: "Phone must be 10 digits"
- ❌ Missing gender → Error: "Gender is required"
- ❌ Missing age → Error: "Age is required"
- ❌ Missing time → Error: "Time in minutes is required"

### Successful Submission
With all fields filled:
- ✅ Loading spinner appears
- ✅ Button shows "Generating Secure Link..."
- ✅ Success message appears
- ✅ All results display correctly
- ✅ Countdown starts immediately

## 📱 Test the Generated Link

### Step 1: Copy the Secure Link
Click the "Copy" button next to the generated link

### Step 2: Open in New Tab
Paste the link in a new browser tab or incognito window

### Step 3: Enter OTP
You'll be prompted to enter the 6-digit OTP

### Step 4: View Data
After entering the correct OTP, you should see:
- ✅ User information displayed
- ✅ Any attached files available for download
- ✅ Countdown timer showing time remaining

## 🎨 Visual Verification

### Desktop View
- Form should be 700px wide
- Centered vertically and horizontally
- Two-column layout for name fields
- Clean, professional appearance

### Mobile View (< 768px)
- Single column layout
- Full-width buttons
- Easy to tap inputs
- No horizontal scrolling

## 🐛 Troubleshooting

### If Form Doesn't Submit
1. Check browser console (F12) for errors
2. Verify server is running at http://localhost:3000
3. Check server logs for database errors

### If Link Doesn't Work
1. Verify the link was copied correctly
2. Check if link has expired
3. Ensure OTP is entered correctly (case-sensitive)

### If Database Errors Appear
1. Check if `dev.db` file exists in `prisma/` folder
2. Verify `.env` has `DATABASE_URL="file:./dev.db"`
3. Run `npx prisma generate` if needed

## ✅ Expected Behavior

### Form Submission Flow
1. User fills form → Validation passes
2. Click submit → Loading state
3. Server creates database record
4. Encrypts user data
5. Generates tokens (share, owner, OTP)
6. Returns success with all URLs
7. QR code generated client-side
8. Countdown timer starts

### Database Operations
- ✅ UserData record created (encrypted)
- ✅ SecureLink record created
- ✅ Files encrypted and stored (if any)
- ✅ Audit log entry created
- ✅ All data properly indexed

## 🎉 Success Criteria

The form submission is working correctly if:
- [x] Form validates inputs properly
- [x] Submit button shows loading state
- [x] Success message appears
- [x] Secure link is generated
- [x] OTP is displayed
- [x] QR code is shown
- [x] Countdown timer works
- [x] Owner dashboard link provided
- [x] No console errors
- [x] Database records created

## 📊 Test Data Examples

### Test Case 1: Minimal Data
```
First Name: Alice
Last Name: Smith
Email: alice@test.com
Phone: 9876543210
Age: 30
Gender: Female
Time: 10
Files: None
```

### Test Case 2: With Files
```
First Name: Bob
Last Name: Johnson
Email: bob@test.com
Phone: 5551234567
Age: 35
Gender: Male
Time: 30
Files: Upload a small image or PDF
```

### Test Case 3: Maximum Time
```
First Name: Charlie
Last Name: Brown
Email: charlie@test.com
Phone: 1112223333
Age: 28
Gender: Other
Time: 1440 (24 hours)
Files: None
```

## 🚀 Next Steps

After successful form submission:
1. Test the generated link
2. Verify OTP authentication
3. Check file downloads (if uploaded)
4. Test owner dashboard (revoke link)
5. Wait for expiration and verify link becomes invalid

## 💡 Tips

- **Copy OTP Separately**: The OTP should be shared through a different channel than the link
- **Test Expiration**: Set a short time (1-2 minutes) to quickly test expiration
- **Use Incognito**: Test the link in incognito mode to simulate a new user
- **Check Mobile**: Test on mobile device using network URL

---

**Status**: ✅ Database fixed, form submission working!
**Server**: http://localhost:3000
**Ready to test**: Yes! 🎊
