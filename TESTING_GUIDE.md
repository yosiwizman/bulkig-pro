# TESTING_GUIDE.md

## First Launch Test
1. Install BulkIG Pro Setup.exe
2. Launch app — the license modal should appear
3. Enter email: demo@bulkigpro.com
4. Enter license key from the generation step
5. Click Activate
6. App should unlock and show the dashboard

## Feature Test
1. Add Meta API credentials (in .env before build or via environment for Electron):
   - IG_USER_ID (Instagram Business ID)
   - FB_LONG_LIVED_PAGE_TOKEN (Facebook Page Token)
2. Generate caption drafts
3. Upload a test image or short video
4. Schedule to both Instagram and Facebook (select both in the Create Post modal)
5. Verify results in Activity Log and (optionally) on the actual platform
