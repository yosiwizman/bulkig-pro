# How to Get the Mac Version of BulkIG Pro

## 🎯 Easy Steps for Non-Technical Users

### Step 1: Create a GitHub Account (Free)
1. Go to https://github.com/signup
2. Enter your email
3. Create a password
4. Choose a username
5. Verify your email

### Step 2: Upload Your Code to GitHub
1. Go to https://github.com/new
2. Name it: `bulkig-pro`
3. Set to **Private** (if you don't want others to see it)
4. Click "Create repository"
5. Follow the instructions to upload your `bulkig-pro` folder

### Step 3: Enable GitHub Actions
1. In your repository, click on "Actions" tab
2. Click "I understand my workflows, go ahead and enable them"

### Step 4: Trigger a Build
1. Click "Actions" tab
2. Click "Build and Release" on the left
3. Click "Run workflow" button
4. Click green "Run workflow" button

### Step 5: Download Both Versions
After 10-15 minutes:
1. Click "Actions" tab
2. Click on the completed workflow run
3. Scroll down to "Artifacts"
4. Download:
   - `windows-installer` (for Windows users)
   - `macos-installer` (for Mac users)

## 📦 What You Get:

- **Windows users**: Give them the `.exe` file
- **Mac users**: Give them the `.dmg` file

---

## 🆘 Alternative: Ask a Friend with a Mac

If GitHub seems too complicated:

1. **Find a friend with a Mac**
2. **Send them this folder**: `bulkig-pro`
3. **Tell them to**:
   ```
   1. Open Terminal
   2. Type: cd [drag the bulkig-pro folder here]
   3. Type: chmod +x build-mac.sh
   4. Type: ./build-mac.sh
   5. Send you back the .dmg file from the dist folder
   ```

---

## 💳 Professional Option: Use a Service

**MacInCloud** (Easiest but costs money)
1. Go to https://www.macincloud.com/
2. Sign up for "Pay-As-You-Go" ($1/hour)
3. Upload your `bulkig-pro` folder
4. Run the build script
5. Download the Mac installer
6. Total cost: About $1-2

---

## ❓ Still Need Help?

If you're stuck, you can:
1. Ask in the GitHub Discussions
2. Find a local computer shop that has Macs
3. Post on Reddit's r/macOS asking for help
4. Use Fiverr to hire someone for $5-10