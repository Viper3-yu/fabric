package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// sessionClaims mirrors the JWT payload minted by apps/api (HS256, claims
// sub/role/iat/exp). Both services read the same JWT_SECRET, so a session
// issued by the main API is valid here without a second login.
type sessionClaims struct {
	Subject string `json:"sub"`
	Role    string `json:"role"`
	Issued  int64  `json:"iat"`
	Expires int64  `json:"exp"`
}

const sessionCookieName = "jixin_session"

func verifySessionToken(token, secret string) (sessionClaims, error) {
	var claims sessionClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, errors.New("invalid token format")
	}
	unsigned := parts[0] + "." + parts[1]
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, signSession(unsigned, secret)) {
		return claims, errors.New("invalid token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, errors.New("invalid token claims")
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, errors.New("invalid token claims")
	}
	if claims.Expires <= time.Now().UTC().Unix() {
		return claims, errors.New("token expired")
	}
	if strings.TrimSpace(claims.Role) == "" {
		return claims, errors.New("token has no role")
	}
	return claims, nil
}

func signSession(value, secret string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

// cookieHeaderReader is the slice of gin.Context used for token extraction.
type cookieHeaderReader interface {
	Cookie(name string) (string, error)
	GetHeader(name string) string
}

// extractSessionToken prefers the httpOnly session cookie set by the main API
// and falls back to an Authorization: Bearer header for non-browser clients.
func extractSessionToken(c cookieHeaderReader) (string, error) {
	if cookie, err := c.Cookie(sessionCookieName); err == nil && strings.TrimSpace(cookie) != "" {
		return strings.TrimSpace(cookie), nil
	}
	header := c.GetHeader("Authorization")
	if token, ok := strings.CutPrefix(header, "Bearer "); ok && strings.TrimSpace(token) != "" {
		return strings.TrimSpace(token), nil
	}
	return "", fmt.Errorf("missing session token")
}
