# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Building and Running
```powershell
# Development mode with hot reload
npm run dev

# Start in production mode  
npm run start

# Build TypeScript to dist/
npm run build
```

### Testing and Development
```powershell
# Run a single test file (if tests were added)
npx ts-node test/scheduler.test.ts

# Check TypeScript compilation
npx tsc --noEmit

# Run with different mock modes
$env:IG_MOCK="true"; npm run dev    # Test mode
$env:IG_MOCK="false"; npm run dev   # Production mode
```

### Environment Setup
```powershell
# Create inbox directory
New-Item -ItemType Directory -Path "C:\IG\inbox" -Force

# Set required environment variables in .env file:
# IG_USER_ID=your_instagram_user_id  
# FB_LONG_LIVED_PAGE_TOKEN=your_facebook_token
# INBOX_PATH=C:\IG\inbox
# IG_POSTER_PORT=4010
```

## Code Architecture

### Core System Components

**Express Server (`src/index.ts`)**
- Main HTTP server with REST API endpoints
- Serves static dashboard from `public/` directory  
- Handles file uploads via multer with disk storage
- Integrates Cloudflare tunnel for public media URLs
- Provides comprehensive health monitoring and metrics

**Scheduler (`src/scheduler.ts`)**
- Manages post state machine: QUEUED → SCHEDULED → PUBLISHING → PUBLISHED/ERROR
- Supports two scheduling modes: fixed times vs. interval-based
- Handles auto-reposting of content after 60 days
- Provides scheduling preview and batch operations

**Publisher (`src/publisher.ts`)**
- Executes scheduled posts via Instagram Graph API
- Implements three-step publishing: create container → wait for processing → publish
- Uses p-retry for robust API interaction
- Supports mock mode for testing without real API calls

**File Watcher (`src/watcher.ts`)**
- Monitors inbox directory for new media files using chokidar
- Auto-queues supported file types: images (.jpg, .png, .gif, .webp) and videos (.mp4, .mov, .avi, .webm)
- Filters system files and provides real-time file system integration

### Data Flow Architecture

1. **Media Ingestion**: Files dropped in inbox → FileWatcher detects → Scheduler queues
2. **Content Processing**: Queued posts → Caption generation → Scheduling planning → Status transitions
3. **Publishing Pipeline**: Scheduled posts → Publisher processes → Instagram API → Status updates
4. **Monitoring Layer**: All operations logged → Health metrics → Dashboard updates

### Key Design Patterns

**State Management**: Posts use a finite state machine with clear transitions and validation
**Configuration-Driven**: Scheduling behavior controlled by user-configurable parameters
**Event-Driven**: File system events trigger processing pipeline
**API-First**: RESTful endpoints enable dashboard and external integration
**Error Recovery**: Retry mechanisms and graceful degradation throughout

### Instagram API Integration

The system implements Instagram's Container-based publishing workflow:
1. Create media container with image URL and caption
2. Poll container status until processing completes  
3. Publish container to create live Instagram post

**Mock Mode**: Set `IG_MOCK=true` to simulate API calls without posting

### Media Handling

- **Local Storage**: Files stored in configurable inbox directory
- **Public URLs**: Cloudflare tunnel provides Instagram-accessible URLs for videos
- **Format Validation**: Automatic media type detection and Instagram compatibility checking
- **Reusability**: Media library allows reuse of uploaded content

### Logging and Monitoring

**Structured Logging**: All operations logged with timestamps, categories, and structured data
**Persistent Logs**: JSON log file survives server restarts
**Health Metrics**: API latency, memory usage, disk space, success rates
**Dashboard Integration**: Real-time log streaming to web interface

### Configuration System

Environment-based configuration with sensible defaults:
- **Mock Mode**: Test without Instagram API calls
- **Paths**: Configurable inbox and static directories
- **Scheduling**: Flexible time-based or interval-based posting
- **Auto-repost**: Configurable content recycling

## Important Implementation Details

### Video Handling
Videos require special handling due to Instagram's processing requirements:
- Duration validation (3-60 seconds for reels)
- Aspect ratio checking (0.8 to 1.91 for optimal display)  
- Tunnel URL usage for reliable delivery
- FFprobe integration for metadata extraction

### Caption Generation
Smart caption system with Live Pilates USA branding:
- Keyword-based templates for consistent messaging
- Hashtag optimization and character limits
- Media type-specific caption variations
- Manual override capability

### Error Handling
Comprehensive error handling across all layers:
- API retry logic with exponential backoff
- File system error recovery
- Graceful degradation when services unavailable
- Detailed error logging for debugging

### Security Considerations
- Environment variable protection for sensitive tokens
- Path traversal protection for file operations
- Input validation on all API endpoints
- Safe file handling with type restrictions