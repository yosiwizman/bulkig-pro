# BulkIG Pro - Instagram & Facebook Automation

Enhanced version with dual-platform support.

## Port Configuration
- Main app: 4011 (original uses 4010)
- Static server: 5006 (original uses 5005)

## Migration from BulkIG
Run `pnpm migrate` to import drafts from the original installation.

## Platform Support
- Instagram: Feed posts, Reels, supported media types
- Facebook: Page posts with images and videos

## Features
- ✅ Dual-platform posting (Instagram + Facebook)
- ✅ Single Meta API setup for both platforms
- ✅ Platform-specific scheduling

[![CI/CD](https://github.com/yosiwizman/bulkig/workflows/CI/badge.svg)](https://github.com/yosiwizman/bulkig/actions)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A powerful, production-ready Instagram posting automation system with AI-powered caption generation, advanced scheduling, and media management capabilities.

## 🌟 Features

### Core Functionality
- **📅 365-Day Scheduling Calendar** - Plan and visualize posts up to a year in advance
- **🤖 AI-Powered Caption Generation** - Smart captions with hashtags and keywords
- **📁 Media Library with Reuse** - Store and reuse media files efficiently
- **📸 Multi-Format Support** - Posts, Stories, and Reels with format validation
- **🔄 Auto-Reposting** - Automatically repost content after 60 days
- **🌐 Cloudflare Tunnel Integration** - Secure video delivery for Instagram

### Advanced Features
- **Visual Calendar View** - See post thumbnails directly in calendar cells
- **Drag & Drop Upload** - Easy media upload with preview
- **Batch Processing** - Handle multiple posts efficiently
- **Real-time Logs** - Monitor posting activity and errors
- **Health Monitoring** - Track system performance and API connectivity
- **Mobile-Responsive UI** - Works on all devices

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm (recommended) or npm
- Instagram Business Account
- Facebook App with Instagram Basic Display API access

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/bulkig.git
cd bulkig
```

2. **Install dependencies**
```bash
pnpm install
# or
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Instagram Configuration
IG_USER_ID=your_instagram_user_id
FB_TOKEN=your_facebook_access_token

# Paths
INBOX_PATH=C:\IG\inbox

# Server
PORT=4010
STATIC_PORT=5005

# Mode
MOCK=false  # Set to true for testing without posting
```

4. **Start the application**
```bash
pnpm start
# or for development
pnpm dev
```

5. **Access the dashboard**
Open http://localhost:4010 in your browser

## 📖 Usage Guide

### Creating Posts

1. **Manual Post Creation**
   - Click "Create Post" button
   - Select post type (Post/Story/Reel)
   - Upload media or choose from library
   - Write caption or use AI generator
   - Post immediately or schedule

2. **Bulk Upload**
   - Drag and drop files to the upload zone
   - Files are automatically queued
   - System schedules based on your configuration

### Post Types

- **Posts** - Standard feed posts (images or videos)
- **Stories** - 24-hour temporary content (vertical format)
- **Reels** - Short-form videos (3-60 seconds, requires video)

### Scheduling Options

- **Fixed Times** - Set specific times for posting (e.g., 9:00 AM, 2:00 PM)
- **Interval** - Post every X hours
- **Days Selection** - Choose which days to post
- **Auto-Repost** - Enable 60-day recycling of content

### Media Library

- Upload media for future use
- Delete unwanted files with hover delete button
- Reuse media for multiple posts
- Track usage count for each media file

## 🏗️ Architecture

```
bulkig/
├── apps/
│   └── ig-poster/
│       ├── src/
│       │   ├── index.ts       # Express server & API
│       │   ├── scheduler.ts   # Post scheduling logic
│       │   ├── publisher.ts   # Instagram API integration
│       │   ├── watcher.ts     # File system monitoring
│       │   └── caption.ts     # AI caption generation
│       └── public/
│           └── index.html     # Single-page dashboard
├── packages/
│   └── (shared packages)
└── C:/IG/inbox/               # Media storage folder
```

## 🔧 Configuration

### Scheduling Modes
- **Fixed Times**: Posts at specific times daily
- **Interval**: Posts every N hours
- **Hybrid**: Combination of both

### Caption Templates
Customize caption generation with keyword categories:
- Product features
- Benefits
- Call-to-actions
- Hashtag sets

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ig/status` | GET | System status and post counts |
| `/ig/post-now` | POST | Publish immediately |
| `/ig/schedule-post` | POST | Schedule for specific time |
| `/ig/upload` | POST | Upload media file |
| `/ig/saved-media` | GET | List media library |
| `/ig/media/:filename` | DELETE | Delete media file |
| `/ig/caption` | POST | Generate AI caption |
| `/ig/logs` | GET | View system logs |
| `/ig/health/detailed` | GET | Detailed health metrics |

## 🛠️ Development

### Scripts
```bash
pnpm dev      # Start development server with hot reload
pnpm build    # Build for production
pnpm start    # Start production server
pnpm test     # Run tests
```

### Project Structure
- **Monorepo** using Turborepo
- **TypeScript** for type safety
- **Express.js** backend
- **Vanilla JS** frontend (no framework dependencies)
- **File-based** state management

## 🔐 Security

- Environment variables for sensitive data
- Token-based Instagram authentication
- Cloudflare tunnel for secure media delivery
- Input validation and sanitization

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please read CONTRIBUTING.md for guidelines.

## 🐛 Known Issues

- Stories API integration pending Instagram API updates
- Reels require manual aspect ratio adjustment
- Maximum 25 posts per day (Instagram limit)

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check documentation at /docs
- Contact: support@bulkig.com

## 🙏 Acknowledgments

- Instagram Basic Display API
- Cloudflare Tunnel
- Live Pilates USA for inspiration

---

Built with ❤️ for content creators and social media managers