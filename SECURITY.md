# Security Policy

## Supported Versions

We provide security updates for the following versions of BulkIG:

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :x:                |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability within BulkIG, please send an email to security@bulkig.com. All security vulnerabilities will be promptly addressed.

**Please do not report security vulnerabilities through public GitHub issues.**

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment**: Within 24 hours
- **Initial Assessment**: Within 72 hours
- **Status Update**: Weekly until resolved
- **Resolution**: Varies by severity (1-30 days)

## Security Best Practices

### For Users

1. **Environment Variables**: Never commit `.env` files or expose API keys
2. **Access Control**: Restrict dashboard access to authorized personnel only
3. **Network Security**: Use HTTPS and secure tunnels for production deployments
4. **Regular Updates**: Keep BulkIG and its dependencies updated
5. **Monitoring**: Monitor system logs for suspicious activity

### For Contributors

1. **Dependencies**: Regularly audit and update dependencies
2. **Input Validation**: Validate all user inputs and API responses
3. **Error Handling**: Don't expose sensitive information in error messages
4. **Authentication**: Use secure token-based authentication
5. **Logging**: Log security-relevant events without exposing sensitive data

## Security Features

### Current Implementation

- **API Token Security**: Instagram API tokens are securely stored
- **Input Sanitization**: All user inputs are validated and sanitized
- **File Upload Security**: File type and size validation
- **Rate Limiting**: Built-in rate limiting for API calls
- **Secure Headers**: Security headers implemented in Express.js
- **Environment Isolation**: Development and production environment separation

### Planned Improvements

- [ ] Two-factor authentication
- [ ] Role-based access control
- [ ] Audit logging
- [ ] Encrypted data at rest
- [ ] Security scanning integration
- [ ] Penetration testing

## Third-Party Security

### Instagram API
- We use official Instagram Graph API
- All API calls use HTTPS
- Tokens are managed according to Meta's security guidelines

### OpenAI API
- API keys are stored securely
- No sensitive data is sent to OpenAI
- All communications use HTTPS

### Cloudflare Tunnels
- Secure tunnel connections
- End-to-end encryption
- No exposed ports or direct access

## Compliance

BulkIG is designed to comply with:

- Instagram's Platform Policy
- Meta's Terms of Service
- GDPR (General Data Protection Regulation)
- CCPA (California Consumer Privacy Act)

## Contact

For security-related questions or concerns:

- **Email**: security@bulkig.com
- **PGP Key**: Available upon request
- **Response Time**: 24-48 hours

## Hall of Fame

We maintain a hall of fame for security researchers who responsibly disclose vulnerabilities:

*No entries yet - be the first!*

---

**Last Updated**: September 2025