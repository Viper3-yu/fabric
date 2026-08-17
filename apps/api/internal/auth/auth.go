package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"github.com/Viper3-yu/fabric/chaincode/logistics/model"
	"golang.org/x/crypto/bcrypt"
)

type claims struct {
	Subject string `json:"sub"`
	Role    string `json:"role"`
	Issued  int64  `json:"iat"`
	Expires int64  `json:"exp"`
}

func Authenticate(username, password string) (model.User, error) {
	account, ok := users.ByUsername[username]
	if !ok {
		return model.User{}, apperror.New(401, "INVALID_CREDENTIALS", "Username or password is incorrect")
	}
	// A bcrypt hash (production form) takes precedence; the plaintext value
	// only remains as the built-in course demo fallback.
	valid := false
	if account.PasswordHash != "" {
		valid = bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password)) == nil
	} else {
		valid = equal(password, account.Password)
	}
	if !valid {
		return model.User{}, apperror.New(401, "INVALID_CREDENTIALS", "Username or password is incorrect")
	}
	return account.User, nil
}

func CreateToken(user model.User, secret string, lifetime time.Duration) (string, error) {
	now := time.Now().UTC()
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(claims{
		Subject: user.ID,
		Role:    user.Role,
		Issued:  now.Unix(),
		Expires: now.Add(lifetime).Unix(),
	})
	if err != nil {
		return "", err
	}
	unsigned := encode(header) + "." + encode(payload)
	signature := sign(unsigned, secret)
	return unsigned + "." + encode(signature), nil
}

func VerifyToken(token, secret string) (model.User, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return model.User{}, errors.New("invalid token format")
	}
	unsigned := parts[0] + "." + parts[1]
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, sign(unsigned, secret)) {
		return model.User{}, errors.New("invalid token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return model.User{}, errors.New("invalid token payload")
	}
	var decoded claims
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return model.User{}, errors.New("invalid token claims")
	}
	if decoded.Expires <= time.Now().UTC().Unix() {
		return model.User{}, errors.New("token expired")
	}
	user, ok := users.ByID[decoded.Subject]
	if !ok || user.Role != decoded.Role {
		return model.User{}, errors.New("unknown token subject")
	}
	return user, nil
}

func Bearer(header string) (string, error) {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) || len(header) == len(prefix) {
		return "", fmt.Errorf("a Bearer token is required")
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix)), nil
}

func encode(value []byte) string {
	return base64.RawURLEncoding.EncodeToString(value)
}

func sign(value, secret string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func equal(actual, expected string) bool {
	if len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}
