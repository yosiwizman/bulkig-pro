#!/bin/bash

# BulkIG Pro macOS Build Script
# Run this on a macOS machine to build the app

echo "🍎 BulkIG Pro macOS Build Script"
echo "================================="

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script must be run on macOS!"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi

echo "📦 Installing dependencies..."
pnpm install

# Generate icon.icns if it doesn't exist
if [ ! -f "assets/icon.icns" ]; then
    echo "🎨 Generating macOS icon..."
    if [ -f "assets/icon.png" ]; then
        cd assets
        mkdir -p icon.iconset
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
        iconutil -c icns icon.iconset
        rm -rf icon.iconset
        cd ..
        echo "✅ macOS icon generated!"
    else
        echo "⚠️  No icon.png found, using default icon"
    fi
fi

echo "🔨 Building BulkIG Pro for macOS..."
npm run dist:mac

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📦 Output files:"
    echo "  • DMG installer: dist/BulkIG Pro-*.dmg"
    echo "  • ZIP archive: dist/BulkIG Pro-*.zip"
    echo ""
    echo "🚀 Installation:"
    echo "  1. Open the DMG file"
    echo "  2. Drag BulkIG Pro to Applications folder"
    echo "  3. First launch: Right-click and select 'Open' (bypasses Gatekeeper)"
    echo ""
else
    echo "❌ Build failed! Check the error messages above."
    exit 1
fi