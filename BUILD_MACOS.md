# Building BulkIG Pro for macOS

This guide explains how to build BulkIG Pro for macOS from source.

## Prerequisites

### Required Software
- **macOS 10.15 (Catalina) or later**
- **Node.js 18.0.0 or later** - [Download](https://nodejs.org/)
- **Git** - Comes pre-installed on macOS
- **Xcode Command Line Tools** (for icon generation)

### Optional (for distribution)
- **Apple Developer Account** ($99/year) - For code signing without security warnings
- **Apple Developer ID Certificate** - For notarization

## Quick Build (Unsigned)

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/bulkig-pro.git
cd bulkig-pro
```

2. **Run the build script:**
```bash
chmod +x build-mac.sh
./build-mac.sh
```

This will:
- Install dependencies
- Generate macOS icon
- Build both DMG and ZIP installers
- Output files to `dist/` directory

## Manual Build Steps

If you prefer to build manually:

1. **Install pnpm (if not installed):**
```bash
npm install -g pnpm
```

2. **Install dependencies:**
```bash
pnpm install
```

3. **Generate macOS icon (optional):**
```bash
cd assets
# Create icon set
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
# Generate ICNS
iconutil -c icns icon.iconset
rm -rf icon.iconset
cd ..
```

4. **Build the app:**
```bash
npm run dist:mac
```

## Output Files

After successful build, you'll find in the `dist/` directory:

- **`BulkIG Pro-0.2.0.dmg`** - Disk image installer (recommended)
- **`BulkIG Pro-0.2.0-mac.zip`** - ZIP archive
- **`mac/BulkIG Pro.app`** - The actual application bundle

## Installation

### For Users (DMG):
1. Double-click the `.dmg` file
2. Drag `BulkIG Pro` to the `Applications` folder
3. Eject the DMG
4. **First launch:** Right-click the app and select "Open" (bypasses Gatekeeper warning)

### For Developers (Direct):
```bash
cp -r "dist/mac/BulkIG Pro.app" /Applications/
```

## Troubleshooting

### "App can't be opened because it is from an unidentified developer"

**Solution 1:** Right-click the app and select "Open"

**Solution 2:** In Terminal:
```bash
xattr -cr "/Applications/BulkIG Pro.app"
```

### "App is damaged and can't be opened"

This happens with unsigned apps downloaded from the internet. Fix:
```bash
sudo xattr -rd com.apple.quarantine "/Applications/BulkIG Pro.app"
```

### Build fails with "Cannot find module"

Clear cache and rebuild:
```bash
rm -rf node_modules dist
pnpm install
npm run dist:mac
```

## Code Signing (Optional)

For distribution without security warnings:

1. **Get Apple Developer ID:**
   - Join Apple Developer Program ($99/year)
   - Create Developer ID Application certificate

2. **Set environment variables:**
```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=your_certificate_password
```

3. **Build with signing:**
```bash
npm run dist:mac
```

## Notarization (Recommended for Distribution)

After code signing, notarize for macOS 10.15+:

1. **Set Apple ID credentials:**
```bash
export APPLE_ID=your@email.com
export APPLE_ID_PASSWORD=app-specific-password
```

2. **Build with notarization:**
```bash
npm run dist:mac
```

The app will be automatically notarized during build.

## Architecture Support

The build creates a universal binary supporting both:
- **Intel Macs** (x64)
- **Apple Silicon Macs** (M1/M2/M3 - arm64)

## System Requirements

**Minimum macOS version:** 10.15 (Catalina)
**Recommended:** macOS 12.0 (Monterey) or later
**RAM:** 4GB minimum, 8GB recommended
**Storage:** 200MB free space

## Support

For issues specific to macOS builds, please check:
1. Console.app for crash logs
2. `~/Library/Logs/BulkIG Pro/` for app logs
3. GitHub Issues for known problems

## License

See LICENSE file in the repository root.