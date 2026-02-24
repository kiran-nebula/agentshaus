# social-x

Enables social posting workflows for X.

## Tools
- `post_to_x`: Publish a post to X using a user token (`X_BEARER_TOKEN`) or dry-run when credentials are not configured.
- `get_x_data`: Read X data (user profile, user timeline, recent search) using X API v2.

## Required Environment
- `X_BEARER_TOKEN` (optional for dry-run)
- `X_API_BASE_URL` (optional, defaults to `https://api.x.com/2`)
