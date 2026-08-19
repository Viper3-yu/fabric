package auth

import (
	"testing"

	"github.com/Viper3-yu/fabric/apps/api/internal/apperror"
	"github.com/Viper3-yu/fabric/apps/api/internal/users"
	"golang.org/x/crypto/bcrypt"
)

func TestAuthenticateUsesBcryptHashWhenConfigured(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("production-secret"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	users.Configure(map[string]string{"shipper": "plaintext-override"}, map[string]string{"shipper": string(hash)})
	t.Cleanup(func() { users.Configure(map[string]string{"shipper": "shipper123"}, nil) })

	if _, err := Authenticate("shipper", "production-secret"); err != nil {
		t.Fatalf("hash-authenticated login failed: %v", err)
	}
	// The plaintext override must not win against a configured hash.
	if _, err := Authenticate("shipper", "plaintext-override"); err == nil {
		t.Fatal("plaintext override must be ignored when a bcrypt hash is configured")
	}
	// And an unrelated password must not work either.
	if _, err := Authenticate("shipper", "some-other-password"); err == nil {
		t.Fatal("an unrelated password must not authenticate against a configured hash")
	}
}

func TestAuthenticateRejectsAccountWithoutCredentials(t *testing.T) {
	// No hash and no plaintext override configured: even an empty password
	// must not authenticate.
	account := users.ByUsername["carrier"]
	account.Password, account.PasswordHash = "", ""
	users.ByUsername["carrier"] = account
	if _, err := Authenticate("carrier", ""); err == nil {
		t.Fatal("an account without configured credentials must not authenticate")
	}
	if _, err := Authenticate("carrier", "anything"); err == nil {
		t.Fatal("an account without configured credentials must not authenticate")
	}
}

func TestAuthenticateRejectsWrongPassword(t *testing.T) {
	_, err := Authenticate("shipper", "definitely-wrong")
	var appErr *apperror.Error
	if err == nil || !asAppError(err, &appErr) || appErr.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("wrong password = %v, want INVALID_CREDENTIALS", err)
	}
	_, err = Authenticate("no-such-user", "whatever")
	if err == nil || !asAppError(err, &appErr) || appErr.Code != "INVALID_CREDENTIALS" {
		t.Fatalf("unknown user = %v, want INVALID_CREDENTIALS", err)
	}
}

func asAppError(err error, target **apperror.Error) bool {
	value, ok := err.(*apperror.Error)
	if !ok {
		return false
	}
	*target = value
	return true
}
