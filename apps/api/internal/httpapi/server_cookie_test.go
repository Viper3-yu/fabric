package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestSessionCookieLoginAndLogout covers the browser auth flow: login sets an
// httpOnly session cookie, protected routes accept it without an
// Authorization header, and logout clears it.
func TestSessionCookieLoginAndLogout(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()
	client := api.server.Client()

	response, err := client.Post(
		api.server.URL+"/api/auth/login",
		"application/json",
		bytes.NewBufferString(`{"username":"shipper","password":"shipper123"}`),
	)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", response.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode login: %v", err)
	}
	if payload["data"].(map[string]any)["token"] == "" {
		t.Fatal("login response must keep the token for non-browser clients")
	}

	var session *http.Cookie
	for _, cookie := range response.Cookies() {
		if cookie.Name == sessionCookieName {
			session = cookie
			break
		}
	}
	if session == nil {
		t.Fatal("login must set the jixin_session cookie")
	}
	if !session.HttpOnly {
		t.Fatal("session cookie must be httpOnly")
	}
	if session.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie SameSite = %v, want Lax", session.SameSite)
	}
	if session.Path != "/" || session.MaxAge <= 0 {
		t.Fatalf("session cookie Path/MaxAge = %q/%d, want / and a positive lifetime", session.Path, session.MaxAge)
	}

	// The cookie alone must authenticate /api/auth/me.
	me := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	me.AddCookie(session)
	meResponse := httptest.NewRecorder()
	api.server.Config.Handler.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("me with cookie only = %d: %s", meResponse.Code, meResponse.Body.String())
	}

	// Logout clears the cookie.
	logout := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logout.AddCookie(session)
	logoutResponse := httptest.NewRecorder()
	api.server.Config.Handler.ServeHTTP(logoutResponse, logout)
	if logoutResponse.Code != http.StatusOK {
		t.Fatalf("logout status = %d", logoutResponse.Code)
	}
	var cleared *http.Cookie
	for _, cookie := range logoutResponse.Result().Cookies() {
		if cookie.Name == sessionCookieName {
			cleared = cookie
			break
		}
	}
	if cleared == nil || cleared.MaxAge >= 0 {
		t.Fatal("logout must expire the session cookie")
	}
}

// TestSessionCookieRejectsInvalidToken guards the cookie path against
// tampered tokens: the cookie is just an alternative transport, not a bypass.
func TestSessionCookieRejectsInvalidToken(t *testing.T) {
	api := newTestAPI(t)
	defer api.close()

	me := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	me.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "not-a-real-token"})
	meResponse := httptest.NewRecorder()
	api.server.Config.Handler.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusUnauthorized {
		t.Fatalf("invalid cookie token status = %d, want 401", meResponse.Code)
	}
}
