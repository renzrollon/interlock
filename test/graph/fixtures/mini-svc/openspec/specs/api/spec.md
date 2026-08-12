# API

## Requirements

The service MUST mint a token on login.

Entry point is `cmd/api/main.py`, which delegates to `internal/service/handler.py`
using the helper in `util/token.py`.
