# Contributing to BulkIG

Thank you for your interest in contributing to BulkIG! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Development Setup

1. **Fork the repository**
   ```bash
   # Click the "Fork" button on GitHub, then:
   git clone https://github.com/your-username/bulkig.git
   cd bulkig
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your development credentials
   ```

4. **Start development server**
   ```bash
   pnpm dev
   ```

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. **Make your changes**
   - Follow the coding standards below
   - Add tests for new features
   - Update documentation as needed

3. **Test your changes**
   ```bash
   pnpm test
   pnpm lint
   pnpm build
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add amazing feature"
   ```

5. **Push and create Pull Request**
   ```bash
   git push origin feature/amazing-feature
   ```
   Then create a PR on GitHub.

## 📋 Code Standards

### TypeScript Guidelines

- Use TypeScript for all new code
- Prefer explicit types over `any`
- Use proper error handling with try/catch
- Follow existing patterns for API endpoints

### Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Keep line length under 100 characters
- Use meaningful variable and function names

### Example:

```typescript
// Good
async function createPost(filename: string, caption: string): Promise<Post> {
  try {
    const post: Post = {
      id: generateId(),
      filename,
      caption,
      status: 'QUEUED',
      created_at: new Date()
    };
    return await scheduler.addPost(post);
  } catch (error) {
    throw new Error(`Failed to create post: ${error.message}`);
  }
}

// Bad
async function createPost(filename, caption) {
  var post = {
    id: generateId(),
    filename: filename,
    caption: caption,
    status: "QUEUED",
    created_at: new Date()
  }
  return scheduler.addPost(post)
}
```

### File Structure

```
apps/ig-poster/
├── src/
│   ├── index.ts        # Main Express server
│   ├── scheduler.ts    # Post scheduling logic
│   ├── publisher.ts    # Instagram API integration
│   ├── caption.ts      # AI caption generation
│   ├── ig.ts           # Instagram Graph API wrapper
│   └── types.ts        # Type definitions
├── public/
│   └── index.html      # Dashboard frontend
└── data/
    └── drafts.json     # Caption drafts storage
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm test:watch
```

### Writing Tests

- Write unit tests for utility functions
- Write integration tests for API endpoints
- Use descriptive test names
- Mock external services (Instagram API, OpenAI)

Example test:
```typescript
describe('Scheduler', () => {
  it('should schedule post at specified time', async () => {
    const scheduler = new Scheduler();
    const post = await scheduler.schedulePost('image.jpg', new Date('2024-12-25T10:00:00Z'));
    
    expect(post.status).toBe('SCHEDULED');
    expect(post.scheduled_at).toEqual(new Date('2024-12-25T10:00:00Z'));
  });
});
```

## 📝 Documentation

### Code Documentation

- Add JSDoc comments for public functions
- Include parameter types and return types
- Document complex logic with inline comments

Example:
```typescript
/**
 * Generates AI-powered caption for Instagram post
 * @param filename - The media filename
 * @param keywords - Array of keywords to include
 * @param style - Caption style ('short' | 'medium' | 'long')
 * @returns Promise resolving to generated caption
 */
async function generateCaption(
  filename: string, 
  keywords: string[], 
  style: CaptionStyle = 'medium'
): Promise<string> {
  // Implementation...
}
```

### README Updates

- Update README.md for new features
- Add examples for new API endpoints
- Update configuration documentation

## 🐛 Bug Reports

### Before Reporting

1. Search existing issues
2. Check if it's already fixed in latest version
3. Reproduce the bug with minimal steps

### Bug Report Template

```markdown
## Bug Description
Clear description of the bug.

## Steps to Reproduce
1. Go to...
2. Click on...
3. See error

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Environment
- OS: [e.g., Windows 11]
- Node.js: [e.g., 20.5.0]
- BulkIG: [e.g., 0.2.1]

## Additional Context
Screenshots, logs, etc.
```

## ✨ Feature Requests

### Before Requesting

1. Check if feature already exists
2. Search existing feature requests
3. Consider if it fits the project scope

### Feature Request Template

```markdown
## Feature Description
Clear description of the feature.

## Use Case
Why is this feature needed?

## Proposed Solution
How should it work?

## Alternatives Considered
Other approaches considered.

## Additional Context
Mockups, examples, etc.
```

## 📦 Pull Request Guidelines

### PR Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No merge conflicts
- [ ] Builds successfully

### PR Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Screenshots
If applicable.
```

## 🎯 Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `documentation` | Documentation improvements |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `priority: high` | High priority issue |
| `status: blocked` | Blocked by dependencies |

## 🏆 Recognition

Contributors are recognized in several ways:

1. **README Contributors Section**: All contributors listed
2. **Release Notes**: Major contributions highlighted
3. **GitHub Achievements**: Contribution badges
4. **Hall of Fame**: Outstanding contributors featured

## 📞 Getting Help

- **GitHub Discussions**: General questions and ideas
- **GitHub Issues**: Bug reports and feature requests
- **Email**: contact@bulkig.com for private matters

## 📜 Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

### Our Standards

- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what's best for the community
- Showing empathy towards other members

---

Thank you for contributing to BulkIG! 🚀